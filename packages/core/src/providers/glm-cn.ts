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
  /** window size: unit 3 = hours, 6 = weeks; number = how many units */
  unit?: number;
  number?: number;
}
interface GlmUsageResponse {
  code: number;
  success?: boolean;
  data: {
    limits: GlmLimit[];
    level?: string;
  };
}

// Identify windows by unit/number, NEVER by reset-time order: GLM omits
// nextResetTime for the 5h rolling window, so any sort on it mislabels the
// session as the week (or vice versa) whenever the entry set changes.
function slotOf(l: GlmLimit): 'session' | 'week' | null {
  if (l.unit === 3) return 'session';
  if (l.unit === 6) return 'week';
  return null;
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

    // Two TOKENS_LIMIT entries: 5h session (unit=3, number=5, no reset time)
    // + weekly (unit=6, number=1, nextResetTime at the week boundary).
    const tokenLimits = (res.data.data?.limits ?? []).filter((l) => l.type === 'TOKENS_LIMIT');

    let session = tokenLimits.find((l) => slotOf(l) === 'session');
    let weekly = tokenLimits.find((l) => slotOf(l) === 'week');

    // Fill a missing slot from the leftover entries — an unknown/changed unit
    // on ONE entry must not drop a whole window (weekly exhaustion would go
    // invisible). Rolling session omits nextResetTime; otherwise the 5h
    // window resets sooner. A lone unknown entry is treated as the session.
    const byResetAsc = (a: GlmLimit, b: GlmLimit) =>
      (a.nextResetTime ?? Number.POSITIVE_INFINITY) - (b.nextResetTime ?? Number.POSITIVE_INFINITY);
    if (!session) {
      const rest = tokenLimits.filter((l) => l !== weekly);
      session = rest.find((l) => l.nextResetTime == null) ?? [...rest].sort(byResetAsc)[0];
    }
    if (!weekly) {
      const rest = tokenLimits.filter((l) => l !== session);
      weekly = rest.find((l) => l.nextResetTime != null) ?? rest[0];
    }

    const windows: QuotaWindow[] = [];
    if (session) windows.push(toWindow('session (5h)', 'session', session));
    if (weekly) windows.push(toWindow('weekly (7d)', 'week', weekly));

    return quotaOk('glm-cn', config.id, res.data.data?.level ?? 'Coding Plan', windows);
  },
};
