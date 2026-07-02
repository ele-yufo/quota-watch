import type { Command } from 'commander';
import chalk from 'chalk';
import QRCode from 'qrcode';
import { networkInterfaces } from 'node:os';
import { loadAppConfig, isLoopbackHost } from '@quota-watch/core';

/** Non-internal IPv4 addresses of this machine, for LAN pairing. */
function lanAddresses(): string[] {
  const result: string[] = [];
  for (const nets of Object.values(networkInterfaces())) {
    for (const net of nets ?? []) {
      if (net.family === 'IPv4' && !net.internal) result.push(net.address);
    }
  }
  return result;
}

async function daemonApiReachable(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(2000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * The pairing payload the iOS app scans. Custom scheme keeps it compact and
 * unambiguous; the app parses host/port/token from the query.
 */
function pairingURL(host: string, port: number, token: string | null): string {
  const params = new URLSearchParams({ host, port: String(port) });
  if (token) params.set('token', token);
  return `qw://pair?${params.toString()}`;
}

interface ConnectOptions {
  qr?: boolean;
  /** override the host encoded into the QR / shown for pairing (e.g. a public IP/domain) */
  host?: string;
}

async function runConnect(options: ConnectOptions): Promise<void> {
  const config = loadAppConfig();
  const { host: boundHost, port, token } = config.api;

  console.log(chalk.bold('\nquota-watch device pairing\n'));

  const running = await daemonApiReachable(port);
  if (!running) {
    console.log(chalk.yellow('⚠ Daemon API is not reachable on this machine.'));
    console.log(chalk.dim('  Start it first: quota-watch daemon start --lan\n'));
  }

  if (isLoopbackHost(boundHost)) {
    console.log(chalk.yellow('⚠ API is bound to loopback — other devices cannot connect.'));
    console.log(
      chalk.dim(
        '  Enable LAN access: quota-watch daemon stop && quota-watch daemon start --lan\n',
      ),
    );
    return;
  }

  // Which host does the phone dial? --host override wins (public IP/domain),
  // else the first LAN address.
  const lan = lanAddresses();
  const pairHost = options.host ?? lan[0];
  if (!pairHost) {
    console.log(chalk.yellow('⚠ No LAN IPv4 address found — pass --host <ip-or-domain> to pair.'));
    return;
  }

  if (!token) {
    console.log(chalk.yellow('⚠ No API token set — restart the daemon to generate one:'));
    console.log(chalk.dim('  quota-watch daemon stop && quota-watch daemon start --lan\n'));
    return;
  }

  const isPublic = Boolean(options.host) && !isPrivateHost(options.host!);

  if (options.qr) {
    const url = pairingURL(pairHost, port, token);
    const qr = await QRCode.toString(url, { type: 'terminal', small: true });
    console.log('Scan this in the iOS app (tap "扫码配对"):\n');
    console.log(qr);
    console.log(chalk.dim(`  payload: ${url}\n`));
  }

  console.log('Or enter manually in the iOS app:');
  console.log(`  ${chalk.bold('Host')}   ${pairHost}`);
  console.log(`  ${chalk.bold('Port')}   ${port}`);
  console.log(`  ${chalk.bold('Token')}  ${token}`);
  if (lan.length > 1 && !options.host) {
    console.log(
      chalk.dim(`\n  (other LAN addresses: ${lan.slice(1).join(', ')} — pick the one your phone can reach)`),
    );
  }

  if (isPublic) {
    console.log(
      chalk.yellow(
        '\n⚠ Public host: plain-HTTP over the internet exposes the token in cleartext.',
      ),
    );
    console.log(
      chalk.dim(
        '  Prefer a tunnel (Tailscale / Cloudflare Tunnel / WireGuard) over a raw port-forward.',
      ),
    );
  }

  console.log(chalk.dim('\n  Both devices must reach this host:port. Verify from the phone browser:'));
  console.log(chalk.dim(`  http://${pairHost}:${port}/health  (send Authorization: Bearer <token>)\n`));
}

/** RFC1918 private / loopback / .local — "safe" cleartext hosts. */
function isPrivateHost(host: string): boolean {
  if (isLoopbackHost(host)) return true;
  if (host.endsWith('.local')) return true;
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(host);
  if (!m) return false; // hostname/domain → assume public
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (a === 10) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

export function registerConnectCommand(program: Command): void {
  program
    .command('connect')
    .description('Show host/port/token (and optional QR) for pairing the iOS app')
    .option('--qr', 'print a scannable QR code for pairing')
    .option('--host <address>', 'host to encode for pairing (public IP/domain); defaults to LAN IP')
    .action(async (options: ConnectOptions) => {
      await runConnect(options);
    });
}
