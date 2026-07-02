import { describe, it, expect, beforeEach, vi } from 'vitest';
import { codexProvider } from '../../src/providers/codex.js';
import type { ProviderConfig } from '../../src/types.js';

const originalFetch = globalThis.fetch;

// codex.ts converts reset_at (epoch seconds) via new Date(epoch*1000).toISOString()
const RESET_EPOCH = 1780000000;
const RESET_ISO = new Date(RESET_EPOCH * 1000).toISOString();

function makeConfig(overrides?: Partial<ProviderConfig>): ProviderConfig {
  return {
    id: 'codex-main',
    provider: 'codex',
    displayName: 'OpenAI Codex',
    credentials: { token: 'test-token-abc' },
    enabled: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

/** build a rate-limit window mock; reset_at defaults to the fixed epoch */
function win(used_percent: number, reset_at: number | undefined = RESET_EPOCH) {
  return { used_percent, reset_at };
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

describe('codexProvider', () => {
  beforeEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('has correct id and displayName', () => {
    expect(codexProvider.id).toBe('codex');
    expect(codexProvider.displayName).toBe('OpenAI Codex');
  });

  it('returns not_configured when token is missing', async () => {
    const result = await codexProvider.fetchQuota(makeConfig({ credentials: {} }));
    expect(result.status).toBe('not_configured');
    expect(result.error).toContain('No access token');
    expect(result.windows).toEqual([]);
  });

  it('returns mapped windows on success', async () => {
    mockFetch({
      body: {
        plan_type: 'plus',
        rate_limit: { primary_window: win(65), secondary_window: win(21) },
      },
    });
    const result = await codexProvider.fetchQuota(makeConfig());
    expect(result.status).toBe('ok');
    expect(result.provider).toBe('codex');
    expect(result.plan).toBe('plus');
    expect(result.windows).toHaveLength(2);

    const primary = result.windows.find((w) => w.name === 'session (5h)');
    expect(primary).toBeDefined();
    expect(primary!.unit).toBe('percent');
    expect(primary!.used).toBe(65);
    expect(primary!.total).toBe(100);
    expect(primary!.remaining).toBe(35);
    expect(primary!.remainingPct).toBe(35);
    expect(primary!.resetAt).toBe(RESET_ISO);
    expect(primary!.unlimited).toBe(false);

    const secondary = result.windows.find((w) => w.name === 'weekly (7d)');
    expect(secondary).toBeDefined();
    expect(secondary!.used).toBe(21);
    expect(secondary!.remaining).toBe(79);
    expect(secondary!.remainingPct).toBe(79);
    expect(secondary!.resetAt).toBe(RESET_ISO);
  });

  it('returns auth_expired on 401', async () => {
    mockFetch({ status: 401, ok: false, statusText: 'Unauthorized' });
    const result = await codexProvider.fetchQuota(makeConfig());
    expect(result.status).toBe('auth_expired');
    expect(result.error).toContain('HTTP 40');
  });

  it('returns auth_expired on 403', async () => {
    mockFetch({ status: 403, ok: false, statusText: 'Forbidden' });
    const result = await codexProvider.fetchQuota(makeConfig());
    expect(result.status).toBe('auth_expired');
  });

  it('returns error on 500', async () => {
    mockFetch({ status: 500, ok: false, statusText: 'Internal Server Error' });
    const result = await codexProvider.fetchQuota(makeConfig());
    expect(result.status).toBe('error');
    expect(result.error).toContain('500');
  });

  it('returns error on network failure', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('fetch failed')) as unknown as typeof fetch;
    const result = await codexProvider.fetchQuota(makeConfig());
    expect(result.status).toBe('error');
    expect(result.error).toBeTruthy();
    expect(result.error).toContain('fetch failed');
  });

  it('sends correct Authorization header', async () => {
    const mock = mockFetch({
      body: { plan_type: 'plus', rate_limit: { primary_window: win(0), secondary_window: win(0) } },
    });
    await codexProvider.fetchQuota(makeConfig({ credentials: { token: 'my-secret' } }));
    expect(mock).toHaveBeenCalledWith(
      'https://chatgpt.com/backend-api/wham/usage',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer my-secret' }) as Record<string, string>,
      }),
    );
  });

  it('handles zero percent usage', async () => {
    mockFetch({
      body: { plan_type: 'plus', rate_limit: { primary_window: win(0), secondary_window: win(0) } },
    });
    const result = await codexProvider.fetchQuota(makeConfig());
    expect(result.status).toBe('ok');
    for (const w of result.windows) {
      expect(w.remaining).toBe(100);
      expect(w.remainingPct).toBe(100);
    }
  });

  it('handles 100% usage', async () => {
    mockFetch({
      body: { plan_type: 'pro', rate_limit: { primary_window: win(100), secondary_window: win(100) } },
    });
    const result = await codexProvider.fetchQuota(makeConfig());
    expect(result.status).toBe('ok');
    expect(result.plan).toBe('pro');
    for (const w of result.windows) {
      expect(w.remaining).toBe(0);
      expect(w.remainingPct).toBe(0);
    }
  });

  it('uses config.id as account', async () => {
    mockFetch({
      body: { plan_type: 'plus', rate_limit: { primary_window: win(10), secondary_window: win(5) } },
    });
    const result = await codexProvider.fetchQuota(makeConfig({ id: 'my-codex-account' }));
    expect(result.account).toBe('my-codex-account');
  });

  it('handles missing reset_at gracefully', async () => {
    mockFetch({
      body: {
        plan_type: 'plus',
        rate_limit: {
          primary_window: { used_percent: 30 },
          secondary_window: { used_percent: 10 },
        },
      },
    });
    const result = await codexProvider.fetchQuota(makeConfig());
    expect(result.status).toBe('ok');
    expect(result.windows[0]!.resetAt).toBeNull();
    expect(result.windows[1]!.resetAt).toBeNull();
  });
});
