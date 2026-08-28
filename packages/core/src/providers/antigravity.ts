import type { ProviderAdapter } from './types.js';
import type { ProviderConfig, ProviderQuota, QuotaWindow } from '../types.js';
import { fetchJson, httpStatusToQuotaStatus, percentWindow, quotaError, quotaOk } from './base.js';
import { fetchLocalUserStatus, fetchLocalQuotaSummary, type QuotaBucket } from './antigravity-local.js';

/**
 * Antigravity quota — two paths, tried in order:
 *
 * 1. LOCAL (primary): the running Antigravity IDE's language server answers
 *    Connect RPC on 127.0.0.1 with full quota state (see antigravity-local.ts).
 *    No credentials, no expiry — this is the elegant path whenever the IDE is
 *    open, and the same one the antigravity-usage CLI ≥0.2.9 prefers.
 * 2. GOOGLE API (fallback): cloudcode-pa.googleapis.com with an OAuth token
 *    from the antigravity-usage CLI's token store (`antigravity-usage login`
 *    once). For headless use / IDE closed. Token refresh runs through
 *    auth/refresh.ts but needs ANTIGRAVITY_OAUTH_CLIENT_SECRET, which we don't
 *    ship — so in practice this path is only as fresh as the last CLI login.
 *
 * Quota model: two independent families — Gemini + Claude/GPT — each with a
 * 5h and a weekly pool (LOCAL mode reads RetrieveUserQuotaSummary, the same
 * RPC the IDE's own quota UI renders; the Google fallback only exposes the
 * 5h pool). The legacy monthly promptCredits field is deliberately NOT
 * surfaced — its units are inconsistent and produce nonsense readings.
 */

const API_URL = 'https://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels';
// The one deliberately-spoofed header — identifies the caller as the
// Antigravity IDE to Google's backend. Must be exactly this string.
const USER_AGENT = 'antigravity';

interface ModelInfo {
  displayName?: string;
  label?: string;
  quotaInfo?: {
    remainingFraction?: number; // 0.0–1.0
    resetTime?: string; // ISO-8601
    isExhausted?: boolean;
  };
}

interface FetchAvailableModelsResponse {
  models?: Record<string, ModelInfo>;
  defaultAgentModelId?: string;
}

interface FamilyPool {
  remainingFraction: number;
  resetTime: string | null;
}

function familyOf(label: string): 'gemini' | 'claude-gpt' {
  return /gemini/i.test(label) ? 'gemini' : 'claude-gpt';
}

/** Worst (most-used) model represents the family's shared pool. */
function worstPool(
  models: { label: string; remainingFraction?: number; resetTime?: string }[],
): { gemini: FamilyPool | null; claudeGpt: FamilyPool | null } {
  let gemini: FamilyPool | null = null;
  let claudeGpt: FamilyPool | null = null;
  for (const m of models) {
    if (typeof m.remainingFraction !== 'number') continue;
    const pool: FamilyPool = {
      remainingFraction: m.remainingFraction,
      resetTime: m.resetTime ?? null,
    };
    if (familyOf(m.label) === 'gemini') {
      if (!gemini || pool.remainingFraction < gemini.remainingFraction) gemini = pool;
    } else {
      if (!claudeGpt || pool.remainingFraction < claudeGpt.remainingFraction) claudeGpt = pool;
    }
  }
  return { gemini, claudeGpt };
}

function toWindow(name: string, pool: FamilyPool): QuotaWindow {
  const raw = (1 - Math.max(0, Math.min(1, pool.remainingFraction))) * 100;
  return percentWindow(name, 'session', Math.round(raw * 100) / 100, pool.resetTime);
}

/** LOCAL path → ProviderQuota. Throws (caller falls back) when unavailable. */
async function fetchLocal(config: ProviderConfig): Promise<ProviderQuota> {
  // RetrieveUserQuotaSummary is what the IDE's own settings page renders
  // ("Weekly Limit Remaining" etc.) — per-family 5h + weekly buckets.
  // Do NOT use GetUserStatus's promptCredits: those are legacy Codeium
  // fields whose two halves come in different units (500 vs 50000), so
  // monthly-minus-available produces garbage like "99% used" for an
  // untouched plan.
  const buckets = await fetchLocalQuotaSummary();

  const familyOfBucket = (b: QuotaBucket): 'Gemini' | 'Claude+GPT' =>
    /gemini/i.test(b.group) || /gemini/i.test(b.bucketId) ? 'Gemini' : 'Claude+GPT';

  const windows: QuotaWindow[] = [];
  for (const b of buckets) {
    const family = familyOfBucket(b);
    const usedPct = Math.round((1 - Math.max(0, Math.min(1, b.remainingFraction))) * 10000) / 100;
    if (b.window === '5h') {
      windows.push(percentWindow(`${family} (5h)`, 'session', usedPct, b.resetTime ?? null));
    } else if (b.window === 'weekly') {
      windows.push(percentWindow(`${family} (weekly)`, 'week', usedPct, b.resetTime ?? null));
    }
  }

  if (windows.length === 0) {
    throw new Error('local server returned no quota buckets');
  }

  // Email is cosmetic — get it from GetUserStatus, but never let a failure
  // there cost us the quota data.
  let email = config.id;
  try {
    email = (await fetchLocalUserStatus()).email ?? config.id;
  } catch {
    /* cosmetic only */
  }
  return quotaOk('antigravity', email, 'antigravity', windows);
}

/** GOOGLE API path (fallback) — OAuth token from the antigravity-usage store. */
async function fetchGoogle(config: ProviderConfig): Promise<ProviderQuota> {
  const token = config.credentials.token;
  if (!token) {
    return quotaError(
      'antigravity',
      config,
      'not_configured',
      'Antigravity IDE not running and no token on disk — open the IDE, or run `antigravity-usage login` once',
    );
  }

  const res = await fetchJson<FetchAvailableModelsResponse>(API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': USER_AGENT,
    },
    body: JSON.stringify(
      config.credentials.projectId ? { project: config.credentials.projectId } : {},
    ),
  });

  if (!res.ok) {
    if (res.status !== null) {
      return quotaError('antigravity', config, httpStatusToQuotaStatus(res.status), res.error);
    }
    return quotaError('antigravity', config, 'error', res.error);
  }

  const models = Object.entries(res.data.models ?? {});
  if (models.length === 0) {
    return quotaError('antigravity', config, 'error', 'API returned no models');
  }

  const { gemini, claudeGpt } = worstPool(
    models.map(([modelId, info]) => ({
      label: info.displayName ?? info.label ?? modelId,
      remainingFraction: info.quotaInfo?.remainingFraction,
      resetTime: info.quotaInfo?.resetTime,
    })),
  );

  const windows: QuotaWindow[] = [];
  if (gemini) windows.push(toWindow('Gemini (5h)', gemini));
  if (claudeGpt) windows.push(toWindow('Claude+GPT (5h)', claudeGpt));

  return quotaOk(
    'antigravity',
    config.credentials.email ?? config.id,
    'antigravity',
    windows,
  );
}

export const antigravityProvider: ProviderAdapter = {
  id: 'antigravity',
  displayName: 'Antigravity',
  // Local Connect RPC is cheap; the Google fallback with an expired token
  // fails fast (401), so no need for the old 30s anti-hammer floor.
  minPollIntervalMs: 15_000,

  async fetchQuota(config: ProviderConfig): Promise<ProviderQuota> {
    try {
      return await fetchLocal(config);
    } catch {
      // IDE not running / port moved / CSRF rotated — use the OAuth path.
      return fetchGoogle(config);
    }
  },
};
