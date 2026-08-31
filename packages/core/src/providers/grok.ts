import type { ProviderAdapter } from './types.js';
import type { ProviderConfig, ProviderQuota, QuotaWindow } from '../types.js';
import type { WindowKind } from '../windows.js';
import { fetchJson, quotaError, quotaOk } from './base.js';

/**
 * Grok (xAI) — quota from the official Grok CLI's chat proxy.
 *
 * The OAuth token is reused from the on-disk stores shared by `grok login`
 * and cliproxyapi (~/.grok/auth.json, ~/.cli-proxy-api/xai-<email>.json) and
 * refreshed via auth.x.ai like the other CLI-reuse providers.
 *
 * Verified live (2026-08/09): the quota surface is
 * GET /v1/billing?format=credits — a unified-credits view with the CURRENT
 * usage period (weekly for this account) and creditUsagePercent. The bare
 * /v1/billing legacy shape (monthlyLimit/used) still answers and is kept as
 * a fallback. grok.com/rest/rate-limits refuses OAuth tokens entirely (web
 * SSO only). Note monthlyLimit=0 in the legacy shape is NOT "unlimited":
 * over-limit accounts get 403 "personal-team-blocked:spending-limit" on chat.
 */
interface GrokBillingResponse {
  config?: {
    currentPeriod?: { type?: string; start?: string; end?: string };
    creditUsagePercent?: number;
    // legacy shape (bare /v1/billing)
    monthlyLimit?: { val?: number };
    used?: { val?: number };
    billingPeriodEnd?: string;
  };
}

const BILLING_URL = 'https://cli-chat-proxy.grok.com/v1/billing?format=credits';

/** USAGE_PERIOD_TYPE_WEEKLY → { kind: 'week', name: 'weekly (7d)' }, etc. */
function periodMeta(type: string | undefined): { kind: WindowKind; name: string } {
  switch (type) {
    case 'USAGE_PERIOD_TYPE_WEEKLY':
      return { kind: 'week', name: 'weekly (7d)' };
    case 'USAGE_PERIOD_TYPE_MONTHLY':
      return { kind: 'month', name: 'monthly (1mo)' };
    case 'USAGE_PERIOD_TYPE_DAILY':
      return { kind: 'day', name: 'daily (24h)' };
    default:
      // unknown/unspecified period type: keep the window but admit we can't
      // classify it instead of guessing a span
      return { kind: 'unknown', name: 'current period' };
  }
}

export const grokProvider: ProviderAdapter = {
  id: 'grok',
  displayName: 'Grok',

  async fetchQuota(config: ProviderConfig): Promise<ProviderQuota> {
    const token = config.credentials.token;
    if (!token) {
      return quotaError('grok', config, 'not_configured', 'No access token configured');
    }

    // Authorization alone is live-verified sufficient (2026-09); the official
    // client additionally sends a client-version gate + x-userid, so send them
    // too when the credential store provided a user id — some account states
    // 403 without the routing metadata.
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      'x-grok-client-version': '0.2.118',
    };
    if (config.credentials.userId) headers['x-userid'] = config.credentials.userId;

    const res = await fetchJson<GrokBillingResponse>(BILLING_URL, { headers });

    if (!res.ok) {
      if (res.status !== null) {
        // Only 401 means the token died. 403 here is entitlement/routing
        // ("OAuth2 token users" / spending-limit blocks) — a refresh returns
        // the same 403 and needlessly rotates the shared refresh token.
        const status = res.status === 401 ? 'auth_expired' : 'error';
        return quotaError('grok', config, status, res.error);
      }
      return quotaError('grok', config, 'error', res.error);
    }

    const cfg = res.data.config;
    if (!cfg) {
      return quotaError('grok', config, 'error', 'billing response had no config object');
    }

    // Current wire contract: a percent-used figure over a typed period.
    if (cfg.currentPeriod && typeof cfg.creditUsagePercent === 'number') {
      const meta = periodMeta(cfg.currentPeriod.type);
      const usedPct = Math.max(0, Math.min(100, cfg.creditUsagePercent));
      const window: QuotaWindow = {
        name: meta.name,
        kind: meta.kind,
        used: usedPct,
        total: 100,
        unit: 'percent',
        remaining: 100 - usedPct,
        remainingPct: 100 - usedPct,
        resetAt: typeof cfg.currentPeriod.end === 'string' ? cfg.currentPeriod.end : null,
        unlimited: false,
      };
      return quotaOk('grok', config.id, 'xai', [window]);
    }

    // Legacy fallback: absolute credits against a monthly limit.
    if (cfg.monthlyLimit && cfg.used) {
      const limit = cfg.monthlyLimit.val ?? 0;
      const used = cfg.used.val ?? 0;
      // total >= used keeps remainingPct truthful: over-limit (blocked) reads
      // 0% remaining; limit 0 with no usage also reads exhausted, matching the
      // upstream 403 spending-limit behaviour observed live.
      const total = Math.max(limit, used);
      const remaining = Math.max(0, total - used);
      const monthly: QuotaWindow = {
        name: 'monthly credits (1mo)',
        kind: 'month',
        used,
        total,
        unit: 'credits',
        remaining,
        remainingPct: total > 0 ? (remaining / total) * 100 : 0,
        resetAt: typeof cfg.billingPeriodEnd === 'string' ? cfg.billingPeriodEnd : null,
        unlimited: false,
      };
      return quotaOk('grok', config.id, 'xai', [monthly]);
    }

    return quotaError('grok', config, 'error', 'billing response matched neither the credits nor the legacy shape');
  },
};
