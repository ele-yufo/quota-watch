import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { QuotaDB } from '../src/db.js';

/**
 * v2 migration: legacy DBs (user_version 0, no window_kind column) must come
 * out with the column added, legacy OpenCode window names normalized in both
 * snapshots and alert rules, and kinds backfilled from names.
 */

let dir: string;
let dbPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'qw-migration-'));
  dbPath = join(dir, 'data.db');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function seedLegacyDb(): void {
  const raw = new Database(dbPath);
  raw.exec(`
    CREATE TABLE providers (
      id TEXT PRIMARY KEY, provider TEXT NOT NULL, display_name TEXT NOT NULL,
      credentials TEXT NOT NULL, enabled INTEGER DEFAULT 1,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE quota_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp TEXT NOT NULL,
      provider_id TEXT NOT NULL, window_name TEXT NOT NULL,
      used REAL NOT NULL, total REAL NOT NULL, unit TEXT NOT NULL,
      remaining_pct REAL NOT NULL, reset_at TEXT
    );
    CREATE TABLE alert_rules (
      id TEXT PRIMARY KEY, provider_id TEXT NOT NULL, window_name TEXT NOT NULL,
      threshold_pct REAL NOT NULL, channels TEXT NOT NULL,
      cooldown_ms INTEGER NOT NULL DEFAULT 3600000, enabled INTEGER DEFAULT 1
    );
    CREATE TABLE alert_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT, rule_id TEXT NOT NULL,
      fired_at TEXT NOT NULL, provider_id TEXT NOT NULL, window_name TEXT NOT NULL,
      remaining_pct REAL NOT NULL, message TEXT NOT NULL
    );
    INSERT INTO providers VALUES
      ('oc-1', 'opencode-go', 'OpenCode Go', '{}', 1, '2026-01-01', '2026-01-01'),
      ('cl-1', 'claude', 'Claude', '{}', 1, '2026-01-01', '2026-01-01');
    INSERT INTO quota_snapshots (timestamp, provider_id, window_name, used, total, unit, remaining_pct, reset_at) VALUES
      ('2026-07-01T00:00:00Z', 'oc-1', 'OpenCode Go 5h (5h)', 10, 100, 'percent', 90, NULL),
      ('2026-07-01T00:00:00Z', 'oc-1', 'OpenCode Go Weekly (Weekly)', 37, 100, 'percent', 63, NULL),
      ('2026-07-01T00:00:00Z', 'oc-1', 'OpenCode Go Monthly (Monthly)', 18, 100, 'percent', 82, NULL),
      ('2026-07-01T00:00:00Z', 'cl-1', 'session (5h)', 42, 100, 'percent', 58, NULL),
      ('2026-07-01T00:00:00Z', 'cl-1', 'weekly (7d)', 55, 100, 'percent', 45, NULL);
    INSERT INTO alert_rules VALUES
      ('rule-1', 'oc-1', 'OpenCode Go Weekly (Weekly)', 10, '["macos_notification"]', 3600000, 1);
  `);
  raw.close();
}

describe('QuotaDB v2 migration', () => {
  it('renames legacy OpenCode window names and backfills kinds', () => {
    seedLegacyDb();
    const db = new QuotaDB(dbPath);

    const latest = db.getLatestSnapshots('oc-1');
    const byName = new Map(latest.map((s) => [s.windowName, s]));
    expect([...byName.keys()].sort()).toEqual(['monthly (1mo)', 'session (5h)', 'weekly (7d)']);
    expect(byName.get('session (5h)')!.windowKind).toBe('session');
    expect(byName.get('weekly (7d)')!.windowKind).toBe('week');
    expect(byName.get('monthly (1mo)')!.windowKind).toBe('month');

    // alert rules follow the rename so they stay attached
    const rules = db.getAlertRules('oc-1');
    expect(rules[0]!.windowName).toBe('weekly (7d)');

    // untouched provider windows just get kinds backfilled
    const claude = db.getLatestSnapshots('cl-1');
    expect(claude.map((s) => s.windowKind).sort()).toEqual(['session', 'week']);
    db.close();
  });

  it('is idempotent — reopening an already-migrated DB changes nothing', () => {
    seedLegacyDb();
    new QuotaDB(dbPath).close();
    const db = new QuotaDB(dbPath);
    expect(db.getLatestSnapshots('oc-1')).toHaveLength(3);
    db.close();
  });

  it('fresh DBs write window_kind directly and read it back', () => {
    const db = new QuotaDB(dbPath);
    db.upsertProvider({
      id: 'x-1', provider: 'codex', displayName: 'Codex', credentials: {},
      enabled: true, createdAt: '2026-01-01', updatedAt: '2026-01-01',
    });
    db.insertSnapshot(
      {
        timestamp: '2026-07-02T00:00:00Z', provider: 'codex', account: 'x-1',
        windowName: 'weekly (7d)', windowKind: 'week',
        used: 12, total: 100, unit: 'percent', resetAt: null,
      },
      'x-1',
    );
    const [snap] = db.getLatestSnapshots('x-1');
    expect(snap!.windowKind).toBe('week');
    db.close();
  });
});
