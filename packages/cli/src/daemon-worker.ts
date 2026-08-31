/**
 * daemon-worker.ts — background polling worker + embedded HTTP API
 *
 * Spawned by `quota-watch daemon start` via child_process.spawn().
 * Loads all providers from DB, creates a registry, starts the scheduler,
 * evaluates alert rules, serves the HTTP API (health/quota/poll — consumed
 * by the web dashboard and remote MCP clients), and logs to
 * ~/.quota-watch/daemon.log. Poll cadence + API binding come from
 * ~/.quota-watch/config.json.
 */

import { appendFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
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
  ensureTlsConfig,
  defaultCertsDir,
  startApiServer,
  codexProvider,
  claudeProvider,
  opencodeGoProvider,
  kimiProvider,
  antigravityProvider,
  glmCnProvider,
  copilotProvider,
} from '@quota-watch/core';
import type { AlertNotifier, AlertMessage } from '@quota-watch/core';
import type { Server } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpServer } from './mcp-server.js';

// ── Paths ──────────────────────────────────────────────────────────────

const DATA_DIR = join(homedir(), '.quota-watch');
const DB_PATH = join(DATA_DIR, 'data.db');
const LOG_PATH = join(DATA_DIR, 'daemon.log');

// Ensure data dir exists
mkdirSync(DATA_DIR, { recursive: true });

// ── Logging ────────────────────────────────────────────────────────────
// Rotating file log only — no stderr mirror (the launchd plist already routes
// the process's stderr to its own file; mirroring doubled every line and grew
// two 40MB copies). 10MB limit × 3 rotated files.

const MAX_LOG_BYTES = 10 * 1024 * 1024;
const LOG_KEEP = 3;

function rotateLogIfNeeded(): void {
  try {
    if (!existsSync(LOG_PATH) || statSync(LOG_PATH).size < MAX_LOG_BYTES) return;
    for (let i = LOG_KEEP - 1; i >= 1; i--) {
      const from = i === 1 ? LOG_PATH : `${LOG_PATH}.${i - 1}`;
      const to = `${LOG_PATH}.${i}`;
      if (existsSync(from)) renameSync(from, to);
    }
    appendFileSync(LOG_PATH, `[${new Date().toISOString()}] [INFO] Log rotated (10MB limit)\n`);
  } catch {
    /* best effort — rotation failing must never take the worker down */
  }
}

function log(level: 'INFO' | 'ERROR' | 'WARN', message: string): void {
  try {
    rotateLogIfNeeded();
    const line = `[${new Date().toISOString()}] [${level}] ${message}\n`;
    appendFileSync(LOG_PATH, line);
  } catch {
    /* disk full / EACCES — logging must never take the daemon down */
  }
}

function fmtBytes(n: number): string {
  return n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)}MB` : `${Math.round(n / 1024)}KB`;
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
      db.recordPoll(providerId, 'ok');
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
    // Poll failures were swallowed silently by the scheduler — log them
    // (throttled 5 min per provider so a hot 10s loop can't flood the log).
    onPollError: (() => {
      const lastLogged = new Map<string, number>();
      return (providerId: string, err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        db.recordPoll(providerId, 'error', msg);
        const now = Date.now();
        if (now - (lastLogged.get(providerId) ?? 0) < 300_000) return;
        lastLogged.set(providerId, now);
        log('ERROR', `[${providerId}] poll failed: ${msg}`);
      };
    })(),
  });

  scheduler.start();
  log('INFO', 'Scheduler started');

  // Embedded HTTPS API — web dashboard status/refresh, remote MCP clients.
  // TLS material (local CA + server cert) is generated on first boot; clients
  // pin the CA by fingerprint (logged below at startup).
  let apiServer: Server | null = null;
  try {
    const tls = ensureTlsConfig(defaultCertsDir());
    apiServer = await startApiServer({
      db,
      scheduler,
      host: appConfig.api.host,
      port: appConfig.api.port,
      token: appConfig.api.token,
      tls: { certPath: tls.certPath, keyPath: tls.keyPath, caPath: tls.caPath },
      // Streamable HTTP MCP at /mcp (stateless — one transport per request),
      // so harnesses on OTHER machines can query quota over the frp tunnel.
      // Local harnesses should prefer `quota-watch mcp` (stdio).
      mcpHandler: async (req, res, body) => {
        const server = createMcpServer(db);
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
        res.on('close', () => { void transport.close(); void server.close(); });
        await server.connect(transport);
        await transport.handleRequest(req, res, body as never);
        return true;
      },
    });
    log(
      'INFO',
      `API listening on https://${appConfig.api.host}:${appConfig.api.port} ` +
        `(CA fingerprint ${tls.caFingerprint.slice(0, 12)}…)`,
    );
  } catch (err) {
    // e.g. port already taken — polling still works, API just unavailable
    log('ERROR', `API server failed to start: ${err instanceof Error ? err.message : err}`);
  }

  // Poll immediately on startup instead of waiting for the first baseInterval
  // tick, so a freshly authenticated provider shows up without a 15-min wait.
  void scheduler.pollNow().then(() => {
    log('INFO', 'Initial poll complete');
  });

  // One-off full VACUUM on boot — reclaims space from the pre-throttle era
  // (87MB → ~25-30MB). WAL must be checkpointed first or VACUUM has nothing
  // to shrink.
  try {
    db.performMaintenance(30, 90);
    const before = statSync(DB_PATH).size;
    db.vacuum();
    const after = statSync(DB_PATH).size;
    log('INFO', `Startup maintenance: data.db ${fmtBytes(before)} → ${fmtBytes(after)}`);
  } catch (err) {
    log('WARN', `Startup maintenance skipped: ${err instanceof Error ? err.message : err}`);
  }

  // Remove the legacy pre-v2 database leftover. (daemon.pid is NOT a leftover —
  // the CLI's `daemon start` writes it and `daemon stop` reads it.)
  const legacyDb = join(DATA_DIR, 'quota-watch.db');
  if (existsSync(legacyDb)) {
    try {
      rmSync(legacyDb);
      log('INFO', 'Removed legacy file: quota-watch.db');
    } catch {
      /* best effort */
    }
  }

  // Hourly housekeeping: prune snapshots/alerts, checkpoint WAL, incremental
  // vacuum. Unref'd so it never keeps the process alive.
  setInterval(() => {
    try {
      db.performMaintenance(30, 90);
      log('INFO', 'Hourly maintenance complete');
    } catch (err) {
      log('ERROR', `Hourly maintenance failed: ${err instanceof Error ? err.message : err}`);
    }
  }, 60 * 60 * 1000).unref();

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
  // launchd KeepAlive=true: crashing out and letting launchd relaunch a clean
  // process beats surviving an uncaught exception in an unknown state.
  process.on('uncaughtException', (err) => {
    log('ERROR', `Uncaught: ${err.stack ?? err.message}`);
    process.exit(1);
  });
  process.on('unhandledRejection', (err) => {
    log('ERROR', `Unhandled rejection: ${err}`);
  });
}

// Without this catch, a main() rejection before the handlers above register is
// an invisible dead-on-arrival: CLI printed "started", launchd thinks it ran,
// nothing is polling.
main().catch((err) => {
  log('ERROR', `Fatal startup error: ${err instanceof Error ? (err.stack ?? err.message) : err}`);
  process.exit(1);
});
