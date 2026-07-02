import { describe, it, expect, beforeEach, vi } from 'vitest';
import { copilotProvider } from '../../src/providers/copilot.js';
import type { ProviderConfig } from '../../src/types.js';

// Save original fetch
const originalFetch = globalThis.fetch;

function makeConfig(overrides?: Partial<ProviderConfig>): ProviderConfig {
  return {
    id: 'copilot-main',
    provider: 'copilot',
    displayName: 'GitHub Copilot',
    credentials: { accessToken: 'gho_test-token-abc' },
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

const happyBody = {
  copilot_plan: 'pro',
  quota_snapshots: {
    chat: { entitlement: 300, remaining: 255 },
    completions: { entitlement: 300, remaining: 280 },
    premium_interactions: { entitlement: 300, remaining: 255 },
  },
  quota_reset_date: '2026-07-01T00:00:00Z',
};

describe('copilotProvider', () => {
  beforeEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // ── basic structure ────────────────────────────────────────────

  it('has correct id and displayName', () => {
    expect(copilotProvider.id).toBe('copilot');
    expect(copilotProvider.displayName).toBe('GitHub Copilot');
  });

  // ── not_configured (no token) ──────────────────────────────────

  it('returns not_configured when accessToken is missing', async () => {
    const result = await copilotProvider.fetchQuota(makeConfig({ credentials: {} }));
    expect(result.status).toBe('not_configured');
    expect(result.error).toContain('No access token');
    expect(result.windows).toEqual([]);
  });

  // ── happy path ─────────────────────────────────────────────────

  it('returns mapped windows on success', async () => {
    mockFetch({ body: happyBody });

    const result = await copilotProvider.fetchQuota(makeConfig());

    expect(result.status).toBe('ok');
    expect(result.provider).toBe('copilot');
    expect(result.plan).toBe('pro');
    expect(result.windows).toHaveLength(3);

    const chat = result.windows.find(w => w.name === 'chat');
    expect(chat).toBeDefined();
    expect(chat!.unit).toBe('requests');
    expect(chat!.used).toBe(45);
    expect(chat!.total).toBe(300);
    expect(chat!.remaining).toBe(255);
    expect(chat!.remainingPct).toBe(85);
    expect(chat!.resetAt).toBe('2026-07-01T00:00:00Z');
    expect(chat!.unlimited).toBe(false);

    const completions = result.windows.find(w => w.name === 'completions');
    expect(completions).toBeDefined();
    expect(completions!.used).toBe(20);
    expect(completions!.total).toBe(300);
    expect(completions!.remaining).toBe(280);
    expect(completions!.remainingPct).toBe(93);

    const premium = result.windows.find(w => w.name === 'premium interactions');
    expect(premium).toBeDefined();
    expect(premium!.used).toBe(45);
    expect(premium!.total).toBe(300);
    expect(premium!.remaining).toBe(255);
  });

  // ── auth_expired ───────────────────────────────────────────────

  it('returns auth_expired on 401', async () => {
    mockFetch({ status: 401, ok: false, statusText: 'Unauthorized' });
    const result = await copilotProvider.fetchQuota(makeConfig());
    expect(result.status).toBe('auth_expired');
    expect(result.error).toContain('HTTP 40');
  });

  it('returns auth_expired on 403', async () => {
    mockFetch({ status: 403, ok: false, statusText: 'Forbidden' });
    const result = await copilotProvider.fetchQuota(makeConfig());
    expect(result.status).toBe('auth_expired');
  });

  // ── other HTTP errors ──────────────────────────────────────────

  it('returns error on 500', async () => {
    mockFetch({ status: 500, ok: false, statusText: 'Internal Server Error' });
    const result = await copilotProvider.fetchQuota(makeConfig());
    expect(result.status).toBe('error');
    expect(result.error).toContain('500');
  });

  // ── network failure ────────────────────────────────────────────

  it('returns error on network failure', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('fetch failed')) as unknown as typeof fetch;
    const result = await copilotProvider.fetchQuota(makeConfig());
    expect(result.status).toBe('error');
    expect(result.error).toBeTruthy();
    expect(result.error).toContain('fetch failed');
  });

  // ── API call correctness ──────────────────────────────────────

  it('sends correct headers', async () => {
    const mock = mockFetch({ body: happyBody });

    await copilotProvider.fetchQuota(makeConfig({ credentials: { accessToken: 'gho_my-secret' } }));

    expect(mock).toHaveBeenCalledWith(
      'https://api.github.com/copilot_internal/user',
      expect.objectContaining({
        headers: {
          'Authorization': 'gho_my-secret',
          'X-GitHub-Api-Version': '2025-04-20',
          'Editor-Version': 'vscode/1.100.0',
        },
      }),
    );
  });

  // ── zero usage ─────────────────────────────────────────────────

  it('handles zero remaining (full usage)', async () => {
    mockFetch({
      body: {
        copilot_plan: 'pro',
        quota_snapshots: {
          chat: { entitlement: 300, remaining: 0 },
          completions: { entitlement: 300, remaining: 0 },
          premium_interactions: { entitlement: 300, remaining: 0 },
        },
        quota_reset_date: '2026-07-01T00:00:00Z',
      },
    });

    const result = await copilotProvider.fetchQuota(makeConfig());
    expect(result.status).toBe('ok');
    for (const w of result.windows) {
      expect(w.used).toBe(300);
      expect(w.remaining).toBe(0);
      expect(w.remainingPct).toBe(0);
    }
  });

  // ── full remaining (no usage) ──────────────────────────────────

  it('handles full remaining (zero usage)', async () => {
    mockFetch({
      body: {
        copilot_plan: 'business',
        quota_snapshots: {
          chat: { entitlement: 300, remaining: 300 },
          completions: { entitlement: 300, remaining: 300 },
          premium_interactions: { entitlement: 300, remaining: 300 },
        },
        quota_reset_date: '2026-07-01T00:00:00Z',
      },
    });

    const result = await copilotProvider.fetchQuota(makeConfig());
    expect(result.status).toBe('ok');
    expect(result.plan).toBe('business');
    for (const w of result.windows) {
      expect(w.used).toBe(0);
      expect(w.remaining).toBe(300);
      expect(w.remainingPct).toBe(100);
    }
  });

  // ── uses config.id as account ─────────────────────────────────

  it('uses config.id as account', async () => {
    mockFetch({ body: happyBody });
    const result = await copilotProvider.fetchQuota(makeConfig({ id: 'my-copilot-account' }));
    expect(result.account).toBe('my-copilot-account');
  });
});
