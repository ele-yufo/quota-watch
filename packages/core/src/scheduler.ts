import type { ProviderQuota } from './types.js';
import type { ProviderRegistry } from './providers/index.js';
import type { QuotaDB } from './db.js';
import { fetchWithRefresh } from './auth/token-manager.js';

// ── Scheduler config ───────────────────────────────────────────────────

export interface SchedulerConfig {
  registry: ProviderRegistry;
  db: QuotaDB;
  onQuotaFetched?: (providerId: string, quota: ProviderQuota) => void;
  /** Poll threw (auth expired, network down, bad credentials…). Without this
   *  hook failures vanish silently and the UI shows "等待采集" forever. */
  onPollError?: (providerId: string, error: unknown) => void;
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
const RECONCILE_MS = 30_000;

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
  private reconcileTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: SchedulerConfig) {
    this.config = {
      registry: config.registry,
      db: config.db,
      onQuotaFetched: config.onQuotaFetched,
      onPollError: config.onPollError,
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

    this.reconcileProviders();

    // Providers can be added/removed/disabled by the web UI or CLI while the
    // daemon runs — re-sync the schedule with the DB so those changes take
    // effect without a daemon restart (a removed provider otherwise keeps
    // being polled: FK errors on snapshot insert, orphan poll state, and
    // wasted calls against rate-limited upstreams).
    this.reconcileTimer = setInterval(() => {
      try {
        this.reconcileProviders();
      } catch {
        /* DB hiccup — retry next tick */
      }
    }, RECONCILE_MS);
  }

  stop(): void {
    this.running = false;
    if (this.reconcileTimer !== null) {
      clearInterval(this.reconcileTimer);
      this.reconcileTimer = null;
    }
    for (const [, state] of this.states) {
      if (state.timer !== null) {
        clearInterval(state.timer);
        state.timer = null;
      }
    }
    this.states.clear();
  }

  /** Re-sync scheduled polls with the DB: schedule new/enabled, drop removed/disabled. */
  reconcileProviders(): void {
    if (!this.running) return;
    const wanted = new Set(
      this.config.db.listProviders().filter((p) => p.enabled).map((p) => p.id),
    );
    for (const [id, state] of this.states) {
      if (!wanted.has(id)) {
        if (state.timer !== null) clearInterval(state.timer);
        this.states.delete(id);
      }
    }
    for (const id of wanted) this.scheduleProvider(id);
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
    } catch (err) {
      // On fetch error, don't update tracking state — but DO surface it,
      // otherwise a broken credential reads as "等待采集" indefinitely.
      this.config.onPollError?.(providerId, err);
      return;
    }

    // Providers report failures as an envelope (status + error), not a throw —
    // surface those too, otherwise "token=test" reads as "等待采集" forever.
    if (quota.status !== 'ok') {
      this.config.onPollError?.(providerId, new Error(quota.error ?? quota.status));
      return;
    }

    // Store snapshots in DB — change-only writes since the data-governance
    // pass (a row is only written when used/total/unit/reset_at moved). The
    // return value isn't used here: the activity buffer below tracks the raw
    // used values on EVERY poll, so idle detection still works when a window
    // holds constant (change-only writes must not starve it).
    try {
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
    } catch (err) {
      // Provider deleted from the DB while this poll was in flight (FK
      // constraint on insert) — unschedule quietly; anything else is real.
      if (!this.config.db.getProvider(providerId)) {
        const state = this.states.get(providerId);
        if (state?.timer) clearInterval(state.timer);
        this.states.delete(providerId);
        return;
      }
      this.config.onPollError?.(providerId, err);
      return;
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
