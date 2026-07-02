import type { WindowKind } from './windows.js';

/**
 * Unified quota window — every provider maps to this.
 * 9Router's biggest flaw was no unified model; this fixes it.
 */
export interface QuotaWindow {
  /** Display name e.g. "session (5h)", "weekly (7d)", "balance" */
  name: string;
  /** Time-class of the window — drives cross-provider display order */
  kind: WindowKind;
  /** Absolute units consumed */
  used: number;
  /** Total allocation */
  total: number;
  /** Unit type */
  unit: 'tokens' | 'credits' | 'percent' | 'usd' | 'requests' | 'unknown';
  /** total - used */
  remaining: number;
  /** 0-100 percentage remaining */
  remainingPct: number;
  /** ISO 8601 reset time, null if unknown */
  resetAt: string | null;
  /** true if no cap */
  unlimited: boolean;
}

/** Per-provider quota snapshot */
export interface ProviderQuota {
  provider: string;
  account: string;
  plan: string;
  status: 'ok' | 'error' | 'not_configured' | 'auth_expired';
  windows: QuotaWindow[];
  fetchedAt: string;
  error?: string;
}

/** Alert rule definition */
export interface AlertRule {
  id: string;
  provider: string;
  windowName: string;
  thresholdPct: number;
  channels: AlertChannel[];
  cooldownMs: number;
  enabled: boolean;
}

export type AlertChannel = 'macos_notification' | 'discord_webhook';

/** Historical usage data point */
export interface UsageSnapshot {
  timestamp: string;
  provider: string;
  account: string;
  windowName: string;
  /** Time-class of the window; 'unknown' for legacy rows without one */
  windowKind: WindowKind;
  used: number;
  total: number;
  unit: string;
  /** ISO 8601 reset time, null if unknown — persisted to quota_snapshots.reset_at */
  resetAt: string | null;
}

/** Provider configuration stored in DB */
export interface ProviderConfig {
  id: string;
  provider: string;
  displayName: string;
  credentials: Record<string, string>;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Consumption prediction */
export interface Prediction {
  ratePerHour: number;
  exhaustionAt: string | null;
  hoursRemaining: number;
  willExhaustBeforeReset: boolean;
  /** pace: % consumed / % elapsed. <1 = underusing, >1 = overusing */
  pace: number;
}
