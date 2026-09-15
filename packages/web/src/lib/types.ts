/**
 * Client-side types — mirrored from packages/core so we never pull
 * better-sqlite3 into the browser bundle. Keep in sync with
 * core windows.ts (WindowKind) and api-server.ts (QuotaApiProvider).
 */

/** Mirror of core WindowKind. */
export type WindowKind = 'session' | 'day' | 'week' | 'month' | 'balance' | 'unknown';

/** Mirror of core WINDOW_KIND_ORDER — tighter window first. */
export const WINDOW_KIND_ORDER: Record<WindowKind, number> = {
  session: 0,
  day: 1,
  week: 2,
  month: 3,
  balance: 4,
  unknown: 5,
};

/** Mirror of core windowKindLabel — compact chip labels. */
export const WINDOW_KIND_LABEL: Record<WindowKind, string> = {
  session: '5h',
  day: '24h',
  week: '7d',
  month: '1mo',
  balance: 'bal',
  unknown: '—',
};

/**
 * Safe label lookup. `windowKind` is typed WindowKind but the DB can carry
 * legacy/future strings at runtime — indexing WINDOW_KIND_LABEL directly
 * yields undefined, and one `.toUpperCase()` on it crashes the whole page.
 */
export function windowKindLabel(kind: string): string {
  return WINDOW_KIND_LABEL[kind as WindowKind] ?? (kind ? kind.toUpperCase() : '—');
}

/** One window row of GET /api/quota (latest snapshot per provider×window). */
export interface LatestSnapshot {
  windowName: string;
  windowKind: WindowKind;
  used: number;
  total: number;
  unit: string;
  remainingPct: number;
  resetAt: string | null;
  timestamp: string;
}

/** Live poll health, attached per provider by /api/quota. */
export interface PollState {
  lastPollAt: string;
  lastStatus: string;
  lastError: string | null;
  /** Subscription tier as reported by the provider's own API, if it reports one. */
  plan?: string | null;
}

/** One provider row of GET /api/quota. */
export interface QuotaApiProvider {
  providerId: string;
  displayName: string;
  providerType: string;
  enabled: boolean;
  poll: PollState | null;
  windows: LatestSnapshot[];
}

/** GET /api/daemon. */
export interface DaemonStatus {
  running: boolean;
  pid?: number;
  uptimeSec?: number;
  providers?: Array<{
    id: string;
    provider: string;
    displayName: string;
    pollIntervalMs: number;
  }>;
}

/** A provider card's render model. */
export interface CardData {
  providerId: string;
  displayName: string;
  providerType: string;
  enabled: boolean;
  windows: LatestSnapshot[];
  /** Live poll health — null before the first poll. */
  poll: PollState | null;
  /** The most-at-risk window shown as the hero. null when no snapshot yet. */
  primary: LatestSnapshot | null;
}

export type StatusLevel = "ok" | "warn" | "low";
