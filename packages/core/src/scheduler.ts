import type { ProviderConfig, ProviderQuota, AlertRule } from './types.js';
import type { ProviderRegistry } from './providers/index.js';
import type { QuotaDB } from './db.js';
import { fetchWithRefresh } from './auth/token-manager.js';

// ── Scheduler config ───────────────────────────────────────────────────

export interface SchedulerConfig {
  registry: ProviderRegistry;
  db: QuotaDB;
  onQuotaFetched?: (providerId: string, quota: ProviderQuota) => void;
  baseIntervalMs?: number;   // default 15_000
  activeIntervalMs?: number; // default 10_000 (usage moving)
  idleIntervalMs?: number;   // default 60_000 (3+ unchanged polls)
  alertIntervalMs?: number;  // default 10_000 (window under alert threshold)
}

// Near-realtime defaults: the dashboard should reflect a burst of usage in
// ~10s, not tens of minutes. Providers that can't tolerate this cadence set
// ProviderAdapter.minPollIntervalMs and get clamped per provider.
const DEFAULT_BASE_MS = 15_000;
const DEFAULT_ACTIVE_MS = 10_000;
const DEFAULT_IDLE_MS = 60_000;
const DEFAULT_ALERT_MS = 10_000;

// ── Per-provider tracking state ────────────────────────────────────────

interface ProviderState {
  timer: ReturnType<typeof setInterval> | null;
  lastUsedValues: number[];   // ring buffer of last 3 `used` values across all windows
  pollCount: number;
  currentInterval: number;
}

// ── QuotaScheduler ─────────────────────────────────────────────────────

export class QuotaScheduler {
  private readonly config: Required<
    Pick<SchedulerConfig, 'baseIntervalMs' | 'activeIntervalMs' | 'idleIntervalMs' | 'alertIntervalMs'>
  > & Omit<SchedulerConfig, 'baseIntervalMs' | 'activeIntervalMs' | 'idleIntervalMs' | 'alertIntervalMs'>;

  private readonly states = new Map<string, ProviderState>();
  private running = false;

  constructor(config: SchedulerConfig) {
    this.config = {
      registry: config.registry,
      db: config.db,
      onQuotaFetched: config.onQuotaFetched,
      baseIntervalMs: config.baseIntervalMs ?? DEFAULT_BASE_MS,
      activeIntervalMs: config.activeIntervalMs ?? DEFAULT_ACTIVE_MS,
      idleIntervalMs: config.idleIntervalMs ?? DEFAULT_IDLE_MS,
      alertIntervalMs: config.alertIntervalMs ?? DEFAULT_ALERT_MS,
    };
  }

  // ── Public API ─────────────────────────────────────────────────────

  start(): void {
    if (this.running) return;
    this.running = true;

    const providers = this.config.db.listProviders().filter((p) => p.enabled);
    for (const provider of providers) {
      this.scheduleProvider(provider.id);
    }
  }

  stop(): void {
    this.running = false;
    for (const [id, state] of this.states) {
      if (state.timer !== null) {
        clearInterval(state.timer);
        state.timer = null;
      }
    }
    this.states.clear();
  }

  isRunning(): boolean {
    return this.running;
  }

  /** Force immediate poll for a specific provider, or all if omitted. */
  async pollNow(providerId?: string): Promise<void> {
    if (providerId) {
      await this.pollProvider(providerId);
    } else {
      const providers = this.config.db.listProviders().filter((p) => p.enabled);
      await Promise.all(providers.map((p) => this.pollProvider(p.id)));
    }
  }

  /** Get the current adaptive interval for a provider. */
  getIntervalMs(providerId: string): number {
    const state = this.states.get(providerId);
    return state?.currentInterval ?? this.config.baseIntervalMs;
  }

  // ── Internal scheduling ────────────────────────────────────────────

  /** Clamp an interval to the adapter's declared floor (heavy/rate-limited upstreams). */
  private clampInterval(providerId: string, intervalMs: number): number {
    const providerConfig = this.config.db.getProvider(providerId);
    const adapter = providerConfig
      ? this.config.registry.get(providerConfig.provider)
      : undefined;
    return Math.max(intervalMs, adapter?.minPollIntervalMs ?? 0);
  }

  private scheduleProvider(providerId: string): void {
    if (this.states.has(providerId)) return;

    const interval = this.clampInterval(providerId, this.config.baseIntervalMs);
    const state: ProviderState = {
      timer: null,
      lastUsedValues: [],
      pollCount: 0,
      currentInterval: interval,
    };
    this.states.set(providerId, state);

    state.timer = setInterval(() => {
      void this.pollProvider(providerId);
    }, interval);
  }

  private async pollProvider(providerId: string): Promise<void> {
    const providerConfig = this.config.db.getProvider(providerId);
    if (!providerConfig || !providerConfig.enabled) return;

    const adapter = this.config.registry.get(providerConfig.provider);
    if (!adapter) return;

    // Keep-alive: resolve freshest token from the official CLI file; on
    // auth_expired, proactively refresh via the provider's token endpoint and retry.
    let quota: ProviderQuota;
    try {
      quota = await fetchWithRefresh(providerConfig, adapter);
    } catch {
      // On fetch error, don't update tracking state
      return;
    }

    // Store snapshots in DB
    for (const window of quota.windows) {
      this.config.db.insertSnapshot(
        {
          timestamp: quota.fetchedAt,
          provider: quota.provider,
          account: quota.account,
          windowName: window.name,
          windowKind: window.kind,
          used: window.used,
          total: window.total,
          unit: window.unit,
          resetAt: window.resetAt,
        },
        providerId,
      );
    }

    // Notify callback
    this.config.onQuotaFetched?.(providerId, quota);

    // Update adaptive interval
    this.updateInterval(providerId, quota);
  }

  private updateInterval(providerId: string, quota: ProviderQuota): void {
    const state = this.states.get(providerId);
    if (!state) return;

    state.pollCount++;

    // Compute a single "used" signal from all windows (sum of used values)
    const totalUsed = quota.windows.reduce((sum, w) => sum + w.used, 0);

    // Track last 3 used values
    state.lastUsedValues.push(totalUsed);
    if (state.lastUsedValues.length > 3) {
      state.lastUsedValues.shift();
    }

    // Determine new interval based on adaptive logic
    const newInterval = this.clampInterval(
      providerId,
      this.computeInterval(providerId, state, quota),
    );

    // Only reschedule if interval changed
    if (newInterval !== state.currentInterval) {
      state.currentInterval = newInterval;
      if (state.timer !== null) {
        clearInterval(state.timer);
      }
      state.timer = setInterval(() => {
        void this.pollProvider(providerId);
      }, newInterval);
    }
  }

  private computeInterval(
    providerId: string,
    state: ProviderState,
    quota: ProviderQuota,
  ): number {
    // Priority 1: Alert — if any window is below threshold, poll fast
    if (this.hasActiveAlert(providerId, quota)) {
      return this.config.alertIntervalMs;
    }

    const values = state.lastUsedValues;

    // Need at least 2 data points to detect change
    if (values.length < 2) {
      return this.config.baseIntervalMs;
    }

    // Priority 2: Active — usage changed since last poll
    const lastVal = values[values.length - 1]!;
    const prevVal = values[values.length - 2]!;
    if (lastVal !== prevVal) {
      return this.config.activeIntervalMs;
    }

    // Priority 3: Idle — no change for 3 consecutive polls
    if (
      values.length >= 3 &&
      values[values.length - 1] === values[values.length - 2] &&
      values[values.length - 2] === values[values.length - 3]
    ) {
      return this.config.idleIntervalMs;
    }

    // Default
    return this.config.baseIntervalMs;
  }

  private hasActiveAlert(providerId: string, quota: ProviderQuota): boolean {
    const rules = this.config.db.getAlertRules(providerId);
    for (const rule of rules) {
      if (!rule.enabled) continue;
      const matchingWindow = quota.windows.find((w) => w.name === rule.windowName);
      if (matchingWindow && matchingWindow.remainingPct < rule.thresholdPct) {
        return true;
      }
    }
    return false;
  }
}
