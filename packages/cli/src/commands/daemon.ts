import type { Command } from 'commander';
import chalk from 'chalk';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { loadAppConfig, saveAppConfig, ensureApiToken } from '@quota-watch/core';

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
  } catch {
    return false;
  }
}

// ── Subcommands ────────────────────────────────────────────────────────

function startDaemon(options: { lan?: boolean } = {}): void {
  const existingPid = readPid();
  if (existingPid !== null && isProcessAlive(existingPid)) {
    console.log(chalk.yellow(`Daemon already running (pid ${existingPid})`));
    console.log(chalk.dim('Stop it first with: quota-watch daemon stop'));
    return;
  }

  // --lan persists api.host=0.0.0.0 (+ generated token) so the iOS app can
  // reach the daemon; the worker reads config.json at startup.
  if (options.lan) {
    const config = loadAppConfig();
    if (config.api.host === '127.0.0.1') {
      saveAppConfig({ ...config, api: { ...config.api, host: '0.0.0.0' } });
    }
    const withToken = ensureApiToken(loadAppConfig());
    console.log(chalk.dim(`LAN mode: API will bind 0.0.0.0:${withToken.api.port} (token auth)`));
    console.log(chalk.dim('Pair a device with: quota-watch connect'));
  }

  // Clean stale PID file
  removePid();
  ensureDataDir();

  const logFile = join(DATA_DIR, 'daemon.log');
  const workerPath = resolveWorkerPath();

  if (!existsSync(workerPath)) {
    console.error(chalk.red(`Worker script not found: ${workerPath}`));
    console.error(chalk.dim('Run: pnpm --filter @quota-watch/cli build'));
    process.exitCode = 1;
    return;
  }

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

  if (!isProcessAlive(pid)) {
    console.log(chalk.yellow(`Stale PID file (process ${pid} not running). Cleaning up.`));
    removePid();
    return;
  }

  try {
    process.kill(pid, 'SIGTERM');
    console.log(chalk.green(`✓ Daemon stopped (pid ${pid})`));
  } catch (err) {
    console.error(chalk.red(`Failed to stop daemon: ${err}`));
  }

  removePid();
}

function daemonStatus(): void {
  const pid = readPid();
  if (pid === null) {
    console.log(chalk.yellow('Daemon is not running'));
    console.log(chalk.dim('Start it with: quota-watch daemon start'));
    return;
  }

  if (isProcessAlive(pid)) {
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
    .option('--lan', 'expose the daemon API on the LAN (0.0.0.0) for the iOS app')
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
