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
    // either window may be null — e.g. a Pro account currently reports only
    // the 7d window, with secondary_window: null
    primary_window: CodexWindow | null;
    secondary_window: CodexWindow | null;
  };
  rate_limit_reset_credits?: {
    available_count: number;
  };
}

const API_URL = 'https://chatgpt.com/backend-api/wham/usage';

const toIso = (epochSec: number | undefined): string | null =>
  typeof epochSec === 'number' ? new Date(epochSec * 1000).toISOString() : null;

// The API no longer guarantees primary=5h/secondary=7d (observed live:
// primary_window with limit_window_seconds=604800 and secondary_window=null),
// so prefer the actual span; when the span is absent, fall back to the slot
// (primary→session, secondary→week) as the pre-change shape did.
// Span thresholds sit at the midpoints of the spans OpenAI actually ships
// (5h / 24h / 7d) so a future 24h window lands on 'day', not 'session'.
function windowMeta(
  w: CodexWindow,
  slot: 'primary' | 'secondary',
): { name: string; kind: 'session' | 'day' | 'week' } {
  const secs = w.limit_window_seconds;
  if (typeof secs === 'number') {
    const hours = Math.round(secs / 3600);
    if (secs <= 12 * 3600) return { name: `session (${hours}h)`, kind: 'session' };
    if (secs <= 3 * 86_400) return { name: `daily (${hours}h)`, kind: 'day' };
    return { name: 'weekly (7d)', kind: 'week' };
  }
  return slot === 'primary'
    ? { name: 'session (5h)', kind: 'session' }
    : { name: 'weekly (7d)', kind: 'week' };
}

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

    const rl = res.data.rate_limit;
    if (!rl) {
      return quotaError('codex', config, 'error', 'usage response had no rate_limit object');
    }
    const windows = ([
      ['primary', rl.primary_window],
      ['secondary', rl.secondary_window],
    ] as const)
      .filter((pair): pair is readonly ['primary' | 'secondary', CodexWindow] => pair[1] !== null)
      .map(([slot, w]) => {
        const meta = windowMeta(w, slot);
        return percentWindow(meta.name, meta.kind, w.used_percent, toIso(w.reset_at));
      });

    if (windows.length === 0) {
      return quotaError('codex', config, 'error', 'usage response contained no rate-limit windows');
    }

    const PLAN_LABELS: Record<string, string> = {
      pro: 'Pro',
      business: 'Business',
      team: 'Team',
      enterprise: 'Enterprise',
      free: 'Free',
      edu: 'Edu',
    };
    const rawPlan = typeof res.data.plan_type === 'string' ? res.data.plan_type : '';
    const plan = PLAN_LABELS[rawPlan.toLowerCase()] ?? rawPlan;

    return quotaOk('codex', config.id, plan, windows);
  },
};
