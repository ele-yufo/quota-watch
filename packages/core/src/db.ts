import Database from "better-sqlite3";
import { existsSync, mkdirSync, chmodSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import type { ProviderConfig, UsageSnapshot } from "./types.js";
import { classifyWindowKind, type WindowKind } from "./windows.js";

export type { ProviderConfig, UsageSnapshot } from "./types.js";

/** One row of getLatestSnapshots — latest snapshot per provider×window. */
export interface LatestSnapshot {
  providerId: string;
  displayName: string;
  providerType: string;
  windowName: string;
  windowKind: WindowKind;
  used: number;
  total: number;
  unit: string;
  remainingPct: number;
  resetAt: string | null;
  timestamp: string;
}

// ── Versioned migrations (PRAGMA user_version) ──────────────────────────

const BASE_TABLES = [
  `CREATE TABLE IF NOT EXISTS providers (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    display_name TEXT NOT NULL,
    credentials TEXT NOT NULL,
    enabled INTEGER DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS quota_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    provider_id TEXT NOT NULL,
    window_name TEXT NOT NULL,
    used REAL NOT NULL,
    total REAL NOT NULL,
    unit TEXT NOT NULL,
    remaining_pct REAL NOT NULL,
    reset_at TEXT,
    FOREIGN KEY (provider_id) REFERENCES providers(id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_snapshots_ts ON quota_snapshots(timestamp)`,
  `CREATE INDEX IF NOT EXISTS idx_snapshots_provider ON quota_snapshots(provider_id, window_name, timestamp)`,
];

/**
 * Legacy → canonical window names, written before the naming convention
 * existed. Applied to snapshots so history stays attached to its windows
 * across the rename.
 */
const LEGACY_WINDOW_RENAMES: Record<string, string> = {
  "OpenCode Go 5h (5h)": "session (5h)",
  "OpenCode Go Weekly (Weekly)": "weekly (7d)",
  "OpenCode Go Monthly (Monthly)": "monthly (1mo)",
};

// ── Database class ──────────────────────────────────────────────────────

export class QuotaDB {
  private db: Database.Database;

  constructor(dbPath?: string) {
    const resolvedPath = dbPath ?? join(homedir(), '.quota-watch', 'data.db');
    const dir = dirname(resolvedPath);
    if (dir && !existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    this.db = new Database(resolvedPath);
    // tighten file perms — local single-user, but no reason to leave it world-readable
    try {
      chmodSync(resolvedPath, 0o600);
    } catch {
      /* best effort */
    }
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.migrate();
  }

  private migrate(): void {
    const version = this.db.pragma("user_version", { simple: true }) as number;

    if (version < 1) {
      for (const sql of BASE_TABLES) this.db.exec(sql);
      this.db.pragma("user_version = 1");
    }

    if (version < 2) {
      this.migrateToV2();
      this.db.pragma("user_version = 2");
    }

    if (version < 3) {
      this.migrateToV3();
      this.db.pragma("user_version = 3");
    }

    if (version < 4) {
      // last-poll bookkeeping. quota_snapshots is change-only, so its
      // timestamps say when a VALUE moved, not when the provider was last
      // polled — clients need the latter for freshness/staleness calls.
      this.db.exec(`CREATE TABLE IF NOT EXISTS provider_poll_state (
        provider_id TEXT PRIMARY KEY,
        last_poll_at TEXT NOT NULL,
        last_status TEXT NOT NULL,
        last_error TEXT
      )`);
      this.db.pragma("user_version = 4");
    }

    if (version < 5) {
      // Token-usage ledger feature removed (estimates proved too inaccurate to
      // be useful — cache-token extrapolation overstates burn). Drop its tables.
      this.db.exec(`DROP TABLE IF EXISTS token_events`);
      this.db.exec(`DROP TABLE IF EXISTS ingest_state`);
      this.db.pragma("user_version = 5");
    }

    if (version < 6) {
      // Alerting feature removed (rules + fire history + notifiers). Child
      // first: alert_history references alert_rules and foreign_keys is ON.
      this.db.exec(`DROP TABLE IF EXISTS alert_history`);
      this.db.exec(`DROP TABLE IF EXISTS alert_rules`);
      this.db.pragma("user_version = 6");
    }

    if (version < 7) {
      // remaining_pct is derived (used/total) but persisted; over-limit PAYG
      // rows written before the insert-time clamp can hold negatives. Repair
      // them once — dedup compares only used/total/unit/reset_at, so a stale
      // negative row would otherwise survive forever.
      this.db.exec(`UPDATE quota_snapshots
        SET remaining_pct = MIN(100, MAX(0, remaining_pct))
        WHERE remaining_pct < 0 OR remaining_pct > 100`);
      this.db.pragma("user_version = 7");
    }

    if (version < 8) {
      // Subscription tier as reported by the provider's own API (Claude
      // /api/oauth/profile, Codex usage plan_type). Stored per provider so
      // the dashboard shows a live plan label instead of a hand-typed name.
      // Column-existence guard: an ALTER is not idempotent — a crash between
      // the ALTER and the version bump would otherwise fail every boot with
      // "duplicate column name".
      const pollCols = this.db
        .prepare(`PRAGMA table_info(provider_poll_state)`)
        .all() as Array<{ name: string }>;
      if (!pollCols.some((c) => c.name === "plan")) {
        this.db.exec(`ALTER TABLE provider_poll_state ADD COLUMN plan TEXT`);
      }
      this.db.pragma("user_version = 8");
    }
  }

  /** v3: token-usage ledger fed by CLI session logs (token monitoring). */
  private migrateToV3(): void {
    this.db.exec(`CREATE TABLE IF NOT EXISTS token_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_id TEXT NOT NULL UNIQUE,
      provider TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      model TEXT,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      cache_read_tokens INTEGER NOT NULL DEFAULT 0,
      cache_write_tokens INTEGER NOT NULL DEFAULT 0,
      total_tokens INTEGER NOT NULL
    )`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_token_events_provider_ts ON token_events(provider, timestamp)`);
    // Incremental-scan bookmarks: session files are append-only, so a byte
    // offset per file is enough; source_id uniqueness is the crash guard.
    this.db.exec(`CREATE TABLE IF NOT EXISTS ingest_state (
      file_path TEXT PRIMARY KEY,
      offset INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    )`);
  }

  /** v2: window_kind column + legacy name normalization + kind backfill. */
  private migrateToV2(): void {
    const columns = this.db.pragma("table_info(quota_snapshots)") as Array<{ name: string }>;
    if (!columns.some((c) => c.name === "window_kind")) {
      this.db.exec(`ALTER TABLE quota_snapshots ADD COLUMN window_kind TEXT`);
    }

    const renameSnap = this.db.prepare(
      `UPDATE quota_snapshots SET window_name = ? WHERE window_name = ?`,
    );
    for (const [legacy, canonical] of Object.entries(LEGACY_WINDOW_RENAMES)) {
      renameSnap.run(canonical, legacy);
    }

    const names = this.db
      .prepare(`SELECT DISTINCT window_name FROM quota_snapshots WHERE window_kind IS NULL`)
      .all() as Array<{ window_name: string }>;
    const backfill = this.db.prepare(
      `UPDATE quota_snapshots SET window_kind = ? WHERE window_name = ? AND window_kind IS NULL`,
    );
    for (const { window_name } of names) {
      backfill.run(classifyWindowKind(window_name), window_name);
    }
  }

  /**
   * Delete snapshots older than the given number of days. The newest row of
   * every provider×window is always kept: a quiet channel that hasn't changed
   * in 30 days would otherwise lose its ONLY row (writes are change-only) and
   * vanish from the UI right after a perfectly successful poll.
   */
  cleanupOldData(daysToKeep: number = 30): number {
    const cutoff = new Date(Date.now() - daysToKeep * 86_400_000).toISOString();
    const result = this.db
      .prepare(`DELETE FROM quota_snapshots
                WHERE timestamp < ?
                  AND id NOT IN (
                    SELECT MAX(id) FROM quota_snapshots GROUP BY provider_id, window_name
                  )`)
      .run(cutoff);
    return result.changes;
  }

  /**
   * Hourly housekeeping: prune snapshots, then checkpoint the
   * WAL. Note: `incremental_vacuum` is intentionally NOT called — it's a no-op
   * unless `auto_vacuum=INCREMENTAL` was set before table creation, which this
   * DB never did; space is reclaimed by the one-off `vacuum()` at startup.
   */
  performMaintenance(daysToKeepSnapshots: number = 30): void {
    this.cleanupOldData(daysToKeepSnapshots);
    this.db.pragma('wal_checkpoint(TRUNCATE)');
  }

  /** Flush the WAL into the main db file (pre-rename / backup hygiene). */
  checkpointWal(): void {
    this.db.pragma('wal_checkpoint(TRUNCATE)');
  }

  /**
   * One-off full VACUUM (startup after a migration / long-unpruned DB).
   * Blocks the writer — only called from the daemon bootstrap, not the
   * maintenance loop.
   *
   * In WAL mode VACUUM's whole rewrite lands in the WAL first; without a
   * trailing checkpoint the shrunk pages stay stranded there (main file stays
   * big and a crash loses the vacuum's transaction). So: checkpoint →
   * VACUUM → checkpoint again.
   */
  vacuum(): void {
    this.db.pragma('wal_checkpoint(TRUNCATE)');
    this.db.exec('VACUUM');
    this.db.pragma('wal_checkpoint(TRUNCATE)');
  }

  close(): void {
    this.db.close();
  }

  // ── Provider CRUD ──────────────────────────────────────────────────

  upsertProvider(config: ProviderConfig): void {
    const stmt = this.db.prepare(`
      INSERT INTO providers (id, provider, display_name, credentials, enabled, created_at, updated_at)
      VALUES (@id, @provider, @displayName, @credentials, @enabled, @createdAt, @updatedAt)
      ON CONFLICT(id) DO UPDATE SET
        provider = @provider,
        display_name = @displayName,
        credentials = @credentials,
        enabled = @enabled,
        updated_at = @updatedAt
    `);
    stmt.run({
      id: config.id,
      provider: config.provider,
      displayName: config.displayName,
      credentials: JSON.stringify(config.credentials),
      enabled: config.enabled ? 1 : 0,
      createdAt: config.createdAt,
      updatedAt: config.updatedAt,
    });
  }

  getProvider(id: string): ProviderConfig | null {
    const row = this.db
      .prepare("SELECT * FROM providers WHERE id = ?")
      .get(id) as Record<string, unknown> | undefined;
    return row ? this.rowToProvider(row) : null;
  }

  /** Look up a provider by its slug (e.g. "codex", "claude") */
  getProviderBySlug(slug: string): ProviderConfig | null {
    const row = this.db
      .prepare("SELECT * FROM providers WHERE provider = ?")
      .get(slug) as Record<string, unknown> | undefined;
    return row ? this.rowToProvider(row) : null;
  }

  listProviders(): ProviderConfig[] {
    const rows = this.db
      .prepare("SELECT * FROM providers")
      .all() as Record<string, unknown>[];
    return rows.map((r) => this.rowToProvider(r));
  }

  deleteProvider(id: string): void {
    // FK children must go first (foreign_keys = ON, no ON DELETE CASCADE):
    // quota_snapshots, plus the un-FK'd provider_poll_state.
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM quota_snapshots WHERE provider_id = ?").run(id);
      this.db.prepare("DELETE FROM provider_poll_state WHERE provider_id = ?").run(id);
      this.db.prepare("DELETE FROM providers WHERE id = ?").run(id);
    })();
  }

  private rowToProvider(row: Record<string, unknown>): ProviderConfig {
    return {
      id: row.id as string,
      provider: row.provider as string,
      displayName: row.display_name as string,
      credentials: JSON.parse(row.credentials as string) as Record<string, string>,
      enabled: row.enabled === 1,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    };
  }

  // ── Snapshot CRUD ──────────────────────────────────────────────────

  /**
   * Write a snapshot — but only when it actually changed. Quota windows mostly
   * tick once per session/usage burst; at a 10-min poll cadence a no-change
   * write would inflate the table by ~26k rows/day with zero information.
   * Returns `true` when a row was written, `false` when the latest row for this
   * provider×window already matches (used/total/unit/reset_at).
   */
  insertSnapshot(snap: UsageSnapshot, providerId: string): boolean {
    // Clamp: over-limit PAYG accounts (usage > credits) would otherwise persist
    // a negative remaining_pct that renders as "-$2.00".
    const remainingPct =
      snap.total > 0
        ? Math.min(100, Math.max(0, ((snap.total - snap.used) / snap.total) * 100))
        : 0;

    const latest = this.db
      .prepare(
        `SELECT used, total, unit, window_kind, reset_at FROM quota_snapshots
         WHERE provider_id = ? AND window_name = ?
         ORDER BY id DESC LIMIT 1`
      )
      .get(providerId, snap.windowName) as { used: number; total: number; unit: string; window_kind: string | null; reset_at: string | null } | undefined;

    // reset_at compares at MINUTE granularity: some adapters can only parse
    // human text ("1 hour 56 minutes") floored to minutes, so their computed
    // reset instant drifts up to 59s between polls — exact comparison would
    // defeat change-only writes and write a row per poll per window.
    const resetMinute = (iso: string | null | undefined) => (iso ? iso.slice(0, 16) : null);
    const snapKind = snap.windowKind ?? classifyWindowKind(snap.windowName);
    if (latest && latest.used === snap.used && latest.total === snap.total
        && latest.unit === snap.unit
        && (latest.window_kind ?? null) === snapKind
        && resetMinute(latest.reset_at) === resetMinute(snap.resetAt ?? null)) {
      return false;
    }

    this.db
      .prepare(
        `INSERT INTO quota_snapshots (timestamp, provider_id, window_name, window_kind, used, total, unit, remaining_pct, reset_at)
         VALUES (@timestamp, @providerId, @windowName, @windowKind, @used, @total, @unit, @remainingPct, @resetAt)`
      )
      .run({
        timestamp: snap.timestamp,
        providerId,
        windowName: snap.windowName,
        windowKind: snap.windowKind ?? classifyWindowKind(snap.windowName),
        used: snap.used,
        total: snap.total,
        unit: snap.unit,
        remainingPct,
        resetAt: snap.resetAt,
      });
    return true;
  }

  /**
   * Delete snapshot rows for the named windows only. The scheduler calls this
   * after a window has been missing from consecutive successful polls (renamed
   * or retired upstream) — a blanket "delete everything not in the current
   * set" would erase history during transient adapter fallbacks.
   */
  pruneWindows(providerId: string, windowNames: string[]): void {
    if (windowNames.length === 0) return;
    const placeholders = windowNames.map(() => '?').join(',');
    this.db
      .prepare(
        `DELETE FROM quota_snapshots
         WHERE provider_id = ? AND window_name IN (${placeholders})`,
      )
      .run(providerId, ...windowNames);
  }

  /**
   * Record a poll attempt — the freshness signal. On success `plan` carries
   * the provider-reported subscription tier (null when this provider doesn't
   * report one; that CLEARS a stale label rather than keeping it). Errors
   * leave the previous plan untouched.
   */
  recordPoll(providerId: string, status: 'ok' | 'error', error?: string, plan?: string | null): void {
    if (status === 'ok') {
      this.db
        .prepare(
          `INSERT INTO provider_poll_state (provider_id, last_poll_at, last_status, last_error, plan)
           VALUES (?, ?, ?, NULL, ?)
           ON CONFLICT(provider_id) DO UPDATE SET
             last_poll_at = excluded.last_poll_at,
             last_status = excluded.last_status,
             last_error = NULL,
             plan = excluded.plan`,
        )
        .run(providerId, new Date().toISOString(), status, plan ?? null);
      return;
    }
    this.db
      .prepare(
        `INSERT INTO provider_poll_state (provider_id, last_poll_at, last_status, last_error, plan)
         VALUES (?, ?, ?, ?, NULL)
         ON CONFLICT(provider_id) DO UPDATE SET
           last_poll_at = excluded.last_poll_at,
           last_status = excluded.last_status,
           last_error = excluded.last_error`,
      )
      .run(providerId, new Date().toISOString(), status, error ?? null);
  }

  getPollState(providerId: string): { lastPollAt: string; lastStatus: string; lastError: string | null; plan: string | null } | null {
    const row = this.db
      .prepare(`SELECT last_poll_at AS lastPollAt, last_status AS lastStatus, last_error AS lastError, plan
                FROM provider_poll_state WHERE provider_id = ?`)
      .get(providerId) as { lastPollAt: string; lastStatus: string; lastError: string | null; plan: string | null } | undefined;
    return row ?? null;
  }

  getSnapshots(providerId: string, windowName: string, since: string): UsageSnapshot[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM quota_snapshots
         WHERE provider_id = ? AND window_name = ? AND timestamp >= ?
         ORDER BY timestamp ASC`
      )
      .all(providerId, windowName, since) as Record<string, unknown>[];
    return rows.map((r) => ({
      timestamp: r.timestamp as string,
      provider: r.provider_id as string,
      account: "",
      windowName: r.window_name as string,
      windowKind: this.rowKind(r),
      used: r.used as number,
      total: r.total as number,
      unit: r.unit as string,
      resetAt: (r.reset_at as string) ?? null,
    }));
  }

  /** Latest snapshot row per provider+window (for status display) */
  getLatestSnapshots(providerId?: string): LatestSnapshot[] {
    const sql = `
      SELECT s.provider_id, p.display_name, p.provider as provider_type,
             s.window_name, s.window_kind, s.used, s.total, s.unit, s.remaining_pct, s.reset_at, s.timestamp
      FROM quota_snapshots s
      JOIN providers p ON s.provider_id = p.id
      WHERE s.id IN (
        SELECT MAX(id) FROM quota_snapshots
        ${providerId ? 'WHERE provider_id = ?' : ''}
        GROUP BY provider_id, window_name
      )
      ORDER BY p.display_name, s.window_name
    `;
    const params: unknown[] = providerId ? [providerId] : [];
    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map((r) => ({
      providerId: r.provider_id as string,
      displayName: r.display_name as string,
      providerType: r.provider_type as string,
      windowName: r.window_name as string,
      windowKind: this.rowKind(r),
      used: r.used as number,
      total: r.total as number,
      unit: r.unit as string,
      remainingPct: r.remaining_pct as number,
      resetAt: (r.reset_at as string) ?? null,
      timestamp: r.timestamp as string,
    }));
  }

  private rowKind(r: Record<string, unknown>): WindowKind {
    return typeof r.window_kind === "string" && r.window_kind
      ? (r.window_kind as WindowKind)
      : classifyWindowKind(r.window_name as string);
  }
}
