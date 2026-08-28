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
}

// ── 429 cooldown tracking ──────────────────────────────────────────────

const cooldownMap = new Map<string, number>();
const consecutive429 = new Map<string, number>();
const BASE_COOLDOWN_MS = 180_000;
const MAX_COOLDOWN_MS = 60 * 60_000; // never back off past 1h

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
 * windows) but never below the exponential backoff — a server that keeps
 * answering `Retry-After: 1` must not turn into a 1s poll loop. A flat short
 * cooldown re-hits a still-limited endpoint and re-extends the ban.
 */
function setCooldown(providerId: string, retryAfterMs?: number): void {
  const n = (consecutive429.get(providerId) ?? 0) + 1;
  consecutive429.set(providerId, n);
  const backoff = Math.min(BASE_COOLDOWN_MS * 2 ** (n - 1), MAX_COOLDOWN_MS);
  const ms = Math.min(Math.max(backoff, retryAfterMs ?? 0), MAX_COOLDOWN_MS);
  cooldownMap.set(providerId, Date.now() + ms);
}

/** Success resets the whole backoff; a non-429 outcome resets just the streak. */
function clearCooldown(providerId: string): void {
  cooldownMap.delete(providerId);
  consecutive429.delete(providerId);
}

// ── Window mapping ─────────────────────────────────────────────────────

const WINDOW_MAP = [
  { key: 'five_hour', name: 'session (5h)', kind: 'session' },
  { key: 'seven_day', name: 'weekly (7d)', kind: 'week' },
  { key: 'seven_day_sonnet', name: 'weekly sonnet (7d)', kind: 'week' },
] as const;

function mapWindows(data: ClaudeUsageResponse): QuotaWindow[] {
  return WINDOW_MAP.flatMap(({ key, name, kind }) => {
    const win = data[key];
    // skip null/missing windows (e.g. seven_day_sonnet when the user has no separate sonnet quota)
    if (!win) return [];
    return [percentWindow(name, kind, win.utilization, win.resets_at ?? null)];
  });
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

    const res = await fetchJson<ClaudeUsageResponse>(
      'https://api.anthropic.com/api/oauth/usage',
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'anthropic-beta': 'oauth-2025-04-20',
        },
      },
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
    return quotaOk('claude', config.id, 'claude-code', mapWindows(res.data));
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
