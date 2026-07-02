import type { ProviderAdapter } from './types.js';
import type { ProviderQuota, ProviderConfig, QuotaWindow } from '../types.js';
import { fetchJson, httpStatusToQuotaStatus, quotaError, quotaOk } from './base.js';

// ── API response types ─────────────────────────────────────────────────

interface CopilotQuotaSnapshot {
  entitlement: number;
  remaining: number;
}

interface CopilotUsageResponse {
  copilot_plan: string;
  quota_snapshots: {
    chat: CopilotQuotaSnapshot;
    completions: CopilotQuotaSnapshot;
    premium_interactions: CopilotQuotaSnapshot;
  };
  quota_reset_date: string;
}

// ── Window mapping ─────────────────────────────────────────────────────

const SNAPSHOT_KEYS: Array<{ key: keyof CopilotUsageResponse['quota_snapshots']; name: string }> = [
  { key: 'chat', name: 'chat' },
  { key: 'completions', name: 'completions' },
  { key: 'premium_interactions', name: 'premium interactions' },
];

// Copilot allowances are request counts that reset on the monthly billing date.
function mapWindows(data: CopilotUsageResponse): QuotaWindow[] {
  return SNAPSHOT_KEYS.map(({ key, name }) => {
    const snap = data.quota_snapshots[key];
    const total = snap.entitlement;
    const remaining = snap.remaining;
    return {
      name,
      kind: 'month' as const,
      used: total - remaining,
      total,
      unit: 'requests' as const,
      remaining,
      remainingPct: total > 0 ? Math.round((remaining / total) * 100) : 0,
      resetAt: data.quota_reset_date ?? null,
      unlimited: false,
    };
  });
}

// ── Provider adapter ───────────────────────────────────────────────────

const API_URL = 'https://api.github.com/copilot_internal/user';

export const copilotProvider: ProviderAdapter = {
  id: 'copilot',
  displayName: 'GitHub Copilot',

  async fetchQuota(config: ProviderConfig): Promise<ProviderQuota> {
    const token = config.credentials.accessToken;
    if (!token) {
      return quotaError('copilot', config, 'not_configured', 'No access token configured');
    }

    const res = await fetchJson<CopilotUsageResponse>(API_URL, {
      headers: {
        Authorization: token,
        'X-GitHub-Api-Version': '2025-04-20',
        'Editor-Version': 'vscode/1.100.0',
      },
    });

    if (!res.ok) {
      if (res.status !== null) {
        return quotaError('copilot', config, httpStatusToQuotaStatus(res.status), res.error);
      }
      return quotaError('copilot', config, 'error', res.error);
    }

    return quotaOk('copilot', config.id, res.data.copilot_plan, mapWindows(res.data));
  },
};
