import type { Command } from 'commander';
import chalk from 'chalk';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { loadAppConfig, saveAppConfig, ensureApiToken, isLoopbackHost } from '@quota-watch/core';

// ── Paths ──────────────────────────────────────────────────────────────

const DATA_DIR = join(homedir(), '.quota-watch');
const PID_FILE = join(DATA_DIR, 'daemon.pid');

/** Resolve the compiled worker script next to this module. */
function resolveWorkerPath(): string {
  const dir = import.meta.dirname ?? join(DATA_DIR, 'cli-dist');
  return join(dir, '..', 'daemon-worker.js');
}

// Ensure data dir exists
function ensureDataDir(): void {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
}

// ── PID helpers ────────────────────────────────────────────────────────

function readPid(): number | null {
  if (!existsSync(PID_FILE)) return null;
  try {
    const raw = readFileSync(PID_FILE, 'utf-8').trim();
    const pid = parseInt(raw, 10);
    return Number.isFinite(pid) ? pid : null;
  } catch {
    return null;
  }
}

function writePid(pid: number): void {
  ensureDataDir();
  writeFileSync(PID_FILE, String(pid), 'utf-8');
}

function removePid(): void {
  if (existsSync(PID_FILE)) {
    unlinkSync(PID_FILE);
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM = the process exists but belongs to another user — it is ALIVE.
    // Treating it as dead would clean a live PID file and double-start.
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** True when `pid` is actually our worker, not an innocent PID reuser. */
function pidIsWorker(pid: number): boolean {
  try {
    const cmd = execFileSync('ps', ['-p', String(pid), '-o', 'command='], {
      encoding: 'utf-8',
    }).trim();
    return cmd.includes('daemon-worker');
  } catch {
    return false;
  }
}

/**
 * On macOS the daemon is normally a launchd job (io.quotawatch.daemon,
 * KeepAlive=true). `daemon start` there spawns a SECOND worker — double
 * polling, duplicate alerts, and two writers on the same SQLite DB.
 */
function launchdJobLoaded(): boolean {
  if (process.platform !== 'darwin') return false;
  try {
    execFileSync('launchctl', ['print', `gui/${process.getuid?.() ?? 0}/io.quotawatch.daemon`], {
      stdio: 'pipe',
    });
    return true;
  } catch {
    return false;
  }
}

// ── Subcommands ────────────────────────────────────────────────────────

function startDaemon(options: { lan?: boolean } = {}): void {
  // --lan persists config REGARDLESS of how the daemon is run (launchd or
  // CLI-spawned) — refusing before this block made the documented remote-access
  // flow a no-op on launchd installs.
  if (options.lan) {
    const config = loadAppConfig();
    if (isLoopbackHost(config.api.host)) {
      saveAppConfig({ ...config, api: { ...config.api, host: '0.0.0.0' } });
    }
    const withToken = ensureApiToken(loadAppConfig());
    console.log(chalk.dim(`LAN mode: API will bind 0.0.0.0:${withToken.api.port} (token auth)`));
  }

  if (launchdJobLoaded()) {
    console.log(chalk.yellow('Daemon is managed by launchd (io.quotawatch.daemon).'));
    if (options.lan) {
      console.log(chalk.dim('LAN config saved; apply it with: launchctl kickstart -k gui/$(id -u)/io.quotawatch.daemon'));
    } else {
      console.log(chalk.dim('Restart it with: launchctl kickstart -k gui/$(id -u)/io.quotawatch.daemon'));
    }
    console.log(chalk.dim('Spawning a second worker would double-poll every provider.'));
    return;
  }

  const existingPid = readPid();
  if (existingPid !== null && isProcessAlive(existingPid) && pidIsWorker(existingPid)) {
    console.log(chalk.yellow(`Daemon already running (pid ${existingPid})`));
    console.log(chalk.dim('Stop it first with: quota-watch daemon stop'));
    return;
  }

  const workerPath = resolveWorkerPath();
  if (!existsSync(workerPath)) {
    console.error(chalk.red(`Worker script not found: ${workerPath}`));
    console.error(chalk.dim('Run: pnpm --filter @quota-watch/cli build'));
    process.exitCode = 1;
    return;
  }

  // Clean stale PID file
  removePid();
  ensureDataDir();

  const logFile = join(DATA_DIR, 'daemon.log');

  // Use spawn (not fork) to avoid creating an IPC channel.
  // The daemon uses PID files for lifecycle management, not IPC.
  // This eliminates EPIPE race conditions entirely.
  const child = spawn(process.execPath, [workerPath], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env },
  });

  child.unref();

  if (child.pid !== undefined) {
    writePid(child.pid);
    console.log(chalk.green(`✓ Daemon started (pid ${child.pid})`));
    console.log(chalk.dim(`  Log file: ${logFile}`));
    console.log(chalk.dim(`  PID file: ${PID_FILE}`));
  }
}

function stopDaemon(): void {
  const pid = readPid();
  if (pid === null) {
    console.log(chalk.yellow('No daemon running (no PID file found)'));
    return;
  }

  if (!isProcessAlive(pid) || !pidIsWorker(pid)) {
    console.log(chalk.yellow(`Stale PID file (process ${pid} not our worker). Cleaning up.`));
    removePid();
    return;
  }

  try {
    process.kill(pid, 'SIGTERM');
  } catch (err) {
    console.error(chalk.red(`Failed to stop daemon: ${err}`));
    return; // keep the PID file — the process may still be alive
  }

  // SIGTERM is async — the worker needs a moment to close the DB and exit.
  // Claiming success without waiting leaves the next `start` racing a live
  // process on the same SQLite file. Atomics.wait = blocking sleep, one-shot CLI.
  const nap = new Int32Array(new SharedArrayBuffer(4));
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline && isProcessAlive(pid)) {
    Atomics.wait(nap, 0, 0, 100);
  }
  if (isProcessAlive(pid)) {
    console.log(chalk.yellow(`Daemon (pid ${pid}) has not exited yet; check ${join(DATA_DIR, 'daemon.log')}`));
    return; // PID file stays — it still owns the process
  }

  console.log(chalk.green(`✓ Daemon stopped (pid ${pid})`));
  removePid();
}

function daemonStatus(): void {
  const pid = readPid();
  if (pid === null) {
    console.log(chalk.yellow('Daemon is not running'));
    console.log(chalk.dim('Start it with: quota-watch daemon start'));
    return;
  }

  if (isProcessAlive(pid) && pidIsWorker(pid)) {
    console.log(chalk.green(`✓ Daemon is running (pid ${pid})`));
    console.log(chalk.dim(`  Log file: ${join(DATA_DIR, 'daemon.log')}`));
  } else {
    console.log(chalk.yellow(`Daemon is not running (stale PID ${pid})`));
    console.log(chalk.dim('Run: quota-watch daemon start'));
    removePid();
  }
}

// ── Command registration ───────────────────────────────────────────────

export function registerDaemonCommand(program: Command): void {
  const daemon = program
    .command('daemon')
    .description('Manage the background polling daemon');

  daemon
    .command('start')
    .description('Start background polling in the background')
    .option('--lan', 'expose the daemon API on the LAN (0.0.0.0, token auth required)')
    .action((options: { lan?: boolean }) => {
      startDaemon(options);
    });

  daemon
    .command('stop')
    .description('Stop the background polling daemon')
    .action(() => {
      stopDaemon();
    });

  daemon
    .command('status')
    .description('Check if the daemon is running')
    .action(() => {
      daemonStatus();
    });
}
