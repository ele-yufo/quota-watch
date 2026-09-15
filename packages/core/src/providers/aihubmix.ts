import type { ProviderAdapter } from './types.js';
import type { ProviderConfig, ProviderQuota } from '../types.js';
import { fetchJson, httpStatusToQuotaStatus, quotaError, quotaOk } from './base.js';

/**
 * AIHubMix pay-as-you-go balance (NOT a subscription quota).
 *
 * GET /api/user/self — verified live 2026-09:
 *   { success: true, data: { quota: 20422016, used_quota: 56797078, ... } }
 * Authenticates with the account's **Manage Key** (系统访问令牌, generated at
 * console.aihubmix.com/setting) — the sk-*** inference API key is REJECTED on
 * this endpoint ("access token is invalid or expired").
 * Amounts are integer quota units: USD = quota / 500000.
 */
const SELF_URL = 'https://aihubmix.com/api/user/self';
const QUOTA_PER_USD = 500_000;

interface AiHubMixSelfResponse {
  success?: boolean;
  message?: string;
  data?: {
    quota?: number;
    used_quota?: number;
  };
}

export const aihubmixProvider: ProviderAdapter = {
  id: 'aihubmix',
  displayName: 'AIHubMix',

  async fetchQuota(config: ProviderConfig): Promise<ProviderQuota> {
    const manageKey = config.credentials.manageKey ?? config.credentials.apiKey;
    if (!manageKey) {
      return quotaError('aihubmix', config, 'not_configured', 'No Manage Key configured');
    }

    const res = await fetchJson<AiHubMixSelfResponse>(SELF_URL, {
      headers: {
        Authorization: `Bearer ${manageKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!res.ok) {
      if (res.status !== null) {
        return quotaError('aihubmix', config, httpStatusToQuotaStatus(res.status), res.error);
      }
      return quotaError('aihubmix', config, 'error', res.error);
    }
    // The endpoint can also answer 200 with success:false (bad token).
    if (res.data.success !== true || !res.data.data) {
      return quotaError('aihubmix', config, 'error', res.data.message ?? 'unexpected response');
    }

    const { quota, used_quota: usedQuota } = res.data.data;
    if (typeof quota !== 'number' || typeof usedQuota !== 'number') {
      return quotaError('aihubmix', config, 'error', 'quota fields missing or unparseable');
    }

    const remaining = quota / QUOTA_PER_USD;
    const used = usedQuota / QUOTA_PER_USD;
    const total = used + remaining;
    return quotaOk('aihubmix', config.id, 'PAYG', [
      {
        name: 'balance (USD)',
        kind: 'balance',
        used,
        total,
        unit: 'usd',
        remaining,
        remainingPct: total > 0 ? Math.min(100, Math.max(0, (remaining / total) * 100)) : 0,
        resetAt: null,
        unlimited: false,
      },
    ]);
  },
};
