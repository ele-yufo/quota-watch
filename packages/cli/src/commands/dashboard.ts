import type { Command } from 'commander';
import chalk from 'chalk';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { QuotaDB } from '@quota-watch/core';
import { renderQuotaBar, renderPace, renderResetTime } from '../render.js';

// ── Constants ──────────────────────────────────────────────────────────

const REFRESH_INTERVAL_MS = 30_000;
const DB_PATH = join(homedir(), '.quota-watch', 'data.db');

// ANSI escape codes
const CLEAR_SCREEN = '\x1b[2J';
const CURSOR_HOME = '\x1b[H';
const HIDE_CURSOR = '\x1b[?25l';
const SHOW_CURSOR = '\x1b[?25h';

// ── Types ──────────────────────────────────────────────────────────────

interface WindowRow {
  providerId: string;
  displayName: string;
  providerType: string;
  windowName: string;
  used: number;
  total: number;
  unit: string;
  remainingPct: number;
  resetAt: string | null;
  timestamp: string;
}

// ── Helpers ────────────────────────────────────────────────────────────

function formatTimeAgo(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function boxLine(content: string, width: number): string {
  // Pad content to width and add box-drawing side borders
  const visibleLen = stripAnsi(content).length;
  const padding = Math.max(0, width - visibleLen - 4); // -4 for "│ " prefix and " │" suffix
  return `│ ${content}${' '.repeat(padding)} │`;
}

function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

function horizontalLine(left: string, mid: string, right: string, width: number): string {
  return left + mid.repeat(width + 2) + right;
}

// ── Render ─────────────────────────────────────────────────────────────

function render(rows: WindowRow[]): void {
  const WIDTH = 60;

  // Clear screen and move cursor to home
  process.stdout.write(CLEAR_SCREEN + CURSOR_HOME);

  const lines: string[] = [];

  // Top border
  lines.push(horizontalLine('╭', '─', '╮', WIDTH));

  // Title
  lines.push(boxLine(chalk.bold('quota-watch — AI Quota Monitor'), WIDTH));

  // Subtitle: last updated
  const latestTs = rows.length > 0
    ? new Date(rows.reduce((max, r) => r.timestamp > max ? r.timestamp : max, rows[0].timestamp))
    : new Date();
  const ago = formatTimeAgo(latestTs);
  const dateStr = latestTs.toLocaleString('sv-SE', { hour12: false }).replace('T', ' ');
  lines.push(boxLine(chalk.dim(`Last updated: ${dateStr} (${ago})`), WIDTH));

  // Separator
  lines.push(horizontalLine('├', '─', '┤', WIDTH));

  if (rows.length === 0) {
    lines.push(boxLine('', WIDTH));
    lines.push(boxLine(chalk.yellow('  No data yet.'), WIDTH));
    lines.push(boxLine(chalk.dim('  Run: quota-watch daemon start'), WIDTH));
    lines.push(boxLine('', WIDTH));
  } else {
    // Group rows by provider
    const groups = new Map<string, WindowRow[]>();
    for (const row of rows) {
      const key = row.providerId;
      const arr = groups.get(key) ?? [];
      arr.push(row);
      groups.set(key, arr);
    }

    let firstGroup = true;
    for (const [, group] of groups) {
      if (!firstGroup) {
        lines.push(boxLine('', WIDTH));
      }
      firstGroup = false;

      const header = group[0]!;
      // Provider header: "DisplayName · ProviderType"
      const providerLabel = `${chalk.bold(header.displayName)} · ${chalk.dim(header.providerType)}`;
      lines.push(boxLine(`  ${providerLabel}`, WIDTH));

      for (const row of group) {
        // Estimate usage percentage (consumed = 100 - remainingPct)
        const usedPct = 100 - row.remainingPct;
        const bar = renderQuotaBar(row.remainingPct, 16);
        const resetStr = renderResetTime(row.resetAt);

        // For pace: use a simple heuristic based on remaining percentage
        // and reset time. If we have resetAt, estimate pace from % consumed vs % time elapsed.
        let paceValue = 0;
        if (row.resetAt) {
          const resetMs = new Date(row.resetAt).getTime();
          // Assume window started ~5h ago for session, ~7d for weekly
          // Use a rough heuristic: pace ≈ consumed_pct / elapsed_pct
          // For now, derive from remaining: if remaining < 50% and lots of time left, pace is high
          const hoursToReset = (resetMs - Date.now()) / 3_600_000;
          // Assume session window is 5h, weekly is 168h (7d)
          const isWeekly = row.windowName.toLowerCase().includes('week') || row.windowName.toLowerCase().includes('7d');
          const windowHours = isWeekly ? 168 : 5;
          const elapsedHours = Math.max(0, windowHours - hoursToReset);
          const fractionElapsed = windowHours > 0 ? elapsedHours / windowHours : 0;
          const fractionConsumed = usedPct / 100;
          paceValue = fractionElapsed > 0 ? fractionConsumed / fractionElapsed : 0;
        }

        const paceStr = renderPace(paceValue);

        // Format: "  session (5h)  [████████░░░░░░░░] 65%  🟢  resets 2h15m"
        const pctLabel = `${Math.round(usedPct)}%`;

        const line = `    ${chalk.dim(row.windowName.padEnd(16))} ${bar} ${pctLabel.padStart(4)}  ${paceStr}  ${chalk.dim('resets')} ${resetStr}`;
        lines.push(boxLine(line, WIDTH));
      }
    }
  }

  lines.push(boxLine('', WIDTH));

  // Footer
  lines.push(horizontalLine('├', '─', '┤', WIDTH));
  lines.push(boxLine(chalk.dim("  Press 'q' to quit, 'r' to refresh"), WIDTH));
  lines.push(horizontalLine('╰', '─', '╯', WIDTH));

  // Write all lines
  process.stdout.write(lines.join('\n') + '\n');
}

// ── Main loop ──────────────────────────────────────────────────────────

export function dashboardCommand(program: Command): void {
  program
    .command('dashboard')
    .alias('dash')
    .alias('d')
    .description('Interactive TUI dashboard with auto-refresh')
    .action(async () => {
      const db = new QuotaDB(DB_PATH);
      let refreshTimer: ReturnType<typeof setTimeout> | null = null;
      let running = true;

      // Set up raw mode for stdin to capture single keypresses
      if (!process.stdin.isTTY) {
        console.log(chalk.yellow('Dashboard requires an interactive terminal.'));
        db.close();
        return;
      }

      const origRawMode = process.stdin.isRaw;
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdout.write(HIDE_CURSOR);

      // Cleanup function
      function cleanup(): void {
        running = false;
        if (refreshTimer) {
          clearTimeout(refreshTimer);
          refreshTimer = null;
        }
        process.stdout.write(SHOW_CURSOR);
        process.stdin.setRawMode(origRawMode ?? false);
        process.stdin.pause();
        db.close();
      }

      // Read data and render
      async function refresh(): Promise<void> {
        if (!running) return;

        try {
          const rows = db.getLatestSnapshots();
          render(rows);
        } catch (err) {
          process.stdout.write(CLEAR_SCREEN + CURSOR_HOME);
          console.error(chalk.red(`Error reading data: ${err instanceof Error ? err.message : String(err)}`));
        }
      }

      // Schedule next auto-refresh
      function scheduleRefresh(): void {
        if (!running) return;
        refreshTimer = setTimeout(async () => {
          await refresh();
          scheduleRefresh();
        }, REFRESH_INTERVAL_MS);
      }

      // Handle keypress
      process.stdin.on('data', async (key: Buffer) => {
        const ch = key.toString('utf-8');

        if (ch === 'q' || ch === '\x03') {
          // 'q' or Ctrl-C: quit
          cleanup();
          process.stdout.write(CLEAR_SCREEN + CURSOR_HOME);
          console.log(chalk.dim('Dashboard closed.'));
          process.exit(0);
        }

        if (ch === 'r') {
          // Force refresh
          if (refreshTimer) {
            clearTimeout(refreshTimer);
            refreshTimer = null;
          }
          await refresh();
          scheduleRefresh();
        }
      });

      // Initial render
      await refresh();
      scheduleRefresh();
    });
}
