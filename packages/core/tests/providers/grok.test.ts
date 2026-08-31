import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { grokProvider } from '../../src/providers/grok.js';
import type { ProviderConfig } from '../../src/types.js';

function makeConfig(overrides?: Partial<ProviderConfig>): ProviderConfig {
  return {
    id: 'grok-main',
    provider: 'grok',
    displayName: 'Grok',
    credentials: { token: 'xai-test-token' },
    enabled: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

// cli-chat-proxy.grok.com /v1/billing?format=credits — real response shape,
// live 2026-09 (unified-credits account, weekly period).
const mockCreditsResponse = {
  config: {
    currentPeriod: {
      type: 'USAGE_PERIOD_TYPE_WEEKLY',
      start: '2026-08-25T19:32:00.160668+00:00',
      end: '2026-09-01T19:32:00.160668+00:00',
    },
    creditUsagePercent: 42.5,
    onDemandCap: { val: 0 },
    onDemandUsed: { val: 0 },
    productUsage: [
      { product: 'GrokBuild', usagePercent: 99.0 },
      { product: 'GrokChat', usagePercent: 1.0 },
    ],
    isUnifiedBillingUser: true,
    prepaidBalance: { val: 0 },
    billingPeriodStart: '2026-08-25T19:32:00.160668+00:00',
    billingPeriodEnd: '2026-09-01T19:32:00.160668+00:00',
  },
};

// Legacy bare-/v1/billing shape.
const mockLegacyResponse = {
  config: {
    monthlyLimit: { val: 500 },
    used: { val: 431 },
    onDemandCap: { val: 0 },
    billingPeriodStart: '2026-08-01T00:00:00+00:00',
    billingPeriodEnd: '2026-09-01T00:00:00+00:00',
    history: [],
  },
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('grokProvider', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('maps the credits shape: weekly period, used% and reset from currentPeriod', async () => {
    fetchSpy.mockResolvedValue(jsonResponse(200, mockCreditsResponse));
    const quota = await grokProvider.fetchQuota(makeConfig());

    expect(quota.status).toBe('ok');
    expect(quota.windows).toHaveLength(1);
    const w = quota.windows[0]!;
    expect(w.name).toBe('weekly (7d)');
    expect(w.kind).toBe('week');
    expect(w.unit).toBe('percent');
    expect(w.used).toBe(42.5);
    expect(w.remainingPct).toBe(57.5);
    expect(w.resetAt).toBe('2026-09-01T19:32:00.160668+00:00');
  });

  it('maps monthly and daily period types to their kinds', async () => {
    for (const [type, kind] of [
      ['USAGE_PERIOD_TYPE_MONTHLY', 'month'],
      ['USAGE_PERIOD_TYPE_DAILY', 'day'],
    ] as const) {
      fetchSpy.mockResolvedValue(
        jsonResponse(200, {
          config: { currentPeriod: { type, end: '2026-09-01T00:00:00+00:00' }, creditUsagePercent: 10 },
        }),
      );
      const quota = await grokProvider.fetchQuota(makeConfig());
      expect(quota.windows[0]!.kind).toBe(kind);
    }
  });

  it('keeps an unknown period type instead of guessing a span', async () => {
    fetchSpy.mockResolvedValue(
      jsonResponse(200, {
        config: { currentPeriod: { type: 'USAGE_PERIOD_TYPE_UNSPECIFIED' }, creditUsagePercent: 10 },
      }),
    );
    const quota = await grokProvider.fetchQuota(makeConfig());
    const w = quota.windows[0]!;
    expect(w.kind).toBe('unknown');
    expect(w.resetAt).toBeNull();
  });

  it('calls the credits wire format with the bearer token', async () => {
    fetchSpy.mockResolvedValue(jsonResponse(200, mockCreditsResponse));
    await grokProvider.fetchQuota(makeConfig());

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://cli-chat-proxy.grok.com/v1/billing?format=credits');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer xai-test-token');
  });

  it('falls back to the legacy monthlyLimit/used shape', async () => {
    fetchSpy.mockResolvedValue(jsonResponse(200, mockLegacyResponse));
    const quota = await grokProvider.fetchQuota(makeConfig());

    const w = quota.windows[0]!;
    expect(w.kind).toBe('month');
    expect(w.unit).toBe('credits');
    expect(w.used).toBe(431);
    expect(w.total).toBe(500);
    expect(w.remainingPct).toBeCloseTo(13.8);
    expect(w.resetAt).toBe('2026-09-01T00:00:00+00:00');
  });

  it('legacy fallback: over-limit (blocked) reads 0% remaining, never negative', async () => {
    // live-observed blocked account: monthlyLimit 0, used 431, chat 403s
    fetchSpy.mockResolvedValue(
      jsonResponse(200, {
        config: { monthlyLimit: { val: 0 }, used: { val: 431 }, billingPeriodEnd: '2026-09-01T00:00:00+00:00' },
      }),
    );
    const quota = await grokProvider.fetchQuota(makeConfig());

    const w = quota.windows[0]!;
    expect(w.total).toBe(431);
    expect(w.remaining).toBe(0);
    expect(w.remainingPct).toBe(0);
  });

  it('returns not_configured without a token', async () => {
    const quota = await grokProvider.fetchQuota(makeConfig({ credentials: {} }));
    expect(quota.status).toBe('not_configured');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('maps 401 to auth_expired so the token manager refreshes', async () => {
    fetchSpy.mockResolvedValue(jsonResponse(401, { error: 'unauthorized' }));
    const quota = await grokProvider.fetchQuota(makeConfig());
    expect(quota.status).toBe('auth_expired');
  });

  it('maps 403 to error, NOT auth_expired — refreshing cannot fix entitlement 403s', async () => {
    fetchSpy.mockResolvedValue(jsonResponse(403, { code: 7, message: 'OAuth2 token users' }));
    const quota = await grokProvider.fetchQuota(makeConfig());
    expect(quota.status).toBe('error');
  });

  it('errors when neither response shape matches', async () => {
    fetchSpy.mockResolvedValue(jsonResponse(200, { config: {} }));
    const quota = await grokProvider.fetchQuota(makeConfig());
    expect(quota.status).toBe('error');
    expect(quota.error).toContain('neither');
  });

  it('maps network failure to error without a status', async () => {
    fetchSpy.mockRejectedValue(new Error('ECONNREFUSED'));
    const quota = await grokProvider.fetchQuota(makeConfig());
    expect(quota.status).toBe('error');
    expect(quota.error).toContain('ECONNREFUSED');
  });
});
