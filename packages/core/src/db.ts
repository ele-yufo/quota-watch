import Database from "better-sqlite3";
import { existsSync, mkdirSync, chmodSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import type { AlertRule, AlertChannel, ProviderConfig, UsageSnapshot } from "./types.js";
import { classifyWindowKind, type WindowKind } from "./windows.js";

export type { ProviderConfig, UsageSnapshot, AlertRule } from "./types.js";

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
  `CREATE TABLE IF NOT EXISTS alert_rules (
    id TEXT PRIMARY KEY,
    provider_id TEXT NOT NULL,
    window_name TEXT NOT NULL,
    threshold_pct REAL NOT NULL,
    channels TEXT NOT NULL,
    cooldown_ms INTEGER NOT NULL DEFAULT 3600000,
    enabled INTEGER DEFAULT 1,
    FOREIGN KEY (provider_id) REFERENCES providers(id)
  )`,
  `CREATE TABLE IF NOT EXISTS alert_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rule_id TEXT NOT NULL,
    fired_at TEXT NOT NULL,
    provider_id TEXT NOT NULL,
    window_name TEXT NOT NULL,
    remaining_pct REAL NOT NULL,
    message TEXT NOT NULL,
    FOREIGN KEY (rule_id) REFERENCES alert_rules(id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_snapshots_ts ON quota_snapshots(timestamp)`,
  `CREATE INDEX IF NOT EXISTS idx_snapshots_provider ON quota_snapshots(provider_id, window_name, timestamp)`,
  `CREATE INDEX IF NOT EXISTS idx_alerts_rule ON alert_history(rule_id, fired_at)`,
];

/**
 * Legacy → canonical window names, written before the naming convention
 * existed. Applied to snapshots AND alert rules so history + rules stay
 * attached to their windows across the rename.
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
    const renameRule = this.db.prepare(
      `UPDATE alert_rules SET window_name = ? WHERE window_name = ?`,
    );
    for (const [legacy, canonical] of Object.entries(LEGACY_WINDOW_RENAMES)) {
      renameSnap.run(canonical, legacy);
      renameRule.run(canonical, legacy);
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

  /** Delete snapshots older than the given number of days. */
  cleanupOldData(daysToKeep: number = 30): number {
    const cutoff = new Date(Date.now() - daysToKeep * 86_400_000).toISOString();
    const result = this.db
      .prepare('DELETE FROM quota_snapshots WHERE timestamp < ?')
      .run(cutoff);
    return result.changes;
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
    this.db.prepare("DELETE FROM providers WHERE id = ?").run(id);
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

  insertSnapshot(snap: UsageSnapshot, providerId: string): void {
    const remainingPct = snap.total > 0 ? ((snap.total - snap.used) / snap.total) * 100 : 0;
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

  // ── Alert rule CRUD ────────────────────────────────────────────────

  addAlertRule(rule: AlertRule): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO alert_rules (id, provider_id, window_name, threshold_pct, channels, cooldown_ms, enabled)
         VALUES (@id, @providerId, @windowName, @thresholdPct, @channels, @cooldownMs, @enabled)`
      )
      .run({
        id: rule.id,
        providerId: rule.provider,
        windowName: rule.windowName,
        thresholdPct: rule.thresholdPct,
        channels: JSON.stringify(rule.channels),
        cooldownMs: rule.cooldownMs,
        enabled: rule.enabled ? 1 : 0,
      });
  }

  getAlertRules(providerId?: string): AlertRule[] {
    let sql = "SELECT * FROM alert_rules";
    const params: unknown[] = [];
    if (providerId) {
      sql += " WHERE provider_id = ?";
      params.push(providerId);
    }
    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: r.id as string,
      provider: r.provider_id as string,
      windowName: r.window_name as string,
      thresholdPct: r.threshold_pct as number,
      channels: JSON.parse(r.channels as string) as AlertChannel[],
      cooldownMs: r.cooldown_ms as number,
      enabled: r.enabled === 1,
    }));
  }

  deleteAlertRule(id: string): void {
    this.db.prepare("DELETE FROM alert_rules WHERE id = ?").run(id);
  }

  // ── Alert history / cooldown ───────────────────────────────────────

  shouldFireAlert(ruleId: string, cooldownMs: number): boolean {
    const row = this.db
      .prepare(
        `SELECT fired_at FROM alert_history
         WHERE rule_id = ?
         ORDER BY fired_at DESC
         LIMIT 1`
      )
      .get(ruleId) as { fired_at: string } | undefined;
    if (!row) return true;
    const lastFired = new Date(row.fired_at).getTime();
    return Date.now() - lastFired >= cooldownMs;
  }

  recordAlert(
    ruleId: string,
    providerId: string,
    windowName: string,
    remainingPct: number,
    message: string,
  ): void {
    this.db
      .prepare(
        `INSERT INTO alert_history (rule_id, fired_at, provider_id, window_name, remaining_pct, message)
         VALUES (@ruleId, @firedAt, @providerId, @windowName, @remainingPct, @message)`
      )
      .run({
        ruleId,
        firedAt: new Date().toISOString(),
        providerId,
        windowName,
        remainingPct,
        message,
      });
  }
}
