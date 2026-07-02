/**
 * daemon-worker.ts — background polling worker + embedded HTTP API
 *
 * Spawned by `quota-watch daemon start` via child_process.spawn().
 * Loads all providers from DB, creates a registry, starts the scheduler,
 * evaluates alert rules, serves the HTTP API (health/quota/poll — consumed
 * by the web dashboard, menu bar and iOS app), and logs to
 * ~/.quota-watch/daemon.log. Poll cadence + API binding come from
 * ~/.quota-watch/config.json.
 */

import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import {
  QuotaDB,
  QuotaScheduler,
  ProviderRegistry,
  AlertEngine,
  DiscordNotifier,
  loadAppConfig,
  ensureApiToken,
  startApiServer,
  codexProvider,
  claudeProvider,
  opencodeGoProvider,
  kimiProvider,
  antigravityProvider,
  glmCnProvider,
  copilotProvider,
  geminiCliProvider,
} from '@quota-watch/core';
import type { AlertNotifier, AlertMessage } from '@quota-watch/core';
import type { Server } from 'node:http';

// ── Paths ──────────────────────────────────────────────────────────────

const DATA_DIR = join(homedir(), '.quota-watch');
const DB_PATH = join(DATA_DIR, 'data.db');
const LOG_PATH = join(DATA_DIR, 'daemon.log');

// Ensure data dir exists
mkdirSync(DATA_DIR, { recursive: true });

// ── Logging ────────────────────────────────────────────────────────────

function log(level: 'INFO' | 'ERROR' | 'WARN', message: string): void {
  const line = `[${new Date().toISOString()}] [${level}] ${message}\n`;
  appendFileSync(LOG_PATH, line);
  process.stderr.write(line);
}

// ── Log-based notifier (always active) ─────────────────────────────────

class LogNotifier implements AlertNotifier {
  async send(message: AlertMessage): Promise<void> {
    log('WARN',
      `ALERT: ${message.provider} ${message.plan} — ${message.window.name} ` +
      `at ${message.remainingPct.toFixed(1)}% remaining (threshold: ${message.thresholdPct}%)`
    );
  }
}

// ── Main ───────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  log('INFO', `Worker started (pid=${process.pid})`);

  const appConfig = ensureApiToken(loadAppConfig());
  log(
    'INFO',
    `Config: poll fast=${appConfig.poll.fastMs}ms base=${appConfig.poll.baseMs}ms idle=${appConfig.poll.idleMs}ms, ` +
      `api=${appConfig.api.host}:${appConfig.api.port}${appConfig.api.token ? ' (token auth)' : ''}`,
  );

  const db = new QuotaDB(DB_PATH);

  // Register ALL known providers
  const registry = new ProviderRegistry();
  registry.register(codexProvider);
  registry.register(claudeProvider);
  registry.register(opencodeGoProvider);
  registry.register(kimiProvider);
  registry.register(antigravityProvider);
  registry.register(glmCnProvider);
  registry.register(copilotProvider);
  registry.register(geminiCliProvider);
  log('INFO', `Registered providers: ${registry.list().join(', ')}`);

  // Set up alert notifiers
  const notifiers = new Map<string, AlertNotifier>();
  notifiers.set('macos_notification', new LogNotifier()); // Log-based fallback

  const discordWebhook = process.env.DISCORD_WEBHOOK_URL;
  if (discordWebhook) {
    notifiers.set('discord_webhook', new DiscordNotifier(discordWebhook));
    log('INFO', 'Discord webhook notifier enabled');
  }

  const alertEngine = new AlertEngine(db, notifiers);

  // Create scheduler with alert evaluation
  const scheduler = new QuotaScheduler({
    registry,
    db,
    baseIntervalMs: appConfig.poll.baseMs,
    activeIntervalMs: appConfig.poll.fastMs,
    idleIntervalMs: appConfig.poll.idleMs,
    alertIntervalMs: appConfig.poll.fastMs,
    onQuotaFetched: async (providerId, quota) => {
      for (const window of quota.windows) {
        log('INFO', `[${providerId}] ${window.name}: ${window.used}/${window.total} ${window.unit} (${window.remainingPct.toFixed(1)}% remaining)`);
      }

      // Evaluate alert rules
      try {
        await alertEngine.evaluate(providerId, quota);
      } catch (err) {
        log('ERROR', `Alert evaluation failed for ${providerId}: ${err}`);
      }
    },
  });

  scheduler.start();
  log('INFO', 'Scheduler started');

  // Embedded HTTP API — web dashboard status/refresh, menu bar, iOS app
  let apiServer: Server | null = null;
  try {
    apiServer = await startApiServer({
      db,
      scheduler,
      host: appConfig.api.host,
      port: appConfig.api.port,
      token: appConfig.api.token,
    });
    log('INFO', `API listening on http://${appConfig.api.host}:${appConfig.api.port}`);
  } catch (err) {
    // e.g. port already taken — polling still works, API just unavailable
    log('ERROR', `API server failed to start: ${err instanceof Error ? err.message : err}`);
  }

  // Poll immediately on startup instead of waiting for the first baseInterval
  // tick, so a freshly authenticated provider shows up without a 15-min wait.
  void scheduler.pollNow().then(() => {
    log('INFO', 'Initial poll complete');
  });

  // Run data cleanup on startup (remove snapshots older than 30 days)
  const cleaned = db.cleanupOldData(30);
  if (cleaned > 0) {
    log('INFO', `Cleaned up ${cleaned} old snapshot(s)`);
  }

  // Graceful shutdown
  const shutdown = (): void => {
    log('INFO', 'Shutting down scheduler...');
    apiServer?.close();
    scheduler.stop();
    db.close();
    log('INFO', 'Worker stopped');
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  process.on('uncaughtException', (err) => {
    log('ERROR', `Uncaught: ${err.message}`);
  });
  process.on('unhandledRejection', (err) => {
    log('ERROR', `Unhandled rejection: ${err}`);
  });
}

void main();
