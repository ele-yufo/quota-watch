import { describe, it, expect, beforeEach, vi } from 'vitest';
import { geminiCliProvider } from '../../src/providers/gemini.js';
import type { ProviderConfig } from '../../src/types.js';

// Save original fetch
const originalFetch = globalThis.fetch;

function makeConfig(overrides?: Partial<ProviderConfig>): ProviderConfig {
  return {
    id: 'gemini-main',
    provider: 'gemini-cli',
    displayName: 'Gemini CLI',
    credentials: { accessToken: 'ya0.test-google-token', projectId: 'my-gcp-project' },
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
  buckets: [
    { modelId: 'gemini-2.5-pro', remainingFraction: 0.85, resetTime: '2026-07-01T00:00:00Z' },
  ],
};

describe('geminiCliProvider', () => {
  beforeEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // ── basic structure ────────────────────────────────────────────

  it('has correct id and displayName', () => {
    expect(geminiCliProvider.id).toBe('gemini-cli');
    expect(geminiCliProvider.displayName).toBe('Gemini CLI');
  });

  // ── not_configured (no token) ──────────────────────────────────

  it('returns not_configured when accessToken is missing', async () => {
    const result = await geminiCliProvider.fetchQuota(makeConfig({ credentials: {} }));
    expect(result.status).toBe('not_configured');
    expect(result.error).toContain('No access token');
    expect(result.windows).toEqual([]);
  });

  // ── happy path ─────────────────────────────────────────────────

  it('returns mapped windows on success', async () => {
    mockFetch({ body: happyBody });

    const result = await geminiCliProvider.fetchQuota(makeConfig());

    expect(result.status).toBe('ok');
    expect(result.provider).toBe('gemini-cli');
    expect(result.plan).toBe('gemini-cli');
    expect(result.windows).toHaveLength(1);

    const win = result.windows[0];
    expect(win.name).toBe('gemini-2.5-pro');
    expect(win.unit).toBe('tokens');
    expect(win.used).toBe(150);       // (1 - 0.85) * 1000 = 150
    expect(win.total).toBe(1000);
    expect(win.remaining).toBe(850);
    expect(win.remainingPct).toBe(85);
    expect(win.resetAt).toBe('2026-07-01T00:00:00Z');
    expect(win.unlimited).toBe(false);
  });

  // ── multiple buckets ───────────────────────────────────────────

  it('handles multiple model buckets', async () => {
    mockFetch({
      body: {
        buckets: [
          { modelId: 'gemini-2.5-pro', remainingFraction: 0.50, resetTime: '2026-07-01T00:00:00Z' },
          { modelId: 'gemini-2.5-flash', remainingFraction: 0.90, resetTime: '2026-07-01T00:00:00Z' },
        ],
      },
    });

    const result = await geminiCliProvider.fetchQuota(makeConfig());
    expect(result.status).toBe('ok');
    expect(result.windows).toHaveLength(2);

    const pro = result.windows.find(w => w.name === 'gemini-2.5-pro');
    expect(pro!.used).toBe(500);
    expect(pro!.remaining).toBe(500);
    expect(pro!.remainingPct).toBe(50);

    const flash = result.windows.find(w => w.name === 'gemini-2.5-flash');
    expect(flash!.used).toBe(100);
    expect(flash!.remaining).toBe(900);
    expect(flash!.remainingPct).toBe(90);
  });

  // ── auth_expired ───────────────────────────────────────────────

  it('returns auth_expired on 401', async () => {
    mockFetch({ status: 401, ok: false, statusText: 'Unauthorized' });
    const result = await geminiCliProvider.fetchQuota(makeConfig());
    expect(result.status).toBe('auth_expired');
    expect(result.error).toContain('HTTP 40');
  });

  it('returns auth_expired on 403', async () => {
    mockFetch({ status: 403, ok: false, statusText: 'Forbidden' });
    const result = await geminiCliProvider.fetchQuota(makeConfig());
    expect(result.status).toBe('auth_expired');
  });

  // ── other HTTP errors ──────────────────────────────────────────

  it('returns error on 500', async () => {
    mockFetch({ status: 500, ok: false, statusText: 'Internal Server Error' });
    const result = await geminiCliProvider.fetchQuota(makeConfig());
    expect(result.status).toBe('error');
    expect(result.error).toContain('500');
  });

  // ── network failure ────────────────────────────────────────────

  it('returns error on network failure', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('fetch failed')) as unknown as typeof fetch;
    const result = await geminiCliProvider.fetchQuota(makeConfig());
    expect(result.status).toBe('error');
    expect(result.error).toBeTruthy();
    expect(result.error).toContain('fetch failed');
  });

  // ── API call correctness ──────────────────────────────────────

  it('sends correct headers and body', async () => {
    const mock = mockFetch({ body: happyBody });

    await geminiCliProvider.fetchQuota(makeConfig({
      credentials: { accessToken: 'ya0.my-secret', projectId: 'my-project-123' },
    }));

    expect(mock).toHaveBeenCalledWith(
      'https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ya0.my-secret',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ project: 'my-project-123' }),
      }),
    );
  });

  it('defaults projectId to empty string when not set', async () => {
    const mock = mockFetch({ body: happyBody });

    await geminiCliProvider.fetchQuota(makeConfig({
      credentials: { accessToken: 'ya0.token-only' },
    }));

    expect(mock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: JSON.stringify({ project: '' }),
      }),
    );
  });

  // ── zero remaining fraction ────────────────────────────────────

  it('handles zero remainingFraction (full usage)', async () => {
    mockFetch({
      body: {
        buckets: [
          { modelId: 'gemini-2.5-pro', remainingFraction: 0, resetTime: '2026-07-01T00:00:00Z' },
        ],
      },
    });

    const result = await geminiCliProvider.fetchQuota(makeConfig());
    expect(result.status).toBe('ok');
    expect(result.windows[0].used).toBe(1000);
    expect(result.windows[0].remaining).toBe(0);
    expect(result.windows[0].remainingPct).toBe(0);
  });

  // ── full remaining fraction ────────────────────────────────────

  it('handles full remainingFraction (zero usage)', async () => {
    mockFetch({
      body: {
        buckets: [
          { modelId: 'gemini-2.5-pro', remainingFraction: 1.0, resetTime: '2026-07-01T00:00:00Z' },
        ],
      },
    });

    const result = await geminiCliProvider.fetchQuota(makeConfig());
    expect(result.status).toBe('ok');
    expect(result.windows[0].used).toBe(0);
    expect(result.windows[0].remaining).toBe(1000);
    expect(result.windows[0].remainingPct).toBe(100);
  });

  // ── uses config.id as account ─────────────────────────────────

  it('uses config.id as account', async () => {
    mockFetch({ body: happyBody });
    const result = await geminiCliProvider.fetchQuota(makeConfig({ id: 'my-gemini-account' }));
    expect(result.account).toBe('my-gemini-account');
  });
});
