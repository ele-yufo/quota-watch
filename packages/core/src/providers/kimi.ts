import type { ProviderAdapter } from './types.js';
import type { ProviderQuota, ProviderConfig, QuotaWindow } from '../types.js';
import type { WindowKind } from '../windows.js';
import { fetchJson, httpStatusToQuotaStatus, quotaError, quotaOk } from './base.js';

// Kimi Code (Coding Plan) usage API — NOT the moonshot pay-as-you-go balance.
// Reverse-engineered from MoonshotAI/kimi-cli src/kimi_cli/ui/shell/usage.py.
const API_URL = 'https://api.kimi.com/coding/v1/usages';

interface KimiUsageItem {
  limit?: string;
  used?: string;
  remaining?: string;
  resetTime?: string;
}

interface KimiUsageResponse {
  /** weekly rolling quota */
  usage?: KimiUsageItem;
  /** finer-grained windows; the 5h session is the one with window.duration === 300 (minutes) */
  limits?: Array<{
    window?: { duration?: number; timeUnit?: string };
    detail?: KimiUsageItem;
  }>;
}

// Kimi reports raw unit counts (limit/used/remaining), not percentages —
// keep the raw totals so the UI can show absolute usage.
function toWindow(name: string, kind: WindowKind, d: KimiUsageItem): QuotaWindow {
  const limit = Number(d.limit ?? 0);
  const used = d.used != null ? Number(d.used) : limit - Number(d.remaining ?? 0);
  const remaining = Math.max(0, limit - used);
  const remainingPct = limit > 0 ? (remaining / limit) * 100 : 0;
  return {
    name,
    kind,
    used,
    total: limit,
    unit: 'percent',
    remaining,
    remainingPct,
    resetAt: d.resetTime ?? null,
    unlimited: false,
  };
}

export const kimiProvider: ProviderAdapter = {
  id: 'kimi',
  displayName: 'Kimi',

  async fetchQuota(config: ProviderConfig): Promise<ProviderQuota> {
    const apiKey = config.credentials.apiKey ?? config.credentials.token;
    if (!apiKey) {
      return quotaError('kimi', config, 'not_configured', 'No API key configured');
    }

    const res = await fetchJson<KimiUsageResponse>(API_URL, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!res.ok) {
      if (res.status !== null) {
        return quotaError('kimi', config, httpStatusToQuotaStatus(res.status), res.error);
      }
      return quotaError('kimi', config, 'error', res.error);
    }

    const windows: QuotaWindow[] = [];
    // 5h session: the limit whose window.duration === 300 minutes
    const session = res.data.limits?.find((l) => l.window?.duration === 300);
    if (session?.detail) windows.push(toWindow('session (5h)', 'session', session.detail));
    // weekly: top-level usage
    if (res.data.usage) windows.push(toWindow('weekly (7d)', 'week', res.data.usage));

    return quotaOk('kimi', config.id, 'kimi-code', windows);
  },
};
