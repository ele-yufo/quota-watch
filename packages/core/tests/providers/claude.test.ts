import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { claudeProvider, _resetCooldowns } from '../../src/providers/claude.js';
import type { ProviderConfig } from '../../src/types.js';

// ── Helpers ──────────────────────────────────────────────────────────────

function makeConfig(overrides?: Partial<ProviderConfig>): ProviderConfig {
  return {
    id: 'claude-main',
    provider: 'claude',
    displayName: 'Claude Code',
    credentials: { token: 'test-token-abc' },
    enabled: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

const mockUsageResponse = {
  five_hour: { utilization: 87, resets_at: '2026-06-30T15:00:00Z' },
  seven_day: { utilization: 45, resets_at: '2026-07-07T00:00:00Z' },
  seven_day_sonnet: { utilization: 30, resets_at: '2026-07-07T00:00:00Z' },
};

describe('claudeProvider', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    _resetCooldowns();
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    _resetCooldowns();
  });

  // ── Basic properties ───────────────────────────────────────────────

  it('has correct id and displayName', () => {
    expect(claudeProvider.id).toBe('claude');
    expect(claudeProvider.displayName).toBe('Claude Code');
  });

  // ── Not configured ─────────────────────────────────────────────────

  it('returns not_configured when no token is set', async () => {
    const result = await claudeProvider.fetchQuota(
      makeConfig({ credentials: {} }),
    );
    expect(result.status).toBe('not_configured');
    expect(result.error).toBe('No OAuth token configured');
    expect(result.windows).toEqual([]);
  });

  // ── Successful fetch ───────────────────────────────────────────────

  it('fetches and maps quota windows correctly', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(mockUsageResponse),
    });

    const result = await claudeProvider.fetchQuota(makeConfig());

    expect(result.status).toBe('ok');
    expect(result.provider).toBe('claude');
    expect(result.account).toBe('claude-main');
    expect(result.plan).toBe('claude-code');
    expect(result.windows).toHaveLength(3);

    // session (5h)
    const session = result.windows[0];
    expect(session.name).toBe('session (5h)');
    expect(session.used).toBe(87);
    expect(session.total).toBe(100);
    expect(session.unit).toBe('percent');
    expect(session.remaining).toBe(13);
    expect(session.remainingPct).toBe(13);
    expect(session.resetAt).toBe('2026-06-30T15:00:00Z');
    expect(session.unlimited).toBe(false);

    // weekly (7d)
    const weekly = result.windows[1];
    expect(weekly.name).toBe('weekly (7d)');
    expect(weekly.used).toBe(45);
    expect(weekly.remaining).toBe(55);
    expect(weekly.resetAt).toBe('2026-07-07T00:00:00Z');

    // weekly sonnet (7d)
    const sonnet = result.windows[2];
    expect(sonnet.name).toBe('weekly sonnet (7d)');
    expect(sonnet.used).toBe(30);
    expect(sonnet.remaining).toBe(70);
  });

  it('sends correct headers', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(mockUsageResponse),
    });

    await claudeProvider.fetchQuota(makeConfig());

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.anthropic.com/api/oauth/usage',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: `Bearer test-token-abc`,
          'anthropic-beta': 'oauth-2025-04-20',
        }),
      }),
    );
  });

  // ── 429 rate limit & cooldown ──────────────────────────────────────

  it('returns error status on 429 and enters cooldown', async () => {
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
    });

    const result = await claudeProvider.fetchQuota(makeConfig());

    expect(result.status).toBe('error');
    expect(result.error).toBe('Rate limited (429)');

    // Second call should hit cooldown without making a fetch
    fetchSpy.mockClear();
    const result2 = await claudeProvider.fetchQuota(makeConfig());

    expect(result2.status).toBe('error');
    expect(result2.error).toBe('Rate limited (429), cooling down');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('different provider instances have independent cooldowns', async () => {
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
    });

    // cooldown is keyed by provider config id (so token rotation doesn't bypass
    // a cooldown set on the previous token); two distinct instances are independent.
    const config1 = makeConfig({ id: 'claude-a', credentials: { token: 'token-a' } });
    const config2 = makeConfig({ id: 'claude-b', credentials: { token: 'token-b' } });

    await claudeProvider.fetchQuota(config1);

    // claude-a is in cooldown, claude-b is not
    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(mockUsageResponse),
    });

    const result2 = await claudeProvider.fetchQuota(config2);
    expect(result2.status).toBe('ok');
    expect(fetchSpy).toHaveBeenCalled();
  });

  // ── Auth errors ────────────────────────────────────────────────────

  it('returns auth_expired on 401', async () => {
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
    });

    const result = await claudeProvider.fetchQuota(makeConfig());
    expect(result.status).toBe('auth_expired');
    expect(result.error).toBe('HTTP 401: Unauthorized');
  });

  it('returns auth_expired on 403', async () => {
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
    });

    const result = await claudeProvider.fetchQuota(makeConfig());
    expect(result.status).toBe('auth_expired');
    expect(result.error).toBe('HTTP 403: Forbidden');
  });

  // ── Generic HTTP errors ────────────────────────────────────────────

  it('returns error for other non-ok statuses', async () => {
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    });

    const result = await claudeProvider.fetchQuota(makeConfig());
    expect(result.status).toBe('error');
    expect(result.error).toBe('HTTP 500: Internal Server Error');
  });

  // ── Network errors ─────────────────────────────────────────────────

  it('returns error on network failure', async () => {
    fetchSpy.mockRejectedValue(new Error('Network failure'));

    const result = await claudeProvider.fetchQuota(makeConfig());
    expect(result.status).toBe('error');
    expect(result.error).toBe('Network failure');
  });

  // ── Zero utilization ───────────────────────────────────────────────

  it('handles 0% utilization correctly', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({
        five_hour: { utilization: 0, resets_at: '2026-06-30T15:00:00Z' },
        seven_day: { utilization: 0, resets_at: '2026-07-07T00:00:00Z' },
        seven_day_sonnet: { utilization: 0, resets_at: '2026-07-07T00:00:00Z' },
      }),
    });

    const result = await claudeProvider.fetchQuota(makeConfig());
    expect(result.status).toBe('ok');
    expect(result.windows[0].remaining).toBe(100);
    expect(result.windows[0].remainingPct).toBe(100);
  });

  // ── 100% utilization ──────────────────────────────────────────────

  it('handles 100% utilization correctly', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({
        five_hour: { utilization: 100, resets_at: '2026-06-30T15:00:00Z' },
        seven_day: { utilization: 100, resets_at: '2026-07-07T00:00:00Z' },
        seven_day_sonnet: { utilization: 100, resets_at: '2026-07-07T00:00:00Z' },
      }),
    });

    const result = await claudeProvider.fetchQuota(makeConfig());
    expect(result.status).toBe('ok');
    expect(result.windows[0].remaining).toBe(0);
    expect(result.windows[0].remainingPct).toBe(0);
    expect(result.windows[0].used).toBe(100);
  });
});
