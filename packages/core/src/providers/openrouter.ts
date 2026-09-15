import type { ProviderAdapter } from './types.js';
import type { ProviderConfig, ProviderQuota, QuotaWindow } from '../types.js';
import { fetchJson, httpStatusToQuotaStatus, quotaError, quotaOk } from './base.js';

/**
 * OpenRouter pay-as-you-go credits.
 *
 * GET /api/v1/credits — verified live 2026-09:
 *   { data: { total_credits, total_usage } }
 * total_credits is the lifetime purchased amount, total_usage lifetime spend
 * (both USD). Unlike DeepSeek, OpenRouter DOES report cumulative usage, so
 * this maps onto a real used/total window: remainingPct falls as you burn
 * through everything you ever topped up.
 */
const CREDITS_URL = 'https://openrouter.ai/api/v1/credits';

interface OpenRouterCreditsResponse {
  data?: {
    total_credits?: number;
    total_usage?: number;
  };
}

export const openrouterProvider: ProviderAdapter = {
  id: 'openrouter',
  displayName: 'OpenRouter',

  async fetchQuota(config: ProviderConfig): Promise<ProviderQuota> {
    const apiKey = config.credentials.apiKey ?? config.credentials.token;
    if (!apiKey) {
      return quotaError('openrouter', config, 'not_configured', 'No API key configured');
    }

    const res = await fetchJson<OpenRouterCreditsResponse>(CREDITS_URL, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!res.ok) {
      if (res.status !== null) {
        return quotaError('openrouter', config, httpStatusToQuotaStatus(res.status), res.error);
      }
      return quotaError('openrouter', config, 'error', res.error);
    }

    const total = res.data.data?.total_credits;
    const used = res.data.data?.total_usage;
    if (typeof total !== 'number' || !Number.isFinite(total) ||
        typeof used !== 'number' || !Number.isFinite(used)) {
      return quotaError('openrouter', config, 'error', 'credits response missing total_credits/total_usage');
    }

    const remaining = Math.max(0, total - used);
    const window: QuotaWindow = {
      name: 'credits',
      kind: 'balance',
      used,
      total,
      unit: 'usd',
      remaining,
      remainingPct: total > 0 ? (remaining / total) * 100 : 0,
      resetAt: null,
      unlimited: false,
    };
    return quotaOk('openrouter', config.id, 'PAYG', [window]);
  },
};
