import type { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { QuotaDB, predictConsumption } from '@quota-watch/core';
import { renderQuotaBar, renderPace, renderResetTime, formatTokens } from '../render.js';

interface StatusRow {
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

export function statusCommand(program: Command): void {
  program
    .command('status')
    .description('Show current quota status for all providers')
    .option('--json', 'Output as JSON')
    .option('-p, --provider <id>', 'Filter to specific provider')
    .action(async (opts: { json?: boolean; provider?: string }) => {
      const dbPath = join(homedir(), '.quota-watch', 'data.db');
      const db = new QuotaDB(dbPath);

      try {
        const rows = db.getLatestSnapshots(opts.provider);

        if (rows.length === 0) {
          if (opts.json) {
            console.log(JSON.stringify({ snapshots: [], message: 'No data. Run: quota-watch daemon start' }, null, 2));
          } else {
            console.log(chalk.yellow('No data yet.'));
            console.log(chalk.dim('Run:'), chalk.bold('quota-watch daemon start'));
          }
          return;
        }

        if (opts.json) {
          console.log(JSON.stringify({ snapshots: rows }, null, 2));
          return;
        }

        // Render table
        const table = new Table({
          head: [
            chalk.cyan('Provider'),
            chalk.cyan('Window'),
            chalk.cyan('Bar'),
            chalk.cyan('Used'),
            chalk.cyan('Total'),
            chalk.cyan('Pace'),
            chalk.cyan('Reset'),
          ],
          style: { head: [], border: [] },
          colWidths: [20, 16, 30, 12, 12, 14, 16],
        });

        // Run predictions for each row
        const predictions = new Map<string, ReturnType<typeof predictConsumption>>();
        for (const row of rows) {
          const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
          const snapshots = db.getSnapshots(row.providerId, row.windowName, since);
          const pred = predictConsumption(snapshots, row.used, row.total, row.resetAt);
          predictions.set(`${row.providerId}:${row.windowName}`, pred);
        }

        for (const row of rows) {
          const usedStr = formatTokens(row.used);
          const totalStr = formatTokens(row.total);
          const bar = renderQuotaBar(row.remainingPct, 16);

          const pred = predictions.get(`${row.providerId}:${row.windowName}`);
          const pace = pred?.pace ?? 0;
          const paceStr = renderPace(pace);

          const resetStr = renderResetTime(row.resetAt);

          table.push([
            chalk.bold(row.displayName),
            chalk.dim(row.windowName),
            bar,
            `${usedStr}`,
            `${totalStr}`,
            paceStr,
            resetStr,
          ]);
        }

        console.log('');
        console.log(chalk.bold('  Quota Status'));
        console.log(table.toString());

        // Prediction summary
        let hasPrediction = false;
        for (const row of rows) {
          const pred = predictions.get(`${row.providerId}:${row.windowName}`);
          if (pred && pred.exhaustionAt && pred.hoursRemaining !== Infinity) {
            if (!hasPrediction) {
              console.log(chalk.bold('  Predictions'));
              hasPrediction = true;
            }
            const hours = pred.hoursRemaining.toFixed(1);
            const emoji = pred.willExhaustBeforeReset ? '⚠️' : '✅';
            console.log(`  ${emoji} ${row.displayName} / ${row.windowName}: ~${hours}h until exhaustion`);
          }
        }

        // Summary line
        const updated = new Date(rows[0].timestamp);
        const ago = formatTimeAgo(updated);
        console.log(chalk.dim(`  Last updated: ${ago}`));
        console.log('');
      } finally {
        db.close();
      }
    });
}

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
