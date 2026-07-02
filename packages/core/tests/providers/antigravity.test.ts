import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { antigravityProvider } from '../../src/providers/antigravity.js';
import type { ProviderConfig } from '../../src/types.js';

function makeConfig(credentials: Record<string, string> = {}): ProviderConfig {
  return {
    id: 'antigravity-main',
    provider: 'antigravity',
    displayName: 'Antigravity',
    credentials,
    enabled: true,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

function model(displayName: string, remainingFraction: number, resetTime = '2026-07-02T14:48:48Z') {
  return { displayName, quotaInfo: { remainingFraction, resetTime, isExhausted: remainingFraction === 0 } };
}

function okResponse(models: Record<string, unknown>) {
  return new Response(JSON.stringify({ models }), { status: 200 });
}

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchSpy = vi.fn();
  vi.stubGlobal('fetch', fetchSpy);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('antigravityProvider (native Cloud Code API)', () => {
  it('has correct id, displayName and a poll floor', () => {
    expect(antigravityProvider.id).toBe('antigravity');
    expect(antigravityProvider.displayName).toBe('Antigravity');
    expect(antigravityProvider.minPollIntervalMs).toBeGreaterThanOrEqual(30_000);
  });

  it('returns not_configured without a token', async () => {
    const result = await antigravityProvider.fetchQuota(makeConfig());
    expect(result.status).toBe('not_configured');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('POSTs to fetchAvailableModels with Bearer token, project id and spoofed UA', async () => {
    fetchSpy.mockResolvedValue(okResponse({ 'gemini-3-flash': model('Gemini 3 Flash', 1) }));
    await antigravityProvider.fetchQuota(
      makeConfig({ token: 'tok-1', projectId: 'proj-9', email: 'a@b.c' }),
    );

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe('https://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer tok-1');
    expect(init.headers['User-Agent']).toBe('antigravity');
    expect(JSON.parse(init.body)).toEqual({ project: 'proj-9' });
  });

  it('sends empty body when projectId is unknown', async () => {
    fetchSpy.mockResolvedValue(okResponse({ 'gemini-3-flash': model('Gemini 3 Flash', 1) }));
    await antigravityProvider.fetchQuota(makeConfig({ token: 'tok-1' }));
    expect(JSON.parse(fetchSpy.mock.calls[0]![1].body)).toEqual({});
  });

  it('aggregates models by family into 2 session windows (worst model wins)', async () => {
    fetchSpy.mockResolvedValue(
      okResponse({
        'gemini-3-flash': model('Gemini 3 Flash', 0.8),
        'gemini-pro': model('Gemini 3.1 Pro (High)', 0.5, '2026-07-02T15:00:00Z'),
        'claude-opus': model('Claude Opus 4.6 (Thinking)', 0.25, '2026-07-02T16:00:00Z'),
        'gpt-oss': model('GPT-OSS 120B (Medium)', 0.9),
      }),
    );

    const result = await antigravityProvider.fetchQuota(
      makeConfig({ token: 'tok-1', email: 'a@b.c' }),
    );

    expect(result.status).toBe('ok');
    expect(result.account).toBe('a@b.c');
    expect(result.windows).toHaveLength(2);

    const geminiWin = result.windows.find((w) => w.name === 'Gemini (5h)')!;
    expect(geminiWin.kind).toBe('session');
    expect(geminiWin.remainingPct).toBeCloseTo(50); // worst gemini = 0.5
    expect(geminiWin.resetAt).toBe('2026-07-02T15:00:00Z');

    const claudeWin = result.windows.find((w) => w.name === 'Claude+GPT (5h)')!;
    expect(claudeWin.kind).toBe('session');
    expect(claudeWin.remainingPct).toBeCloseTo(25); // worst non-gemini = 0.25
  });

  it('classifies family by displayName/label/modelId fallback chain', async () => {
    fetchSpy.mockResolvedValue(
      okResponse({
        'gemini-mystery': { quotaInfo: { remainingFraction: 0.7, resetTime: '2026-07-02T15:00:00Z' } },
        'other-model': { label: 'Some GPT', quotaInfo: { remainingFraction: 0.6, resetTime: '2026-07-02T15:00:00Z' } },
      }),
    );
    const result = await antigravityProvider.fetchQuota(makeConfig({ token: 'tok-1' }));
    // 'gemini-mystery' has no displayName/label → modelId used → gemini family
    expect(result.windows.map((w) => w.name).sort()).toEqual(['Claude+GPT (5h)', 'Gemini (5h)']);
  });

  it('clamps remainingFraction into [0,1]', async () => {
    fetchSpy.mockResolvedValue(
      okResponse({
        'gemini-a': model('Gemini A', -0.5),
        'claude-b': model('Claude B', 1.5),
      }),
    );
    const result = await antigravityProvider.fetchQuota(makeConfig({ token: 'tok-1' }));
    const gemini = result.windows.find((w) => w.name === 'Gemini (5h)')!;
    const claude = result.windows.find((w) => w.name === 'Claude+GPT (5h)')!;
    expect(gemini.remainingPct).toBe(0);
    expect(claude.remainingPct).toBe(100);
  });

  it('skips models without quotaInfo when picking pools', async () => {
    fetchSpy.mockResolvedValue(
      okResponse({
        'gemini-a': { displayName: 'Gemini A' }, // no quotaInfo
        'claude-b': model('Claude B', 0.4),
      }),
    );
    const result = await antigravityProvider.fetchQuota(makeConfig({ token: 'tok-1' }));
    expect(result.windows).toHaveLength(1);
    expect(result.windows[0]!.name).toBe('Claude+GPT (5h)');
  });

  it('returns error when API returns no models', async () => {
    fetchSpy.mockResolvedValue(okResponse({}));
    const result = await antigravityProvider.fetchQuota(makeConfig({ token: 'tok-1' }));
    expect(result.status).toBe('error');
    expect(result.error).toContain('no models');
  });

  it('returns auth_expired on 401 so token-manager can refresh + retry', async () => {
    fetchSpy.mockResolvedValue(new Response('unauthorized', { status: 401 }));
    const result = await antigravityProvider.fetchQuota(makeConfig({ token: 'dead' }));
    expect(result.status).toBe('auth_expired');
  });

  it('returns error on network failure', async () => {
    fetchSpy.mockRejectedValue(new Error('ECONNRESET'));
    const result = await antigravityProvider.fetchQuota(makeConfig({ token: 'tok-1' }));
    expect(result.status).toBe('error');
    expect(result.error).toContain('ECONNRESET');
  });

  it('falls back to config.id when email absent', async () => {
    fetchSpy.mockResolvedValue(okResponse({ 'claude-b': model('Claude B', 1) }));
    const result = await antigravityProvider.fetchQuota(makeConfig({ token: 'tok-1' }));
    expect(result.account).toBe('antigravity-main');
  });
});
