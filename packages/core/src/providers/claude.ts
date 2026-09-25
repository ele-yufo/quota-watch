import type { ProviderAdapter } from './types.js';
import type { ProviderQuota, ProviderConfig, QuotaWindow } from '../types.js';
import { fetchJson, httpStatusToQuotaStatus, percentWindow, quotaError, quotaOk } from './base.js';

// ── API response types ─────────────────────────────────────────────────

interface ClaudeUsageWindow {
  utilization: number;
  resets_at: string;
}

interface ClaudeUsageResponse {
  five_hour: ClaudeUsageWindow | null;
  seven_day: ClaudeUsageWindow | null;
  seven_day_sonnet: ClaudeUsageWindow | null;
  /**
   * Model- and surface-scoped weekly buckets (e.g. the "Fable only" allowance).
   * Entry shape verified against Paseo's ClaudeQuotaProvider test suite
   * (2026-09): { kind, group, percent, severity, resets_at, is_active,
   * scope: { model: {id, display_name} | null, surface: {id, display_name} | null } }.
   * kind "session"/"weekly_all" entries with scope:null duplicate the
   * top-level windows and must be skipped.
   */
  limits?: ScopedLimit[];
}

interface ScopedLimit {
  kind?: string;
  group?: string;
  /** Used percent (0-100), NOT remaining. */
  percent?: number;
  resets_at?: string;
  is_active?: boolean;
  scope?: {
    model?: { id?: string | null; display_name?: string | null } | null;
    surface?: { id?: string | null; display_name?: string | null } | null;
  } | null;
}

// ── 429 cooldown tracking ──────────────────────────────────────────────

const cooldownMap = new Map<string, number>();
const consecutive429 = new Map<string, number>();
const BASE_COOLDOWN_MS = 180_000;
/** Cap for the exponential streak on its own (no Retry-After header). */
const MAX_BACKOFF_MS = 15 * 60_000;
/** Absolute cap — only Retry-After can push the wait out this far. */
const MAX_COOLDOWN_MS = 60 * 60_000;

// Keyed by provider config id (not the raw token) so the cooldown survives
// token rotation — otherwise a freshly-refreshed token bypasses the 429
// cooldown that was set on the previous token, and stale token strings leak.
function isInCooldown(providerId: string): boolean {
  const until = cooldownMap.get(providerId);
  if (until === undefined) return false;
  if (Date.now() >= until) {
    cooldownMap.delete(providerId);
    return false;
  }
  return true;
}

/**
 * Honor Retry-After when sent (Anthropic's usage endpoint has returned ~48min
 * windows) — it is the server's authoritative signal, so wait exactly what it
 * asks, floored at BASE_COOLDOWN_MS (a server that keeps answering
 * `Retry-After: 1` must not turn into a 1s poll loop; re-hitting a
 * still-limited endpoint re-extends the ban). The exponential streak applies
 * only when Retry-After is absent and stops at MAX_BACKOFF_MS: the previous
 * max(backoff, retryAfter) let a long streak push the cooldown PAST the
 * server's own number (observed live: streak at the old 1h cap while
 * Retry-After said ~28min, so Claude data stayed stale for hours even though
 * a retry was allowed well before the next attempt).
 */
function setCooldown(providerId: string, retryAfterMs?: number): void {
  const n = (consecutive429.get(providerId) ?? 0) + 1;
  consecutive429.set(providerId, n);
  const backoff = Math.min(BASE_COOLDOWN_MS * 2 ** (n - 1), MAX_BACKOFF_MS);
  const ms =
    retryAfterMs !== undefined
      ? Math.min(Math.max(retryAfterMs, BASE_COOLDOWN_MS), MAX_COOLDOWN_MS)
      : backoff;
  cooldownMap.set(providerId, Date.now() + ms);
}

/** Success resets the whole backoff; a non-429 outcome resets just the streak. */
function clearCooldown(providerId: string): void {
  cooldownMap.delete(providerId);
  consecutive429.delete(providerId);
}

// ── Subscription tier (dynamic) ────────────────────────────────────────

interface ClaudeProfileResponse {
  account?: { has_claude_max?: boolean; has_claude_pro?: boolean };
  organization?: { organization_type?: string };
}

const PROFILE_URL = 'https://api.anthropic.com/api/oauth/profile';

/** org type "claude_pro" → "Pro"; falls back to the account booleans. */
function planFromProfile(p: ClaudeProfileResponse): string | null {
  const orgType = p.organization?.organization_type;
  if (typeof orgType === 'string' && orgType.startsWith('claude_')) {
    const tier = orgType.slice('claude_'.length);
    if (tier) return tier[0]!.toUpperCase() + tier.slice(1);
  }
  if (p.account?.has_claude_max) return 'Max';
  if (p.account?.has_claude_pro) return 'Pro';
  return null;
}

async function fetchPlan(headers: Record<string, string>): Promise<string | null> {
  try {
    const res = await fetchJson<ClaudeProfileResponse>(PROFILE_URL, { headers });
    return res.ok ? planFromProfile(res.data) : null;
  } catch {
    return null; // tier label is best-effort — never blocks the quota windows
  }
}

// ── Window mapping ─────────────────────────────────────────────────────

const WINDOW_MAP = [
  { key: 'five_hour', name: 'session (5h)', kind: 'session' },
  { key: 'seven_day', name: 'weekly (7d)', kind: 'week' },
  { key: 'seven_day_sonnet', name: 'weekly sonnet (7d)', kind: 'week' },
] as const;

function mapWindows(data: ClaudeUsageResponse): QuotaWindow[] {
  const topLevel = WINDOW_MAP.flatMap(({ key, name, kind }) => {
    const win = data[key];
    // skip null/missing windows (e.g. seven_day_sonnet when the user has no separate sonnet quota)
    if (!win) return [];
    return [percentWindow(name, kind, win.utilization, win.resets_at ?? null)];
  });

  // Scoped weekly buckets (Fable-only etc.) — one window per resolvable label.
  // The wire contract distinguishes buckets by kind: only 'weekly_scoped' is a
  // scoped bucket; 'session'/'weekly_all' duplicate the top-level windows.
  // Malformed entries (null, non-string labels, non-number percent) are
  // skipped — an additive section must never take down the good windows.
  const scoped = (data.limits ?? []).flatMap((lim) => {
    if (!lim || typeof lim !== 'object' || lim.kind !== 'weekly_scoped') return [];
    const model = lim.scope?.model?.display_name;
    const surface = lim.scope?.surface?.display_name;
    const label = (typeof model === 'string' && model) || (typeof surface === 'string' && surface) || null;
    if (!label || typeof lim.percent !== 'number') return [];
    return [
      percentWindow(`weekly ${label.toLowerCase()} (7d)`, 'week', lim.percent, lim.resets_at ?? null),
    ];
  });

  return [...topLevel, ...scoped];
}

// ── Provider adapter ───────────────────────────────────────────────────

export const claudeProvider: ProviderAdapter = {
  id: 'claude',
  displayName: 'Claude Code',
  // The oauth/usage endpoint is aggressively rate-limited (Retry-After up to
  // ~48min observed) and Claude Code itself also calls it. Paseo queries the
  // same endpoint on-demand with a 5min cache — match that proven cadence as
  // our floor; fine-grained burn data comes from local session logs anyway.
  minPollIntervalMs: 300_000,

  async fetchQuota(config: ProviderConfig): Promise<ProviderQuota> {
    const token = config.credentials.token;
    if (!token) {
      return quotaError('claude', config, 'not_configured', 'No OAuth token configured');
    }

    if (isInCooldown(config.id)) {
      return quotaError('claude', config, 'error', 'Rate limited (429), cooling down');
    }

    const headers = {
      Authorization: `Bearer ${token}`,
      'anthropic-beta': 'oauth-2025-04-20',
    };

    const res = await fetchJson<ClaudeUsageResponse>(
      'https://api.anthropic.com/api/oauth/usage',
      { headers },
    );

    if (!res.ok) {
      if (res.status === 429) {
        setCooldown(config.id, res.retryAfterMs);
        return quotaError('claude', config, 'error', 'Rate limited (429)');
      }
      if (res.status !== null) {
        consecutive429.delete(config.id); // a non-429 answer breaks the streak
        return quotaError('claude', config, httpStatusToQuotaStatus(res.status), res.error);
      }
      consecutive429.delete(config.id);
      return quotaError('claude', config, 'error', res.error);
    }

    clearCooldown(config.id);
    return quotaOk('claude', config.id, (await fetchPlan(headers)) ?? 'Claude', mapWindows(res.data));
  },
};

/** Reset cooldown state — useful for tests. */
export function _resetCooldowns(): void {
  cooldownMap.clear();
  consecutive429.clear();
}

/** Remaining cooldown ms (0 when not cooling down) — useful for tests. */
export function _cooldownRemainingMs(providerId: string): number {
  return Math.max(0, (cooldownMap.get(providerId) ?? 0) - Date.now());
}
