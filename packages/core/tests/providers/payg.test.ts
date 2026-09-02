import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { deepseekProvider } from '../../src/providers/deepseek.js';
import { openrouterProvider } from '../../src/providers/openrouter.js';
import { aihubmixProvider } from '../../src/providers/aihubmix.js';
import type { ProviderConfig } from '../../src/types.js';

function makeConfig(provider: string, overrides?: Partial<ProviderConfig>): ProviderConfig {
  return {
    id: `${provider}-main`,
    provider,
    displayName: provider,
    credentials: { apiKey: 'sk-test' },
    enabled: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// Live-verified response shapes (2026-09).
const deepseekBalance = {
  is_available: true,
  balance_infos: [
    { currency: 'CNY', total_balance: '22.60', granted_balance: '0.00', topped_up_balance: '22.60' },
  ],
};
const openrouterCredits = { data: { total_credits: 407, total_usage: 343.044648829 } };

describe('deepseekProvider', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  beforeEach(() => { fetchSpy = vi.fn(); vi.stubGlobal('fetch', fetchSpy); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('maps balance_infos to a balance window per currency', async () => {
    fetchSpy.mockResolvedValue(jsonResponse(200, deepseekBalance));
    const quota = await deepseekProvider.fetchQuota(makeConfig('deepseek'));

    expect(quota.status).toBe('ok');
    expect(quota.plan).toBe('pay-as-you-go');
    const w = quota.windows[0]!;
    expect(w.kind).toBe('balance');
    expect(w.name).toBe('balance (CNY)');
    expect(w.unit).toBe('cny');
    expect(w.remaining).toBe(22.6);
    expect(w.remainingPct).toBe(100);
  });

  it('sends the bearer token to /user/balance', async () => {
    fetchSpy.mockResolvedValue(jsonResponse(200, deepseekBalance));
    await deepseekProvider.fetchQuota(makeConfig('deepseek'));
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.deepseek.com/user/balance');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test');
  });

  it('zero balance reads 0% remaining, never negative', async () => {
    fetchSpy.mockResolvedValue(jsonResponse(200, {
      is_available: false,
      balance_infos: [{ currency: 'CNY', total_balance: '0.00' }],
    }));
    const quota = await deepseekProvider.fetchQuota(makeConfig('deepseek'));
    expect(quota.windows[0]!.remainingPct).toBe(0);
  });

  it('errors instead of fabricating a zero balance when amounts are unparseable', async () => {
    fetchSpy.mockResolvedValue(jsonResponse(200, { balance_infos: [{ currency: 'CNY' }] }));
    const quota = await deepseekProvider.fetchQuota(makeConfig('deepseek'));
    expect(quota.status).toBe('error');
  });

  it('not_configured without a key; 401 → auth_expired', async () => {
    expect((await deepseekProvider.fetchQuota(makeConfig('deepseek', { credentials: {} }))).status)
      .toBe('not_configured');
    fetchSpy.mockResolvedValue(jsonResponse(401, { error: 'unauthorized' }));
    expect((await deepseekProvider.fetchQuota(makeConfig('deepseek'))).status).toBe('auth_expired');
  });
});

describe('aihubmixProvider', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  beforeEach(() => { fetchSpy = vi.fn(); vi.stubGlobal('fetch', fetchSpy); });
  afterEach(() => { vi.restoreAllMocks(); });

  // Live-verified shape (2026-09): quota units, USD = quota / 500000.
  const selfResponse = {
    success: true,
    message: '',
    data: { quota: 20422016, used_quota: 56797078, username: 'Ruby76' },
  };

  it('maps quota units to a USD balance window', async () => {
    fetchSpy.mockResolvedValue(jsonResponse(200, selfResponse));
    const quota = await aihubmixProvider.fetchQuota(makeConfig('aihubmix', { credentials: { manageKey: 'fd-test' } }));

    expect(quota.status).toBe('ok');
    const w = quota.windows[0]!;
    expect(w.kind).toBe('balance');
    expect(w.unit).toBe('usd');
    expect(w.remaining).toBeCloseTo(40.84);
    expect(w.used).toBeCloseTo(113.59);
    expect(w.total).toBeCloseTo(154.44);
    expect(w.remainingPct).toBeGreaterThan(0);
  });

  it('sends the manage key to /api/user/self', async () => {
    fetchSpy.mockResolvedValue(jsonResponse(200, selfResponse));
    await aihubmixProvider.fetchQuota(makeConfig('aihubmix', { credentials: { manageKey: 'fd-test' } }));
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://aihubmix.com/api/user/self');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer fd-test');
  });

  it('errors on success:false (bad token answered 200)', async () => {
    fetchSpy.mockResolvedValue(jsonResponse(200, { success: false, message: 'Unauthorized' }));
    expect((await aihubmixProvider.fetchQuota(makeConfig('aihubmix'))).status).toBe('error');
  });

  it('not_configured without a key; 401 → auth_expired', async () => {
    expect((await aihubmixProvider.fetchQuota(makeConfig('aihubmix', { credentials: {} }))).status)
      .toBe('not_configured');
    fetchSpy.mockResolvedValue(jsonResponse(401, { message: 'Unauthorized' }));
    expect((await aihubmixProvider.fetchQuota(makeConfig('aihubmix'))).status).toBe('auth_expired');
  });
});

describe('openrouterProvider', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  beforeEach(() => { fetchSpy = vi.fn(); vi.stubGlobal('fetch', fetchSpy); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('maps lifetime credits into a used/total balance window', async () => {
    fetchSpy.mockResolvedValue(jsonResponse(200, openrouterCredits));
    const quota = await openrouterProvider.fetchQuota(makeConfig('openrouter'));

    expect(quota.status).toBe('ok');
    const w = quota.windows[0]!;
    expect(w.kind).toBe('balance');
    expect(w.unit).toBe('usd');
    expect(w.used).toBeCloseTo(343.04);
    expect(w.total).toBe(407);
    expect(w.remaining).toBeCloseTo(63.96);
    expect(w.remainingPct).toBeCloseTo(15.71);
  });

  it('over-limit (usage > credits) clamps remaining at 0', async () => {
    fetchSpy.mockResolvedValue(jsonResponse(200, { data: { total_credits: 10, total_usage: 12 } }));
    const quota = await openrouterProvider.fetchQuota(makeConfig('openrouter'));
    expect(quota.windows[0]!.remaining).toBe(0);
    expect(quota.windows[0]!.remainingPct).toBe(0);
  });

  it('errors when the credits shape is missing', async () => {
    fetchSpy.mockResolvedValue(jsonResponse(200, { data: {} }));
    expect((await openrouterProvider.fetchQuota(makeConfig('openrouter'))).status).toBe('error');
  });

  it('not_configured without a key; 401 → auth_expired', async () => {
    expect((await openrouterProvider.fetchQuota(makeConfig('openrouter', { credentials: {} }))).status)
      .toBe('not_configured');
    fetchSpy.mockResolvedValue(jsonResponse(401, { error: 'unauthorized' }));
    expect((await openrouterProvider.fetchQuota(makeConfig('openrouter'))).status).toBe('auth_expired');
  });
});
