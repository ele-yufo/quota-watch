import type { ProviderAdapter } from './types.js';
import type { ProviderConfig, ProviderQuota, QuotaWindow } from '../types.js';
import { fetchJson, httpStatusToQuotaStatus, percentWindow, quotaError, quotaOk } from './base.js';

// GLM Coding Plan usage API — monitor endpoint (NOT /api/paas/v4/token-usage which 404s).
// Auth is a BEARER-LESS raw token. Two TOKENS_LIMIT entries = 5h session + weekly.
// Reverse-engineered from zai-org/zai-coding-plugins (official) + cc-switch #1588.
const API_URL = 'https://open.bigmodel.cn/api/monitor/usage/quota/limit';

interface GlmLimit {
  type: string; // TOKENS_LIMIT | TIME_LIMIT
  percentage?: number; // used %
  nextResetTime?: number; // ms epoch
}
interface GlmUsageResponse {
  code: number;
  success?: boolean;
  data: {
    limits: GlmLimit[];
    level?: string;
  };
}

function toWindow(name: string, kind: 'session' | 'week', l: GlmLimit): QuotaWindow {
  const resetAt = l.nextResetTime ? new Date(l.nextResetTime).toISOString() : null;
  return percentWindow(name, kind, l.percentage ?? 0, resetAt);
}

export const glmCnProvider: ProviderAdapter = {
  id: 'glm-cn',
  displayName: '智谱清言',

  async fetchQuota(config: ProviderConfig): Promise<ProviderQuota> {
    const apiKey = config.credentials.apiKey ?? config.credentials.token;
    if (!apiKey) {
      return quotaError('glm-cn', config, 'not_configured', 'No API key configured');
    }

    // GLM monitor API requires a bare token (no "Bearer " prefix)
    const res = await fetchJson<GlmUsageResponse>(API_URL, {
      headers: {
        Authorization: apiKey,
        'Content-Type': 'application/json',
      },
    });

    if (!res.ok) {
      if (res.status !== null) {
        return quotaError('glm-cn', config, httpStatusToQuotaStatus(res.status), res.error);
      }
      return quotaError('glm-cn', config, 'error', res.error);
    }

    // Two TOKENS_LIMIT entries: 5h session (earlier reset) + weekly (later reset).
    const tokenLimits = (res.data.data?.limits ?? [])
      .filter((l) => l.type === 'TOKENS_LIMIT')
      .sort((a, b) => (a.nextResetTime ?? 0) - (b.nextResetTime ?? 0));

    const windows: QuotaWindow[] = [];
    if (tokenLimits[0]) windows.push(toWindow('session (5h)', 'session', tokenLimits[0]));
    if (tokenLimits[1]) windows.push(toWindow('weekly (7d)', 'week', tokenLimits[1]));

    return quotaOk('glm-cn', config.id, res.data.data?.level ?? 'Coding Plan', windows);
  },
};
