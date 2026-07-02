import type { ProviderAdapter } from './types.js';
import type { ProviderQuota, ProviderConfig, QuotaWindow } from '../types.js';
import { fetchJson, httpStatusToQuotaStatus, quotaError, quotaOk } from './base.js';

// ── API response types ─────────────────────────────────────────────────

interface GeminiBucket {
  modelId: string;
  remainingFraction: number;
  resetTime: string;
}

interface GeminiUsageResponse {
  buckets: GeminiBucket[];
}

// ── Constants ──────────────────────────────────────────────────────────

const API_URL = 'https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota';
const TOTAL_TOKENS = 1000;

// ── Provider adapter ───────────────────────────────────────────────────

export const geminiCliProvider: ProviderAdapter = {
  id: 'gemini-cli',
  displayName: 'Gemini CLI',

  async fetchQuota(config: ProviderConfig): Promise<ProviderQuota> {
    const token = config.credentials.accessToken;
    if (!token) {
      return quotaError('gemini-cli', config, 'not_configured', 'No access token configured');
    }

    const res = await fetchJson<GeminiUsageResponse>(API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        project: config.credentials.projectId ?? '',
      }),
    });

    if (!res.ok) {
      if (res.status !== null) {
        return quotaError('gemini-cli', config, httpStatusToQuotaStatus(res.status), res.error);
      }
      return quotaError('gemini-cli', config, 'error', res.error);
    }

    // Per-model daily buckets; Gemini CLI free-tier allowances reset daily.
    const windows: QuotaWindow[] = res.data.buckets.map((bucket) => {
      const used = Math.round((1 - bucket.remainingFraction) * TOTAL_TOKENS);
      return {
        name: bucket.modelId,
        kind: 'day' as const,
        used,
        total: TOTAL_TOKENS,
        unit: 'tokens' as const,
        remaining: TOTAL_TOKENS - used,
        remainingPct: Math.round(bucket.remainingFraction * 100),
        resetAt: bucket.resetTime ?? null,
        unlimited: false,
      };
    });

    return quotaOk('gemini-cli', config.id, 'gemini-cli', windows);
  },
};
