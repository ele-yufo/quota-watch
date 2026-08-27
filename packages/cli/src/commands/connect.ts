import type { Command } from 'commander';
import chalk from 'chalk';
import QRCode from 'qrcode';
import https from 'node:https';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { networkInterfaces } from 'node:os';
import { loadAppConfig, isLoopbackHost, defaultCertsDir } from '@quota-watch/core';

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

/** PEM CA from the daemon's cert dir — the trust anchor for all CLI calls. */
function daemonCa(): string {
  return readFileSync(join(defaultCertsDir(), 'ca.crt'), 'utf-8');
}

function httpsJson(
  port: number,
  token: string | null,
  path: string,
  method: 'GET' | 'POST',
  ca: string,
): Promise<unknown> {
  return new Promise((resolve) => {
    const req = https.request(
      {
        host: '127.0.0.1',
        port,
        path,
        method,
        ca,
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        timeout: 3000,
      },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch {
            resolve(null);
          }
        });
      },
    );
    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
    req.end();
  });
}

async function daemonApiReachable(port: number, token: string | null, ca: string): Promise<boolean> {
  const body = await httpsJson(port, token, '/health', 'GET', ca);
  return body !== null;
}

/**
 * Start a pairing session (POST /pair/start) — returns its 6-digit code and
 * the daemon CA fingerprint. The code is short-lived and single-use; the QR
 * carries the fingerprint so the phone can pin TLS before claiming.
 */
async function startPairingSession(
  port: number,
  token: string | null,
  ca: string,
): Promise<{ code: string; caFingerprint?: string } | null> {
  const body = (await httpsJson(port, token, '/pair/start', 'POST', ca)) as
    | { code?: string; caFingerprint?: string }
    | null;
  if (typeof body?.code !== 'string' || !body.code) return null;
  return { code: body.code, caFingerprint: body.caFingerprint };
}

/**
 * The pairing payload the iOS app scans: host/port + a 6-digit code (+ the CA
 * fingerprint for TLS pinning). The app exchanges the code for the token over
 * the daemon's HTTPS API — the token itself never travels in the QR.
 */
function pairingURL(host: string, port: number, code: string, caFingerprint?: string): string {
  const params = new URLSearchParams({ host, port: String(port), code });
  if (caFingerprint) params.set('fp', caFingerprint);
  return `qw://pair?${params.toString()}`;
}

interface ConnectOptions {
  qr?: boolean;
  /** override the host encoded into the QR / shown for pairing (e.g. a public IP/domain) */
  host?: string;
  /**
   * override the port encoded into the QR / shown for pairing. Needed when a
   * tunnel (frp remotePort, Cloudflare, etc.) exposes the daemon on a different
   * public port than the local API port. Defaults to the local API port.
   */
  port?: string;
}

async function runConnect(options: ConnectOptions): Promise<void> {
  const config = loadAppConfig();
  const { host: boundHost, port, token } = config.api;
  const ca = daemonCa();

  console.log(chalk.bold('\nquota-watch device pairing\n'));

  const running = await daemonApiReachable(port, token, ca);
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

  // The phone dials pairPort — which differs from the local API port when a
  // tunnel exposes the daemon on another public port (e.g. an frp remotePort).
  const pairPort = options.port ? Number(options.port) : port;
  if (!Number.isFinite(pairPort) || pairPort <= 0) {
    console.log(chalk.yellow(`⚠ Invalid --port "${options.port}".`));
    return;
  }

  const isPublic = Boolean(options.host) && !isPrivateHost(options.host!);

  if (options.qr) {
    const session = await startPairingSession(port, token, ca);
    if (!session) {
      console.log(chalk.yellow('⚠ Could not start a pairing session — is the daemon API up?'));
      return;
    }
    const url = pairingURL(pairHost, pairPort, session.code, session.caFingerprint);
    const qr = await QRCode.toString(url, { type: 'terminal', small: true });
    console.log('Scan this in the iOS app (tap "扫码配对"):\n');
    console.log(qr);
    console.log(chalk.dim(`  payload: ${url}\n`));
  }

  console.log('Or enter manually in the iOS app:');
  console.log(`  ${chalk.bold('Host')}   ${pairHost}`);
  console.log(`  ${chalk.bold('Port')}   ${pairPort}`);
  console.log(`  ${chalk.bold('Code')}   ${chalk.bold('在 Mac 菜单栏点「配对」取 6 位码')}`);
  if (lan.length > 1 && !options.host) {
    console.log(
      chalk.dim(`\n  (other LAN addresses: ${lan.slice(1).join(', ')} — pick the one your phone can reach)`),
    );
  }

  if (isPublic) {
    console.log(
      chalk.yellow(
        '\n⚠ Public host: traffic is encrypted (TLS + CA pin), but prefer a tunnel',
      ),
    );
    console.log(
      chalk.dim(
        '  (Tailscale / Cloudflare Tunnel / WireGuard) over a raw port-forward.',
      ),
    );
  }

  console.log(chalk.dim('\n  Both devices must reach this host:port. Verify from the phone browser:'));
  console.log(chalk.dim(`  https://${pairHost}:${pairPort}/health  (send Authorization: Bearer <token>)\n`));
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
    .description('Show host/port/code (and optional QR) for pairing the iOS app')
    .option('--qr', 'print a scannable QR code for pairing')
    .option('--host <address>', 'host to encode for pairing (public IP/domain); defaults to LAN IP')
    .option('--port <port>', 'port to encode for pairing (e.g. an frp remote port); defaults to the local API port')
    .action(async (options: ConnectOptions) => {
      await runConnect(options);
    });
}
