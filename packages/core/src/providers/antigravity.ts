import type { ProviderAdapter } from './types.js';
import type { ProviderConfig, ProviderQuota, QuotaWindow } from '../types.js';
import { fetchJson, httpStatusToQuotaStatus, percentWindow, quotaError, quotaOk } from './base.js';

/**
 * Antigravity quota — native Google Cloud Code API client.
 *
 * Endpoint + headers reverse-engineered from the community `antigravity-usage`
 * CLI 0.2.9 (we previously shelled out to it). Credentials come from that
 * CLI's token store (`antigravity-usage login` once) via credential-source;
 * token refresh runs through auth/refresh.ts against Google's OAuth endpoint.
 *
 * Quota model: two independent pools — Gemini family + Claude/GPT family.
 * The API returns per-model quotaInfo, but models in the same family share
 * one pool (identical remaining + reset), and no pool/family field exists in
 * the API — grouping by label is our own empirical heuristic. Both pools are
 * ~5h rolling windows.
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
function poolOf(models: ModelInfo[]): FamilyPool | null {
  let worst: FamilyPool | null = null;
  for (const m of models) {
    const fraction = m.quotaInfo?.remainingFraction;
    if (typeof fraction !== 'number') continue;
    if (!worst || fraction < worst.remainingFraction) {
      worst = { remainingFraction: fraction, resetTime: m.quotaInfo?.resetTime ?? null };
    }
  }
  return worst;
}

function toWindow(name: string, pool: FamilyPool): QuotaWindow {
  const usedPct = (1 - Math.max(0, Math.min(1, pool.remainingFraction))) * 100;
  return percentWindow(name, 'session', usedPct, pool.resetTime);
}

export const antigravityProvider: ProviderAdapter = {
  id: 'antigravity',
  displayName: 'Antigravity',
  // Google-internal API polled with a spoofed IDE identity — don't hammer it.
  minPollIntervalMs: 30_000,

  async fetchQuota(config: ProviderConfig): Promise<ProviderQuota> {
    const token = config.credentials.token;
    if (!token) {
      return quotaError(
        'antigravity',
        config,
        'not_configured',
        'No Antigravity token found — run `antigravity-usage login` once to create one',
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

    const gemini: ModelInfo[] = [];
    const claudeGpt: ModelInfo[] = [];
    for (const [modelId, info] of models) {
      const label = info.displayName ?? info.label ?? modelId;
      (familyOf(label) === 'gemini' ? gemini : claudeGpt).push(info);
    }

    const windows: QuotaWindow[] = [];
    const geminiPool = poolOf(gemini);
    const claudeGptPool = poolOf(claudeGpt);
    if (geminiPool) windows.push(toWindow('Gemini (5h)', geminiPool));
    if (claudeGptPool) windows.push(toWindow('Claude+GPT (5h)', claudeGptPool));

    return quotaOk(
      'antigravity',
      config.credentials.email ?? config.id,
      'antigravity',
      windows,
    );
  },
};
