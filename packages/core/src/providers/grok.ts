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
 *
 * 2026-09-09: unified-billing accounts (isUnifiedBillingUser=true) stopped
 * receiving creditUsagePercent on ?format=credits (onDemandCap/prepaidBalance
 * instead, and /v1/rate-limits|usage|limits are 404). The bare legacy URL
 * still answers, but its monthlyLimit=0 no longer means blocked — the same
 * account chats 200 — so legacy is only used when the credits view has no
 * currentPeriod at all. With a period but no percent we surface the window
 * with usage unknown rather than a fabricated number.
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

const CREDITS_URL = 'https://cli-chat-proxy.grok.com/v1/billing?format=credits';
const LEGACY_URL = 'https://cli-chat-proxy.grok.com/v1/billing';

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

/** Legacy monthlyLimit/used → a credits window; null when the shape absent. */
function legacyWindow(cfg: GrokBillingResponse['config']): QuotaWindow | null {
  if (!cfg?.monthlyLimit || !cfg.used) return null;
  const limit = cfg.monthlyLimit.val ?? 0;
  const used = cfg.used.val ?? 0;
  // total >= used keeps remainingPct truthful: over-limit (blocked) reads
  // 0% remaining; limit 0 with no usage also reads exhausted, matching the
  // upstream 403 spending-limit behaviour observed live.
  const total = Math.max(limit, used);
  const remaining = Math.max(0, total - used);
  return {
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

    const res = await fetchJson<GrokBillingResponse>(CREDITS_URL, { headers });

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

    // Current wire contract: a percent-used figure over a typed period.
    if (cfg?.currentPeriod) {
      if (typeof cfg.creditUsagePercent === 'number') {
        const meta = periodMeta(cfg.currentPeriod.type);
        const resetAt = typeof cfg.currentPeriod.end === 'string' ? cfg.currentPeriod.end : null;
        const usedPct = Math.max(0, Math.min(100, cfg.creditUsagePercent));
        const window: QuotaWindow = {
          name: meta.name,
          kind: meta.kind,
          used: usedPct,
          total: 100,
          unit: 'percent',
          remaining: 100 - usedPct,
          remainingPct: 100 - usedPct,
          resetAt,
          unlimited: false,
        };
        return quotaOk('grok', config.id, '', [window]);
      }

      // Period known, percent gone (unified billing since 2026-09): the only
      // remaining numbers are onDemand*/prepaid — all 0 while chat works fine,
      // so neither they nor the legacy "monthlyLimit 0" exhausted read is
      // truthful. Report NO window rather than a fabricated one: quota
      // snapshots can't carry "usage unknown" (no unlimited column), so a
      // placeholder 0-used/100-total row would read as full headroom in the
      // UI and — worse — get Grok ranked as a fresh channel by
      // recommend_channel. Losing the reset countdown is the honest price.
      return quotaOk('grok', config.id, '', []);
    }

    // The credits view may still carry the legacy fields — prefer them over
    // a second round-trip.
    const inline = legacyWindow(cfg);
    if (inline) return quotaOk('grok', config.id, '', [inline]);

    // Legacy fallback — only reachable when the credits view has no
    // currentPeriod at all (real metered monthly-credit accounts, where
    // monthlyLimit=0 genuinely means blocked/exhausted).
    const legacy = await fetchJson<GrokBillingResponse>(LEGACY_URL, { headers });
    if (!legacy.ok) {
      // Surface the real failure (401 / HTTP status / network) instead of a
      // misleading "shape mismatch".
      const status = legacy.status === 401 ? 'auth_expired' : 'error';
      return quotaError('grok', config, status, legacy.error);
    }
    const fromLegacy = legacyWindow(legacy.data.config);
    if (fromLegacy) return quotaOk('grok', config.id, '', [fromLegacy]);

    if (!cfg) {
      return quotaError('grok', config, 'error', 'billing response had no config object');
    }
    return quotaError('grok', config, 'error', 'billing response matched neither the credits nor the legacy shape');
  },
};
