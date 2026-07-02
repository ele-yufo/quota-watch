import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QuotaScheduler } from '../src/scheduler.js';
import type { SchedulerConfig } from '../src/scheduler.js';
import type { ProviderAdapter } from '../src/providers/types.js';
import type { ProviderRegistry } from '../src/providers/index.js';
import type { QuotaDB } from '../src/db.js';
import type { ProviderConfig, ProviderQuota, AlertRule } from '../src/types.js';

// ── Helpers ────────────────────────────────────────────────────────────

function makeProviderConfig(overrides?: Partial<ProviderConfig>): ProviderConfig {
  return {
    id: 'test-provider',
    provider: 'test',
    displayName: 'Test Provider',
    credentials: { apiKey: 'test' },
    enabled: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeQuota(used: number, total = 100): ProviderQuota {
  return {
    provider: 'test',
    account: 'test',
    plan: 'free',
    status: 'ok',
    windows: [
      {
        name: 'daily',
        used,
        total,
        unit: 'tokens',
        remaining: total - used,
        remainingPct: total > 0 ? ((total - used) / total) * 100 : 0,
        resetAt: null,
        unlimited: false,
      },
    ],
    fetchedAt: new Date().toISOString(),
  };
}

function makeMockAdapter(quotaValues: ProviderQuota[]): ProviderAdapter {
  let callIndex = 0;
  return {
    id: 'test',
    displayName: 'Test',
    async fetchQuota(_config: ProviderConfig): Promise<ProviderQuota> {
      const quota = quotaValues[callIndex] ?? quotaValues[quotaValues.length - 1]!;
      callIndex++;
      return quota;
    },
  };
}

function makeMockRegistry(adapter: ProviderAdapter): ProviderRegistry {
  return {
    register() {},
    get(_id: string) { return adapter; },
    list() { return [adapter.id]; },
    has(_id: string) { return true; },
  } as unknown as ProviderRegistry;
}

function makeMockDb(
  providers: ProviderConfig[] = [],
  alertRules: AlertRule[] = [],
): QuotaDB & { snapshots: Array<{ snap: unknown; providerId: string }> } {
  const db = {
    snapshots: [] as Array<{ snap: unknown; providerId: string }>,
    listProviders() { return providers; },
    getProvider(id: string) { return providers.find((p) => p.id === id) ?? null; },
    insertSnapshot(snap: unknown, providerId: string) {
      db.snapshots.push({ snap, providerId });
    },
    getAlertRules(_providerId?: string) { return alertRules; },
  } as unknown as QuotaDB & { snapshots: Array<{ snap: unknown; providerId: string }> };
  return db;
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('QuotaScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── Basic lifecycle ───────────────────────────────────────────────

  it('starts and stops cleanly', () => {
    const adapter = makeMockAdapter([makeQuota(50)]);
    const registry = makeMockRegistry(adapter);
    const db = makeMockDb([makeProviderConfig()]);

    const scheduler = new QuotaScheduler({ registry, db });
    expect(scheduler.isRunning()).toBe(false);

    scheduler.start();
    expect(scheduler.isRunning()).toBe(true);

    scheduler.stop();
    expect(scheduler.isRunning()).toBe(false);
  });

  it('is idempotent — calling start() twice does nothing', () => {
    const adapter = makeMockAdapter([makeQuota(50)]);
    const registry = makeMockRegistry(adapter);
    const db = makeMockDb([makeProviderConfig()]);

    const scheduler = new QuotaScheduler({ registry, db });
    scheduler.start();
    scheduler.start(); // should be a no-op
    expect(scheduler.isRunning()).toBe(true);
    scheduler.stop();
  });

  it('stop() when not running is safe', () => {
    const adapter = makeMockAdapter([makeQuota(50)]);
    const registry = makeMockRegistry(adapter);
    const db = makeMockDb();

    const scheduler = new QuotaScheduler({ registry, db });
    scheduler.stop(); // no-op
    expect(scheduler.isRunning()).toBe(false);
  });

  // ── pollNow ───────────────────────────────────────────────────────

  it('pollNow() triggers immediate fetch', async () => {
    const quota = makeQuota(50);
    const adapter = makeMockAdapter([quota]);
    const registry = makeMockRegistry(adapter);
    const db = makeMockDb([makeProviderConfig()]);
    const onQuotaFetched = vi.fn();

    const scheduler = new QuotaScheduler({ registry, db, onQuotaFetched });
    await scheduler.pollNow('test-provider');

    expect(onQuotaFetched).toHaveBeenCalledWith('test-provider', expect.objectContaining({ provider: 'test' }));
    expect(db.snapshots).toHaveLength(1);
  });

  it('pollNow() without argument polls all enabled providers', async () => {
    const adapter = makeMockAdapter([makeQuota(50)]);
    const registry = makeMockRegistry(adapter);
    const db = makeMockDb([
      makeProviderConfig({ id: 'p1' }),
      makeProviderConfig({ id: 'p2', displayName: 'P2' }),
    ]);
    const onQuotaFetched = vi.fn();

    const scheduler = new QuotaScheduler({ registry, db, onQuotaFetched });
    await scheduler.pollNow();

    expect(onQuotaFetched).toHaveBeenCalledTimes(2);
  });

  // ── Periodic polling ──────────────────────────────────────────────

  it('polls providers on interval', async () => {
    const quota = makeQuota(50);
    const adapter = makeMockAdapter([quota, quota, quota]);
    const registry = makeMockRegistry(adapter);
    const db = makeMockDb([makeProviderConfig()]);
    const onQuotaFetched = vi.fn();

    const scheduler = new QuotaScheduler({
      registry,
      db,
      onQuotaFetched,
      baseIntervalMs: 1000,
    });
    scheduler.start();

    // After first interval
    await vi.advanceTimersByTimeAsync(1000);
    expect(onQuotaFetched).toHaveBeenCalledTimes(1);

    // After second interval
    await vi.advanceTimersByTimeAsync(1000);
    expect(onQuotaFetched).toHaveBeenCalledTimes(2);

    scheduler.stop();
  });

  // ── Adaptive interval: active ────────────────────────────────────

  it('switches to activeIntervalMs when usage changes', async () => {
    const quota1 = makeQuota(50);
    const quota2 = makeQuota(60); // changed usage
    const quota3 = makeQuota(70); // changed again

    const adapter = makeMockAdapter([quota1, quota2, quota3]);
    const registry = makeMockRegistry(adapter);
    const db = makeMockDb([makeProviderConfig()]);

    const scheduler = new QuotaScheduler({
      registry,
      db,
      baseIntervalMs: 1000,
      activeIntervalMs: 500,
      idleIntervalMs: 3000,
    });
    scheduler.start();

    // First poll (at baseInterval)
    await vi.advanceTimersByTimeAsync(1000);
    expect(scheduler.getIntervalMs('test-provider')).toBe(1000); // only 1 data point, stays at base

    // Second poll — usage changed → activeInterval
    await vi.advanceTimersByTimeAsync(1000);
    expect(scheduler.getIntervalMs('test-provider')).toBe(500);

    // Third poll fires at activeInterval (500ms)
    await vi.advanceTimersByTimeAsync(500);
    // usage changed again → stays active
    expect(scheduler.getIntervalMs('test-provider')).toBe(500);

    scheduler.stop();
  });

  // ── Adaptive interval: idle ──────────────────────────────────────

  it('switches to idleIntervalMs after 3 unchanged polls', async () => {
    const quota = makeQuota(50);
    // Provide enough quota objects: 4 polls total (first 3 at base, then check idle)
    const adapter = makeMockAdapter([quota, quota, quota, quota]);
    const registry = makeMockRegistry(adapter);
    const db = makeMockDb([makeProviderConfig()]);

    const scheduler = new QuotaScheduler({
      registry,
      db,
      baseIntervalMs: 1000,
      activeIntervalMs: 500,
      idleIntervalMs: 3000,
    });
    scheduler.start();

    // Poll 1 (base)
    await vi.advanceTimersByTimeAsync(1000);
    expect(scheduler.getIntervalMs('test-provider')).toBe(1000);

    // Poll 2 — same usage, not enough for idle yet → base
    await vi.advanceTimersByTimeAsync(1000);
    expect(scheduler.getIntervalMs('test-provider')).toBe(1000);

    // Poll 3 — same usage, 3 consecutive same values → idle
    await vi.advanceTimersByTimeAsync(1000);
    expect(scheduler.getIntervalMs('test-provider')).toBe(3000);

    scheduler.stop();
  });

  // ── Adaptive interval: alert ─────────────────────────────────────

  it('switches to alertIntervalMs when alert rule is triggered', async () => {
    // Window with 90% used → remainingPct = 10%, below 20% threshold
    const quota = makeQuota(90, 100);
    const adapter = makeMockAdapter([quota, quota]);
    const registry = makeMockRegistry(adapter);

    const alertRule: AlertRule = {
      id: 'rule-1',
      provider: 'test-provider',
      windowName: 'daily',
      thresholdPct: 20,
      channels: ['macos_notification'],
      cooldownMs: 3600000,
      enabled: true,
    };
    const db = makeMockDb([makeProviderConfig()], [alertRule]);

    const scheduler = new QuotaScheduler({
      registry,
      db,
      baseIntervalMs: 1000,
      alertIntervalMs: 200,
    });
    scheduler.start();

    // First poll — alert condition → alertInterval
    await vi.advanceTimersByTimeAsync(1000);
    expect(scheduler.getIntervalMs('test-provider')).toBe(200);

    scheduler.stop();
  });

  // ── onQuotaFetched callback ──────────────────────────────────────

  it('calls onQuotaFetched for each successful poll', async () => {
    const quota = makeQuota(50);
    const adapter = makeMockAdapter([quota, quota]);
    const registry = makeMockRegistry(adapter);
    const db = makeMockDb([makeProviderConfig()]);
    const onQuotaFetched = vi.fn();

    const scheduler = new QuotaScheduler({
      registry,
      db,
      onQuotaFetched,
      baseIntervalMs: 1000,
    });
    scheduler.start();

    await vi.advanceTimersByTimeAsync(1000);
    expect(onQuotaFetched).toHaveBeenCalledTimes(1);
    expect(onQuotaFetched).toHaveBeenCalledWith(
      'test-provider',
      expect.objectContaining({ provider: 'test', status: 'ok' }),
    );

    scheduler.stop();
  });

  it('does not call onQuotaFetched when adapter throws', async () => {
    const adapter: ProviderAdapter = {
      id: 'test',
      displayName: 'Test',
      async fetchQuota() { throw new Error('network down'); },
    };
    const registry = makeMockRegistry(adapter);
    const db = makeMockDb([makeProviderConfig()]);
    const onQuotaFetched = vi.fn();

    const scheduler = new QuotaScheduler({
      registry,
      db,
      onQuotaFetched,
      baseIntervalMs: 1000,
    });
    scheduler.start();

    await vi.advanceTimersByTimeAsync(1000);
    expect(onQuotaFetched).not.toHaveBeenCalled();
    expect(db.snapshots).toHaveLength(0);

    scheduler.stop();
  });

  // ── Disabled providers are skipped ───────────────────────────────

  it('does not schedule disabled providers', () => {
    const adapter = makeMockAdapter([makeQuota(50)]);
    const registry = makeMockRegistry(adapter);
    const db = makeMockDb([makeProviderConfig({ enabled: false })]);
    const onQuotaFetched = vi.fn();

    const scheduler = new QuotaScheduler({
      registry,
      db,
      onQuotaFetched,
      baseIntervalMs: 1000,
    });
    scheduler.start();

    // advance past base interval — no poll should happen
    void vi.advanceTimersByTimeAsync(1000);
    expect(onQuotaFetched).not.toHaveBeenCalled();

    scheduler.stop();
  });

  // ── pollNow skips unknown/disabled providers ─────────────────────

  it('pollNow for unknown provider does nothing', async () => {
    const adapter = makeMockAdapter([makeQuota(50)]);
    const registry = makeMockRegistry(adapter);
    const db = makeMockDb([]); // no providers registered
    const onQuotaFetched = vi.fn();

    const scheduler = new QuotaScheduler({ registry, db, onQuotaFetched });
    await scheduler.pollNow('nonexistent');

    expect(onQuotaFetched).not.toHaveBeenCalled();
  });

  // ── getIntervalMs returns base when not started ──────────────────

  it('getIntervalMs returns baseIntervalMs before start', () => {
    const adapter = makeMockAdapter([makeQuota(50)]);
    const registry = makeMockRegistry(adapter);
    const db = makeMockDb();

    const scheduler = new QuotaScheduler({ registry, db, baseIntervalMs: 1234 });
    expect(scheduler.getIntervalMs('any-id')).toBe(1234);
  });

  // ── Interval transition from active → idle ───────────────────────

  it('transitions from active to idle when usage stabilizes', async () => {
    const quota1 = makeQuota(50);
    const quota2 = makeQuota(60); // change → active
    const quota3 = makeQuota(60); // same → need one more
    const quota4 = makeQuota(60); // same → 3 consecutive same → idle

    const adapter = makeMockAdapter([quota1, quota2, quota3, quota4]);
    const registry = makeMockRegistry(adapter);
    const db = makeMockDb([makeProviderConfig()]);

    const scheduler = new QuotaScheduler({
      registry,
      db,
      baseIntervalMs: 1000,
      activeIntervalMs: 500,
      idleIntervalMs: 3000,
    });
    scheduler.start();

    // Poll 1 (base) — 50
    await vi.advanceTimersByTimeAsync(1000);
    expect(scheduler.getIntervalMs('test-provider')).toBe(1000);

    // Poll 2 — 60 (changed from 50) → active
    await vi.advanceTimersByTimeAsync(1000);
    expect(scheduler.getIntervalMs('test-provider')).toBe(500);

    // Poll 3 — 60 (same) → only 2 consecutive same → back to base
    await vi.advanceTimersByTimeAsync(500);
    expect(scheduler.getIntervalMs('test-provider')).toBe(1000);

    // Poll 4 — 60 (same) → 3 consecutive same → idle
    await vi.advanceTimersByTimeAsync(1000);
    expect(scheduler.getIntervalMs('test-provider')).toBe(3000);

    scheduler.stop();
  });

  // ── Stores snapshots in DB ───────────────────────────────────────

  it('stores snapshots in DB for each window', async () => {
    const quota: ProviderQuota = {
      provider: 'test',
      account: 'main',
      plan: 'pro',
      status: 'ok',
      windows: [
        { name: 'daily', used: 50, total: 100, unit: 'tokens', remaining: 50, remainingPct: 50, resetAt: null, unlimited: false },
        { name: 'monthly', used: 1000, total: 5000, unit: 'tokens', remaining: 4000, remainingPct: 80, resetAt: null, unlimited: false },
      ],
      fetchedAt: '2026-06-30T12:00:00.000Z',
    };
    const adapter = makeMockAdapter([quota]);
    const registry = makeMockRegistry(adapter);
    const db = makeMockDb([makeProviderConfig()]);

    const scheduler = new QuotaScheduler({ registry, db });
    await scheduler.pollNow('test-provider');

    expect(db.snapshots).toHaveLength(2);
    expect((db.snapshots[0]!.snap as { windowName: string }).windowName).toBe('daily');
    expect((db.snapshots[1]!.snap as { windowName: string }).windowName).toBe('monthly');
  });

  // ── Alert takes priority over active/idle ────────────────────────

  it('alert interval takes priority over active interval', async () => {
    // Usage changes AND alert is below threshold
    const quota1 = makeQuota(90, 100); // remainingPct=10%, below threshold
    const quota2 = makeQuota(95, 100); // changed usage + still alerting

    const adapter = makeMockAdapter([quota1, quota2]);
    const registry = makeMockRegistry(adapter);

    const alertRule: AlertRule = {
      id: 'rule-1',
      provider: 'test-provider',
      windowName: 'daily',
      thresholdPct: 20,
      channels: ['macos_notification'],
      cooldownMs: 3600000,
      enabled: true,
    };
    const db = makeMockDb([makeProviderConfig()], [alertRule]);

    const scheduler = new QuotaScheduler({
      registry,
      db,
      baseIntervalMs: 1000,
      activeIntervalMs: 500,
      alertIntervalMs: 200,
    });
    scheduler.start();

    // Poll 1 — alert triggered → alertInterval (200ms)
    await vi.advanceTimersByTimeAsync(1000);
    expect(scheduler.getIntervalMs('test-provider')).toBe(200);

    // Poll 2 — usage changed AND alert still active → alert wins
    await vi.advanceTimersByTimeAsync(200);
    expect(scheduler.getIntervalMs('test-provider')).toBe(200);

    scheduler.stop();
  });

  // ── stop() clears timers so no more polls fire ───────────────────

  it('stop() prevents further polls', async () => {
    const quota = makeQuota(50);
    const adapter = makeMockAdapter([quota, quota, quota, quota]);
    const registry = makeMockRegistry(adapter);
    const db = makeMockDb([makeProviderConfig()]);
    const onQuotaFetched = vi.fn();

    const scheduler = new QuotaScheduler({
      registry,
      db,
      onQuotaFetched,
      baseIntervalMs: 1000,
    });
    scheduler.start();

    await vi.advanceTimersByTimeAsync(1000);
    expect(onQuotaFetched).toHaveBeenCalledTimes(1);

    scheduler.stop();

    // Advance a lot — no more polls
    await vi.advanceTimersByTimeAsync(10000);
    expect(onQuotaFetched).toHaveBeenCalledTimes(1);
  });

  // ── Multiple providers are scheduled independently ───────────────

  it('schedules multiple providers independently', async () => {
    const adapter = makeMockAdapter([makeQuota(50)]);
    const registry = makeMockRegistry(adapter);
    const db = makeMockDb([
      makeProviderConfig({ id: 'p1' }),
      makeProviderConfig({ id: 'p2', displayName: 'P2' }),
    ]);
    const onQuotaFetched = vi.fn();

    const scheduler = new QuotaScheduler({
      registry,
      db,
      onQuotaFetched,
      baseIntervalMs: 1000,
    });
    scheduler.start();

    await vi.advanceTimersByTimeAsync(1000);
    expect(onQuotaFetched).toHaveBeenCalledTimes(2);

    scheduler.stop();
  });
});
