import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { QuotaDB } from "../src/db.js";
import type { ProviderConfig, UsageSnapshot, AlertRule } from "../src/db.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unlinkSync, existsSync } from "node:fs";

function tmpDbPath(): string {
  return join(tmpdir(), `qw-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

describe("QuotaDB", () => {
  let dbPath: string;
  let db: QuotaDB;

  beforeEach(() => {
    dbPath = tmpDbPath();
    db = new QuotaDB(dbPath);
  });

  afterEach(() => {
    db.close();
    if (existsSync(dbPath)) unlinkSync(dbPath);
  });

  // ── helpers ──────────────────────────────────────────────────────

  const now = () => new Date().toISOString();

  const makeProvider = (overrides?: Partial<ProviderConfig>): ProviderConfig => ({
    id: "openai-main",
    provider: "openai",
    displayName: "OpenAI Main",
    credentials: { apiKey: "***" },
    enabled: true,
    createdAt: now(),
    updatedAt: now(),
    ...overrides,
  });

  const makeSnapshot = (overrides?: Partial<UsageSnapshot>): UsageSnapshot => ({
    timestamp: now(),
    provider: "openai",
    account: "main",
    windowName: "daily",
    used: 50,
    total: 100,
    unit: "requests",
    ...overrides,
  });

  const makeRule = (overrides?: Partial<AlertRule>): AlertRule => ({
    id: "rule-1",
    provider: "openai-main",
    windowName: "daily",
    thresholdPct: 20,
    channels: ["slack", "email"],
    cooldownMs: 3600000,
    enabled: true,
    ...overrides,
  });

  // ── DB creation & migration ──────────────────────────────────────

  it("creates a database file", () => {
    expect(existsSync(dbPath)).toBe(true);
  });

  it("runs migrations without error on a fresh DB", () => {
    // constructor already ran migrations; re-opening proves tables persist
    db.close();
    const db2 = new QuotaDB(dbPath);
    const providers = db2.listProviders();
    expect(providers).toEqual([]);
    db2.close();
    // re-open so afterEach close() works
    db = new QuotaDB(dbPath);
  });

  // ── Provider CRUD ────────────────────────────────────────────────

  it("upserts and retrieves a provider", () => {
    const p = makeProvider();
    db.upsertProvider(p);

    const fetched = db.getProvider("openai-main");
    expect(fetched).toEqual(p);
  });

  it("returns null for missing provider", () => {
    expect(db.getProvider("nonexistent")).toBeNull();
  });

  it("lists all providers", () => {
    db.upsertProvider(makeProvider({ id: "p1" }));
    db.upsertProvider(makeProvider({ id: "p2", displayName: "Second" }));

    const all = db.listProviders();
    expect(all).toHaveLength(2);
    expect(all.map((p) => p.id)).toContain("p1");
    expect(all.map((p) => p.id)).toContain("p2");
  });

  it("updates a provider on upsert", () => {
    db.upsertProvider(makeProvider());
    db.upsertProvider(makeProvider({ displayName: "Updated Name", updatedAt: now() }));

    const fetched = db.getProvider("openai-main");
    expect(fetched!.displayName).toBe("Updated Name");
    expect(db.listProviders()).toHaveLength(1);
  });

  it("deletes a provider", () => {
    db.upsertProvider(makeProvider());
    db.deleteProvider("openai-main");
    expect(db.getProvider("openai-main")).toBeNull();
  });

  // ── Snapshot insert & query ──────────────────────────────────────

  it("inserts and queries snapshots", () => {
    // Create the provider first (FK constraint)
    db.upsertProvider(makeProvider({ id: "prov-1" }));

    const ts1 = "2026-06-30T10:00:00.000Z";
    const ts2 = "2026-06-30T11:00:00.000Z";

    db.insertSnapshot(makeSnapshot({ timestamp: ts1, used: 30 }), "prov-1");
    db.insertSnapshot(makeSnapshot({ timestamp: ts2, used: 60 }), "prov-1");

    const snaps = db.getSnapshots("prov-1", "daily", ts1);
    expect(snaps).toHaveLength(2);
    expect(snaps[0].used).toBe(30);
    expect(snaps[1].used).toBe(60);
  });

  it("filters snapshots by since", () => {
    db.upsertProvider(makeProvider({ id: "p1" }));

    db.insertSnapshot(makeSnapshot({ timestamp: "2026-06-30T10:00:00.000Z", used: 30 }), "p1");
    db.insertSnapshot(makeSnapshot({ timestamp: "2026-06-30T12:00:00.000Z", used: 60 }), "p1");

    const snaps = db.getSnapshots("p1", "daily", "2026-06-30T11:00:00.000Z");
    expect(snaps).toHaveLength(1);
    expect(snaps[0].used).toBe(60);
  });

  it("filters snapshots by provider and window", () => {
    db.upsertProvider(makeProvider({ id: "p1" }));
    db.upsertProvider(makeProvider({ id: "p2", displayName: "Provider 2" }));

    db.insertSnapshot(makeSnapshot({ windowName: "daily" }), "p1");
    db.insertSnapshot(makeSnapshot({ windowName: "monthly" }), "p1");
    db.insertSnapshot(makeSnapshot({ windowName: "daily" }), "p2");

    expect(db.getSnapshots("p1", "daily", "2000-01-01")).toHaveLength(1);
    expect(db.getSnapshots("p1", "monthly", "2000-01-01")).toHaveLength(1);
    expect(db.getSnapshots("p2", "daily", "2000-01-01")).toHaveLength(1);
  });

  // ── Alert rule CRUD ──────────────────────────────────────────────

  it("adds and retrieves alert rules", () => {
    db.upsertProvider(makeProvider({ id: "openai-main" }));

    const rule = makeRule();
    db.addAlertRule(rule);

    const rules = db.getAlertRules();
    expect(rules).toHaveLength(1);
    expect(rules[0]).toEqual(rule);
  });

  it("retrieves rules filtered by provider", () => {
    db.upsertProvider(makeProvider({ id: "openai-main" }));
    db.upsertProvider(makeProvider({ id: "anthropic-main", provider: "anthropic", displayName: "Anthropic" }));

    db.addAlertRule(makeRule({ id: "r1", provider: "openai-main" }));
    db.addAlertRule(makeRule({ id: "r2", provider: "anthropic-main" }));

    const filtered = db.getAlertRules("openai-main");
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe("r1");
  });

  it("deletes an alert rule", () => {
    db.upsertProvider(makeProvider({ id: "openai-main" }));
    db.addAlertRule(makeRule());
    db.deleteAlertRule("rule-1");
    expect(db.getAlertRules()).toHaveLength(0);
  });

  it("upserts alert rule (INSERT OR REPLACE)", () => {
    db.upsertProvider(makeProvider({ id: "openai-main" }));
    db.addAlertRule(makeRule({ thresholdPct: 20 }));
    db.addAlertRule(makeRule({ thresholdPct: 10 }));

    const rules = db.getAlertRules();
    expect(rules).toHaveLength(1);
    expect(rules[0].thresholdPct).toBe(10);
  });

  // ── Alert cooldown logic ─────────────────────────────────────────

  // Helper: ensure rule-1 exists for FK references
  function ensureRule1() {
    db.upsertProvider(makeProvider()); // creates "openai-main"
    db.addAlertRule(makeRule({ id: "rule-1" })); // references "openai-main"
  }

  it("allows alert when no prior history exists", () => {
    ensureRule1();
    expect(db.shouldFireAlert("rule-1", 3600000)).toBe(true);
  });

  it("blocks alert within cooldown window", () => {
    db.upsertProvider(makeProvider({ id: "openai-main" }));
    ensureRule1();
    db.recordAlert("rule-1", "openai-main", "daily", 15, "Quota at 15%");
    expect(db.shouldFireAlert("rule-1", 3600000)).toBe(false);
  });

  it("allows alert after cooldown expires", () => {
    db.upsertProvider(makeProvider({ id: "openai-main" }));
    ensureRule1();
    // Record an alert now
    db.recordAlert("rule-1", "openai-main", "daily", 10, "old alert");
    // shouldFireAlert should return false immediately
    expect(db.shouldFireAlert("rule-1", 3600000)).toBe(false);
    // But with cooldown of 0 it should fire (no cooldown)
    expect(db.shouldFireAlert("rule-1", 0)).toBe(true);
  });

  it("records alerts correctly", () => {
    db.upsertProvider(makeProvider({ id: "openai-main" }));
    ensureRule1();

    // No prior alerts => should fire
    expect(db.shouldFireAlert("rule-1", 3600000)).toBe(true);

    db.recordAlert("rule-1", "openai-main", "daily", 8, "Critical: 8% remaining");

    // After recording, should be blocked by cooldown
    expect(db.shouldFireAlert("rule-1", 3600000)).toBe(false);

    // Multiple records still block
    db.recordAlert("rule-1", "openai-main", "daily", 5, "Even lower");
    expect(db.shouldFireAlert("rule-1", 3600000)).toBe(false);
  });
});
