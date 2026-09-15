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

// Live 2026-09-09: unified-billing accounts no longer get creditUsagePercent
// on ?format=credits — this shape must fall through to the legacy URL.
const mockCreditsNoPercentResponse = {
  config: {
    currentPeriod: {
      type: 'USAGE_PERIOD_TYPE_WEEKLY',
      start: '2026-09-08T19:32:00.160668+00:00',
      end: '2026-09-15T19:32:00.160668+00:00',
    },
    onDemandCap: { val: 0 },
    onDemandUsed: { val: 0 },
    isUnifiedBillingUser: true,
    prepaidBalance: { val: 0 },
    topUpMethod: 'TOP_UP_METHOD_SAVED_PAYMENT_METHOD',
    billingPeriodStart: '2026-09-08T19:32:00.160668+00:00',
    billingPeriodEnd: '2026-09-15T19:32:00.160668+00:00',
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

  /** Answer per URL: credits view vs bare legacy billing. */
  function mockBillingByUrl(credits: unknown, legacy: unknown): void {
    fetchSpy.mockImplementation(async (url: string) =>
      String(url).includes('format=credits')
        ? jsonResponse(200, credits)
        : jsonResponse(200, legacy),
    );
  }

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

  it('reports no window when unified billing drops creditUsagePercent', async () => {
    // live 2026-09-09: period present, percent gone, chat still works —
    // neither "0% remaining" nor a fabricated 0-used/100-total placeholder is
    // truthful, and a placeholder would make recommend_channel rank Grok as
    // full headroom. Empty windows read as "no data" everywhere downstream.
    fetchSpy.mockResolvedValue(jsonResponse(200, mockCreditsNoPercentResponse));
    const quota = await grokProvider.fetchQuota(makeConfig());

    expect(quota.status).toBe('ok');
    expect(quota.windows).toHaveLength(0);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('parses the legacy shape straight off the credits response without a second request', async () => {
    fetchSpy.mockResolvedValue(jsonResponse(200, mockLegacyResponse));
    const quota = await grokProvider.fetchQuota(makeConfig());

    expect(quota.status).toBe('ok');
    const w = quota.windows[0]!;
    expect(w.kind).toBe('month');
    expect(w.used).toBe(431);
    expect(w.total).toBe(500);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('surfaces a legacy re-fetch network failure instead of a shape mismatch', async () => {
    // credits view without currentPeriod → the legacy URL re-fetch happens
    fetchSpy.mockImplementation(async (url: string) => {
      if (String(url).includes('format=credits')) return jsonResponse(200, { config: {} });
      throw new Error('ETIMEDOUT');
    });
    const quota = await grokProvider.fetchQuota(makeConfig());

    expect(quota.status).toBe('error');
    expect(quota.error).toContain('ETIMEDOUT');
  });

  it('legacy fallback: over-limit (blocked) reads 0% remaining, never negative', async () => {
    // live-observed blocked account: monthlyLimit 0, used 431, chat 403s
    mockBillingByUrl({ config: {} }, {
      config: { monthlyLimit: { val: 0 }, used: { val: 431 }, billingPeriodEnd: '2026-09-01T00:00:00+00:00' },
    });
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
    mockBillingByUrl({ config: {} }, { config: {} });
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
