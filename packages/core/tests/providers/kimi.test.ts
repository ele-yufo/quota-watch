import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { kimiProvider } from '../../src/providers/kimi.js';
import type { ProviderConfig } from '../../src/types.js';

function makeConfig(overrides?: Partial<ProviderConfig>): ProviderConfig {
  return {
    id: 'kimi-main',
    provider: 'kimi',
    displayName: 'Kimi',
    credentials: { apiKey: 'sk-test-kimi-key' },
    enabled: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

// Kimi Code (Coding Plan) usages API — real response shape.
// usage = weekly rolling quota; limits[0] with window.duration===300 = 5h session.
const mockUsagesResponse = {
  user: { userId: 'x', region: 'REGION_CN' },
  usage: {
    limit: '100',
    used: '16',
    remaining: '84',
    resetTime: '2026-07-03T12:52:58.960484Z',
  },
  limits: [
    {
      window: { duration: 300, timeUnit: 'TIME_UNIT_MINUTE' },
      detail: {
        limit: '100',
        remaining: '100',
        resetTime: '2026-07-02T04:52:58.960484Z',
      },
    },
  ],
};

describe('kimiProvider', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Basic properties ─────────────────────────────────────────────────

  it('has correct id and displayName', () => {
    expect(kimiProvider.id).toBe('kimi');
    expect(kimiProvider.displayName).toBe('Kimi');
  });

  // ── Not configured ───────────────────────────────────────────────────

  it('returns not_configured when no apiKey is set', async () => {
    const result = await kimiProvider.fetchQuota(
      makeConfig({ credentials: {} }),
    );
    expect(result.status).toBe('not_configured');
    expect(result.error).toBe('No API key configured');
    expect(result.windows).toEqual([]);
  });

  // ── Successful fetch ─────────────────────────────────────────────────

  it('fetches and maps usages into 2 windows correctly', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(mockUsagesResponse),
    });

    const result = await kimiProvider.fetchQuota(makeConfig());

    expect(result.status).toBe('ok');
    expect(result.provider).toBe('kimi');
    expect(result.account).toBe('kimi-main');
    expect(result.plan).toBe('kimi-code');
    expect(result.windows).toHaveLength(2);

    // session (5h) — from limits[0].detail where duration===300
    const session = result.windows[0];
    expect(session.name).toBe('session (5h)');
    // detail has no `used` field → used = limit - remaining = 100 - 100 = 0
    expect(session.used).toBe(0);
    expect(session.total).toBe(100);
    expect(session.unit).toBe('requests');
    expect(session.remaining).toBe(100);
    expect(session.remainingPct).toBe(100);
    expect(session.resetAt).toBe('2026-07-02T04:52:58.960484Z');
    expect(session.unlimited).toBe(false);

    // weekly (7d) — from top-level usage
    const weekly = result.windows[1];
    expect(weekly.name).toBe('weekly (7d)');
    expect(weekly.used).toBe(16);
    expect(weekly.total).toBe(100);
    expect(weekly.unit).toBe('requests');
    expect(weekly.remaining).toBe(84);
    expect(weekly.remainingPct).toBe(84);
    expect(weekly.resetAt).toBe('2026-07-03T12:52:58.960484Z');
    expect(weekly.unlimited).toBe(false);
  });

  it('sends correct headers (Bearer key)', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(mockUsagesResponse),
    });

    await kimiProvider.fetchQuota(makeConfig());

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.kimi.com/coding/v1/usages',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer sk-test-kimi-key',
        }),
      }),
    );
  });

  // ── Auth errors ──────────────────────────────────────────────────────

  it('returns auth_expired on 401', async () => {
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
    });

    const result = await kimiProvider.fetchQuota(makeConfig());
    expect(result.status).toBe('auth_expired');
    expect(result.error).toBe('HTTP 401: Unauthorized');
  });

  it('returns auth_expired on 403', async () => {
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
    });

    const result = await kimiProvider.fetchQuota(makeConfig());
    expect(result.status).toBe('auth_expired');
    expect(result.error).toBe('HTTP 403: Forbidden');
  });

  // ── Generic HTTP errors ──────────────────────────────────────────────

  it('returns error for other non-ok statuses', async () => {
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    });

    const result = await kimiProvider.fetchQuota(makeConfig());
    expect(result.status).toBe('error');
    expect(result.error).toBe('HTTP 500: Internal Server Error');
  });

  // ── Network errors ───────────────────────────────────────────────────

  it('returns error on network failure', async () => {
    fetchSpy.mockRejectedValue(new Error('Network failure'));

    const result = await kimiProvider.fetchQuota(makeConfig());
    expect(result.status).toBe('error');
    expect(result.error).toBe('Network failure');
  });

  // ── Partial / edge response shapes ───────────────────────────────────

  it('returns only weekly window when no duration===300 session present', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          usage: mockUsagesResponse.usage,
          limits: [
            {
              window: { duration: 999, timeUnit: 'TIME_UNIT_MINUTE' },
              detail: { limit: '50', remaining: '50' },
            },
          ],
        }),
    });

    const result = await kimiProvider.fetchQuota(makeConfig());
    expect(result.status).toBe('ok');
    expect(result.plan).toBe('kimi-code');
    expect(result.windows).toHaveLength(1);
    expect(result.windows[0].name).toBe('weekly (7d)');
  });

  // duration is meaningless without timeUnit: 300 SECONDS is 5 minutes, not
  // the 5h session — matching the raw number would mislabel it (GLM lesson).
  it('does NOT match a 300-second window as the 5h session', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          usage: mockUsagesResponse.usage,
          limits: [
            {
              window: { duration: 300, timeUnit: 'TIME_UNIT_SECOND' },
              detail: { limit: '50', used: '10' },
            },
          ],
        }),
    });

    const result = await kimiProvider.fetchQuota(makeConfig());
    expect(result.windows).toHaveLength(1);
    expect(result.windows[0].name).toBe('weekly (7d)');
  });

  it('matches a session expressed in hours (duration 5, TIME_UNIT_HOUR)', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          usage: mockUsagesResponse.usage,
          limits: [
            {
              window: { duration: 5, timeUnit: 'TIME_UNIT_HOUR' },
              detail: { limit: '100', used: '25' },
            },
          ],
        }),
    });

    const result = await kimiProvider.fetchQuota(makeConfig());
    const session = result.windows.find((w) => w.name === 'session (5h)');
    expect(session).toBeDefined();
    expect(session?.used).toBe(25);
  });

  // An explicitly unrecognized timeUnit must NOT fall back to minutes —
  // duration=300 with an unknown unit is not evidence of a 5h window.
  it('ignores a window with an unrecognized timeUnit', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          usage: mockUsagesResponse.usage,
          limits: [
            {
              window: { duration: 300, timeUnit: 'TIME_UNIT_UNSPECIFIED' },
              detail: { limit: '50', used: '10' },
            },
          ],
        }),
    });

    const result = await kimiProvider.fetchQuota(makeConfig());
    expect(result.windows).toHaveLength(1);
    expect(result.windows[0].name).toBe('weekly (7d)');
  });

  it('returns only session window when top-level usage is missing', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          limits: mockUsagesResponse.limits,
        }),
    });

    const result = await kimiProvider.fetchQuota(makeConfig());
    expect(result.status).toBe('ok');
    expect(result.plan).toBe('kimi-code');
    expect(result.windows).toHaveLength(1);
    expect(result.windows[0].name).toBe('session (5h)');
  });

  it('fails the poll when both usage and limits are unparseable', async () => {
    // empty-ok would mark the poll healthy AND prune stored history via the
    // scheduler — an unparseable response is an error, not an empty account.
    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({}),
    });

    const result = await kimiProvider.fetchQuota(makeConfig());
    expect(result.status).toBe('error');
    expect(result.error).toContain('no parseable');
  });
});
