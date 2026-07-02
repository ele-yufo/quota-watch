import type { ProviderAdapter } from './types.js';
import type { ProviderConfig, ProviderQuota } from '../types.js';
import { fetchJson, httpStatusToQuotaStatus, percentWindow, quotaError, quotaOk } from './base.js';

/**
 * OpenAI Codex API response shape (2026 — primary_window/secondary_window,
 * reset_at as epoch seconds).
 */
interface CodexWindow {
  used_percent: number;
  limit_window_seconds?: number;
  reset_after_seconds?: number;
  reset_at: number; // epoch seconds
}
interface CodexUsageResponse {
  plan_type: string;
  rate_limit: {
    allowed?: boolean;
    limit_reached?: boolean;
    primary_window: CodexWindow;
    secondary_window: CodexWindow;
  };
  rate_limit_reset_credits?: {
    available_count: number;
  };
}

const API_URL = 'https://chatgpt.com/backend-api/wham/usage';

const toIso = (epochSec: number | undefined): string | null =>
  typeof epochSec === 'number' ? new Date(epochSec * 1000).toISOString() : null;

export const codexProvider: ProviderAdapter = {
  id: 'codex',
  displayName: 'OpenAI Codex',

  async fetchQuota(config: ProviderConfig): Promise<ProviderQuota> {
    const token = config.credentials.token;
    if (!token) {
      return quotaError('codex', config, 'not_configured', 'No access token configured');
    }

    const res = await fetchJson<CodexUsageResponse>(API_URL, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    if (!res.ok) {
      if (res.status !== null) {
        return quotaError('codex', config, httpStatusToQuotaStatus(res.status), res.error);
      }
      return quotaError('codex', config, 'error', res.error);
    }

    const { primary_window: primary, secondary_window: secondary } = res.data.rate_limit;
    const windows = [
      percentWindow('session (5h)', 'session', primary.used_percent, toIso(primary.reset_at)),
      percentWindow('weekly (7d)', 'week', secondary.used_percent, toIso(secondary.reset_at)),
    ];

    return quotaOk('codex', config.id, res.data.plan_type, windows);
  },
};
