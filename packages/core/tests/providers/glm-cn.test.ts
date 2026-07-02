import { describe, it, expect, beforeEach, vi } from 'vitest';
import { glmCnProvider } from '../../src/providers/glm-cn.js';
import type { ProviderConfig } from '../../src/types.js';

// Save original fetch
const originalFetch = globalThis.fetch;

function makeConfig(overrides?: Partial<ProviderConfig>): ProviderConfig {
  return {
    id: 'glm-main',
    provider: 'glm-cn',
    displayName: '智谱清言',
    credentials: { apiKey: 'test-api-key-abc' },
    enabled: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function mockFetch(response: { status?: number; ok?: boolean; body?: unknown; statusText?: string }) {
  const mock = vi.fn().mockResolvedValue({
    status: response.status ?? 200,
    ok: response.ok ?? true,
    statusText: response.statusText ?? 'OK',
    json: vi.fn().mockResolvedValue(response.body),
  });
  globalThis.fetch = mock as unknown as typeof fetch;
  return mock;
}

// GLM Coding Plan monitor API — real response shape.
// Two TOKENS_LIMIT entries (5h session + weekly 7d) + one TIME_LIMIT (ignored).
const SESSION_RESET = 1782960937355;
const WEEKLY_RESET = 1783303263991;
const TIME_RESET = 1784512863998;
const mockMonitorResponse = {
  code: 200,
  msg: '操作成功',
  data: {
    limits: [
      { type: 'TOKENS_LIMIT', percentage: 7, nextResetTime: SESSION_RESET },
      { type: 'TOKENS_LIMIT', percentage: 84, nextResetTime: WEEKLY_RESET },
      { type: 'TIME_LIMIT', percentage: 6, nextResetTime: TIME_RESET },
    ],
    level: 'max',
  },
  success: true,
};

describe('glmCnProvider', () => {
  beforeEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // ── basic structure ────────────────────────────────────────────

  it('has correct id and displayName', () => {
    expect(glmCnProvider.id).toBe('glm-cn');
    expect(glmCnProvider.displayName).toBe('智谱清言');
  });

  // ── not_configured (no apiKey) ─────────────────────────────────

  it('returns not_configured when apiKey is missing', async () => {
    const result = await glmCnProvider.fetchQuota(makeConfig({ credentials: {} }));
    expect(result.status).toBe('not_configured');
    expect(result.error).toContain('No API key');
    expect(result.windows).toEqual([]);
  });

  // ── happy path: 2 TOKENS_LIMIT windows sorted by nextResetTime ─

  it('returns mapped session + weekly windows on success', async () => {
    mockFetch({ body: mockMonitorResponse });

    const result = await glmCnProvider.fetchQuota(makeConfig());

    expect(result.status).toBe('ok');
    expect(result.provider).toBe('glm-cn');
    expect(result.plan).toBe('max');
    expect(result.windows).toHaveLength(2);

    // session (5h) — earlier resetTime, percentage=7
    const session = result.windows[0];
    expect(session.name).toBe('session (5h)');
    expect(session.unit).toBe('percent');
    expect(session.used).toBe(7);
    expect(session.total).toBe(100);
    expect(session.remaining).toBe(93);
    expect(session.remainingPct).toBe(93);
    expect(session.resetAt).toBe(new Date(SESSION_RESET).toISOString());
    expect(session.unlimited).toBe(false);

    // weekly (7d) — later resetTime, percentage=84
    const weekly = result.windows[1];
    expect(weekly.name).toBe('weekly (7d)');
    expect(weekly.used).toBe(84);
    expect(weekly.total).toBe(100);
    expect(weekly.remaining).toBe(16);
    expect(weekly.remainingPct).toBe(16);
    expect(weekly.resetAt).toBe(new Date(WEEKLY_RESET).toISOString());
  });

  // ── sorts TOKENS_LIMIT by nextResetTime ascending ──────────────

  it('assigns session/weekly by resetTime order regardless of input order', async () => {
    // Provide weekly first, session second — adapter must sort.
    mockFetch({
      body: {
        code: 200,
        success: true,
        data: {
          limits: [
            { type: 'TOKENS_LIMIT', percentage: 84, nextResetTime: WEEKLY_RESET },
            { type: 'TOKENS_LIMIT', percentage: 7, nextResetTime: SESSION_RESET },
          ],
          level: 'max',
        },
      },
    });

    const result = await glmCnProvider.fetchQuota(makeConfig());
    expect(result.windows).toHaveLength(2);
    expect(result.windows[0].name).toBe('session (5h)');
    expect(result.windows[0].used).toBe(7);
    expect(result.windows[1].name).toBe('weekly (7d)');
    expect(result.windows[1].used).toBe(84);
  });

  // ── auth_expired ───────────────────────────────────────────────

  it('returns auth_expired on 401', async () => {
    mockFetch({ status: 401, ok: false, statusText: 'Unauthorized' });
    const result = await glmCnProvider.fetchQuota(makeConfig());
    expect(result.status).toBe('auth_expired');
    expect(result.error).toContain('HTTP 40');
  });

  it('returns auth_expired on 403', async () => {
    mockFetch({ status: 403, ok: false, statusText: 'Forbidden' });
    const result = await glmCnProvider.fetchQuota(makeConfig());
    expect(result.status).toBe('auth_expired');
  });

  // ── other HTTP errors ──────────────────────────────────────────

  it('returns error on 500', async () => {
    mockFetch({ status: 500, ok: false, statusText: 'Internal Server Error' });
    const result = await glmCnProvider.fetchQuota(makeConfig());
    expect(result.status).toBe('error');
    expect(result.error).toContain('500');
  });

  // ── network failure ────────────────────────────────────────────

  it('returns error on network failure', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('fetch failed')) as unknown as typeof fetch;
    const result = await glmCnProvider.fetchQuota(makeConfig());
    expect(result.status).toBe('error');
    expect(result.error).toBeTruthy();
    expect(result.error).toContain('fetch failed');
  });

  // ── empty / no TOKENS_LIMIT ────────────────────────────────────

  it('returns empty windows when limits array is empty', async () => {
    mockFetch({
      body: {
        code: 200,
        success: true,
        data: { limits: [], level: 'max' },
      },
    });

    const result = await glmCnProvider.fetchQuota(makeConfig());
    expect(result.status).toBe('ok');
    expect(result.windows).toEqual([]);
    expect(result.plan).toBe('max');
  });

  it('filters out non-TOKENS_LIMIT entries (TIME_LIMIT ignored)', async () => {
    mockFetch({
      body: {
        code: 200,
        success: true,
        data: {
          limits: [
            { type: 'TIME_LIMIT', percentage: 6, nextResetTime: TIME_RESET },
            { type: 'OTHER_LIMIT', percentage: 10, nextResetTime: 0 },
          ],
          level: 'max',
        },
      },
    });

    const result = await glmCnProvider.fetchQuota(makeConfig());
    expect(result.status).toBe('ok');
    expect(result.windows).toEqual([]);
    expect(result.plan).toBe('max');
  });

  // ── API call correctness (bare token, no Bearer) ───────────────

  it('sends bare token (no Bearer prefix) to monitor endpoint', async () => {
    const mock = mockFetch({
      body: {
        code: 200,
        success: true,
        data: {
          limits: [{ type: 'TOKENS_LIMIT', percentage: 0, nextResetTime: SESSION_RESET }],
          level: 'max',
        },
      },
    });

    await glmCnProvider.fetchQuota(makeConfig({ credentials: { apiKey: 'my-secret-key' } }));

    expect(mock).toHaveBeenCalledWith(
      'https://open.bigmodel.cn/api/monitor/usage/quota/limit',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'my-secret-key',
          'Content-Type': 'application/json',
        }) as Record<string, string>,
      }),
    );
  });

  // ── single TOKENS_LIMIT (only session) ────────────────────────

  it('maps a single TOKENS_LIMIT as session window', async () => {
    mockFetch({
      body: {
        code: 200,
        success: true,
        data: {
          limits: [{ type: 'TOKENS_LIMIT', percentage: 30, nextResetTime: SESSION_RESET }],
          level: 'max',
        },
      },
    });

    const result = await glmCnProvider.fetchQuota(makeConfig());
    expect(result.windows).toHaveLength(1);
    expect(result.windows[0].name).toBe('session (5h)');
    expect(result.windows[0].remaining).toBe(70);
  });

  // ── zero usage ─────────────────────────────────────────────────

  it('handles zero percent usage', async () => {
    mockFetch({
      body: {
        code: 200,
        success: true,
        data: {
          limits: [{ type: 'TOKENS_LIMIT', percentage: 0, nextResetTime: SESSION_RESET }],
          level: 'max',
        },
      },
    });

    const result = await glmCnProvider.fetchQuota(makeConfig());
    expect(result.status).toBe('ok');
    expect(result.windows[0].remaining).toBe(100);
    expect(result.windows[0].remainingPct).toBe(100);
  });

  // ── 100% usage ────────────────────────────────────────────────

  it('handles 100% usage', async () => {
    mockFetch({
      body: {
        code: 200,
        success: true,
        data: {
          limits: [{ type: 'TOKENS_LIMIT', percentage: 100, nextResetTime: SESSION_RESET }],
          level: 'pro',
        },
      },
    });

    const result = await glmCnProvider.fetchQuota(makeConfig());
    expect(result.status).toBe('ok');
    expect(result.plan).toBe('pro');
    expect(result.windows[0].remaining).toBe(0);
    expect(result.windows[0].remainingPct).toBe(0);
  });

  // ── uses config.id as account ─────────────────────────────────

  it('uses config.id as account', async () => {
    mockFetch({ body: mockMonitorResponse });

    const result = await glmCnProvider.fetchQuota(makeConfig({ id: 'my-glm-account' }));
    expect(result.account).toBe('my-glm-account');
  });

  // ── defaults plan to Coding Plan ──────────────────────────────

  it('defaults plan to Coding Plan when level is missing', async () => {
    mockFetch({
      body: {
        code: 200,
        success: true,
        data: {
          limits: [{ type: 'TOKENS_LIMIT', percentage: 10, nextResetTime: SESSION_RESET }],
        },
      },
    });

    const result = await glmCnProvider.fetchQuota(makeConfig());
    expect(result.status).toBe('ok');
    expect(result.plan).toBe('Coding Plan');
  });
});
