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
// Unparseable/missing numbers must NOT degrade to limit=0 → remainingPct=0
// (a fake "exhausted" that fires alerts) or NaN (crashes the NOT NULL insert).
// A window we can't measure honestly is a window we don't report.
function toWindow(name: string, kind: WindowKind, d: KimiUsageItem): QuotaWindow | null {
  const limit = Number(d.limit);
  const used = d.used != null ? Number(d.used) : limit - Number(d.remaining);
  if (!Number.isFinite(limit) || limit <= 0 || !Number.isFinite(used)) return null;
  const remaining = Math.max(0, limit - used);
  const remainingPct = (remaining / limit) * 100;
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

// Identify the 5h session by window.duration CONVERTED via timeUnit — never by
// the raw number: duration=300 means 300 minutes only because timeUnit says so.
// An unknown timeUnit keeps the legacy duration===300 reading (backward compat).
const TIME_UNIT_MINUTES: Record<string, number> = {
  TIME_UNIT_SECOND: 1 / 60,
  TIME_UNIT_MINUTE: 1,
  TIME_UNIT_HOUR: 60,
  TIME_UNIT_DAY: 1440,
};

function windowMinutes(l: { duration?: number; timeUnit?: string }): number | null {
  if (l.duration == null || !Number.isFinite(l.duration)) return null;
  if (l.timeUnit == null) return l.duration; // legacy: absent unit reads as minutes
  const factor = TIME_UNIT_MINUTES[l.timeUnit];
  return factor == null ? null : l.duration * factor; // unknown unit: don't guess
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
    // 5h session: the limit whose window spans 300 minutes after unit conversion
    const session = res.data.limits?.find((l) => windowMinutes(l.window ?? {}) === 300);
    if (session?.detail) {
      const w = toWindow('session (5h)', 'session', session.detail);
      if (w) windows.push(w);
    }
    // weekly: top-level usage
    if (res.data.usage) {
      const w = toWindow('weekly (7d)', 'week', res.data.usage);
      if (w) windows.push(w);
    }

    return quotaOk('kimi', config.id, 'kimi-code', windows);
  },
};
