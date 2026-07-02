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
const COOLDOWN_MS = 180_000; // 180s per token

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

function setCooldown(providerId: string): void {
  cooldownMap.set(providerId, Date.now() + COOLDOWN_MS);
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
        setCooldown(config.id);
        return quotaError('claude', config, 'error', 'Rate limited (429)');
      }
      if (res.status !== null) {
        return quotaError('claude', config, httpStatusToQuotaStatus(res.status), res.error);
      }
      return quotaError('claude', config, 'error', res.error);
    }

    return quotaOk('claude', config.id, 'claude-code', mapWindows(res.data));
  },
};

/** Reset cooldown state — useful for tests. */
export function _resetCooldowns(): void {
  cooldownMap.clear();
}
