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
    expect(result.plan).toBe('Claude'); // profile unreachable in tests → neutral label
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

  describe('scoped weekly limits (Fable-only bucket etc.)', () => {
    // Entry shape mirrors the live API (verified against Paseo's provider
    // tests): percent is USED %, scope carries the label.
    const fableLimit = (overrides: Record<string, unknown> = {}) => ({
      kind: 'weekly_scoped',
      group: 'weekly',
      percent: 12,
      severity: 'normal',
      resets_at: '2026-07-07T00:00:00Z',
      is_active: true,
      scope: { model: { id: null, display_name: 'Fable' }, surface: null },
      ...overrides,
    });

    it('renders a scoped weekly limit as its own window', async () => {
      fetchSpy.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ ...mockUsageResponse, limits: [fableLimit()] }),
      });
      const result = await claudeProvider.fetchQuota(makeConfig());
      expect(result.status).toBe('ok');
      const fable = result.windows.find((w) => w.name === 'weekly fable (7d)');
      expect(fable).toBeDefined();
      expect(fable!.kind).toBe('week');
      expect(fable!.used).toBe(12);
      expect(fable!.remaining).toBe(88);
      expect(fable!.resetAt).toBe('2026-07-07T00:00:00Z');
    });

    it('skips unscoped session/weekly_all duplicates of the top-level windows', async () => {
      fetchSpy.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          ...mockUsageResponse,
          limits: [
            { kind: 'session', percent: 87, resets_at: '2026-06-30T15:00:00Z', scope: null },
            { kind: 'weekly_all', percent: 45, resets_at: '2026-07-07T00:00:00Z', scope: null },
            fableLimit(),
          ],
        }),
      });
      const result = await claudeProvider.fetchQuota(makeConfig());
      expect(result.windows).toHaveLength(4); // 3 top-level + fable
    });

    it('skips malformed or unlabelled entries without losing the good windows', async () => {
      fetchSpy.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          ...mockUsageResponse,
          limits: [
            { percent: 'not-a-number' },
            null,
            { kind: 'weekly_scoped', percent: 5, scope: { model: { display_name: 42 } } },
            fableLimit({ scope: { model: { id: null, display_name: null }, surface: null } }),
            fableLimit({ scope: { model: null, surface: { id: 'code', display_name: 'Code' } } }),
          ],
        }),
      });
      const result = await claudeProvider.fetchQuota(makeConfig());
      expect(result.status).toBe('ok');
      expect(result.windows.map((w) => w.name)).toContain('weekly code (7d)');
      expect(result.windows).toHaveLength(4);
    });
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

  it('exponential streak caps at 15min and never extends the wait past Retry-After', async () => {
    const { _cooldownRemainingMs } = await import('../../src/providers/claude.js');
    const cfg = makeConfig({ id: 'claude-cap', credentials: { token: 't' } });
    const r429 = { ok: false, status: 429, statusText: 'Too Many Requests' };

    vi.useFakeTimers();
    try {
      // 4 consecutive 429s without Retry-After: 180s → 360s → 720s → 1440s
      // raw, which must cap at MAX_BACKOFF_MS (15min), not keep doubling.
      for (const advanceMs of [0, 181_000, 361_000, 721_000]) {
        if (advanceMs) vi.setSystemTime(Date.now() + advanceMs);
        fetchSpy.mockResolvedValueOnce(r429);
        await claudeProvider.fetchQuota(cfg);
      }
      const fourth = _cooldownRemainingMs('claude-cap');
      expect(fourth).toBeGreaterThan(800_000); // a real backoff, not the base
      expect(fourth).toBeLessThanOrEqual(900_000); // …but capped at 15min (raw: 24min)

      // A long streak (backoff at the 15min cap) must NOT push the cooldown
      // past what the server asked: Retry-After 600s → wait ~600s, not 900s.
      vi.setSystemTime(Date.now() + 901_000);
      fetchSpy.mockResolvedValueOnce({
        ok: false, status: 429, statusText: 'Too Many Requests',
        headers: { get: (h: string) => (h === 'retry-after' ? '600' : null) },
      });
      await claudeProvider.fetchQuota(cfg);
      const fifth = _cooldownRemainingMs('claude-cap');
      expect(fifth).toBeGreaterThan(500_000);
      expect(fifth).toBeLessThanOrEqual(600_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it('backoff grows exponentially on consecutive 429s, Retry-After can only lengthen it, success resets', async () => {
    const { _cooldownRemainingMs } = await import('../../src/providers/claude.js');
    const cfg = makeConfig({ id: 'claude-bo', credentials: { token: 't' } });
    const r429 = { ok: false, status: 429, statusText: 'Too Many Requests' };

    // 1st 429 → ~180s base
    fetchSpy.mockResolvedValueOnce(r429);
    await claudeProvider.fetchQuota(cfg);
    const first = _cooldownRemainingMs('claude-bo');
    expect(first).toBeGreaterThan(100_000);
    expect(first).toBeLessThanOrEqual(180_000);

    // 2nd consecutive 429 on the SAME id (after the first cooldown lapses) → ~360s
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 181_000);
    fetchSpy.mockResolvedValueOnce(r429);
    await claudeProvider.fetchQuota(cfg);
    const second = _cooldownRemainingMs('claude-bo'); // measure inside fake time
    expect(second).toBeGreaterThan(300_000);
    expect(second).toBeLessThanOrEqual(360_000);
    vi.useRealTimers();

    // Retry-After SHORTER than backoff must not shorten the wait (no 1s poll loop)
    fetchSpy.mockResolvedValueOnce({
      ok: false, status: 429, statusText: 'Too Many Requests',
      headers: { get: (h: string) => (h === 'retry-after' ? '1' : null) },
    });
    await claudeProvider.fetchQuota(makeConfig({ id: 'claude-ra1', credentials: { token: 't' } }));
    expect(_cooldownRemainingMs('claude-ra1')).toBeGreaterThan(100_000);

    // Retry-After LONGER than backoff wins
    fetchSpy.mockResolvedValueOnce({
      ok: false, status: 429, statusText: 'Too Many Requests',
      headers: { get: (h: string) => (h === 'retry-after' ? '900' : null) },
    });
    await claudeProvider.fetchQuota(makeConfig({ id: 'claude-ra2', credentials: { token: 't' } }));
    expect(_cooldownRemainingMs('claude-ra2')).toBeGreaterThan(800_000);

    // HTTP-date Retry-After is understood too
    fetchSpy.mockResolvedValueOnce({
      ok: false, status: 429, statusText: 'Too Many Requests',
      headers: { get: (h: string) => (h === 'retry-after' ? new Date(Date.now() + 900_000).toUTCString() : null) },
    });
    await claudeProvider.fetchQuota(makeConfig({ id: 'claude-ra3', credentials: { token: 't' } }));
    expect(_cooldownRemainingMs('claude-ra3')).toBeGreaterThan(800_000);

    // success after a real 429 clears the streak on that id
    _resetCooldowns();
    fetchSpy.mockResolvedValueOnce(r429);
    await claudeProvider.fetchQuota(cfg);
    expect(_cooldownRemainingMs('claude-bo')).toBeGreaterThan(0);
    _resetCooldowns(); // drop the cooldown so the success fetch can run
    fetchSpy.mockResolvedValueOnce({
      ok: true, status: 200, json: () => Promise.resolve(mockUsageResponse),
    });
    const ok = await claudeProvider.fetchQuota(cfg);
    expect(ok.status).toBe('ok');
    expect(_cooldownRemainingMs('claude-bo')).toBe(0);

    // …and a fresh 429 on that id starts back at the base (~180s), proving the streak reset
    fetchSpy.mockResolvedValueOnce(r429);
    await claudeProvider.fetchQuota(cfg);
    expect(_cooldownRemainingMs('claude-bo')).toBeLessThanOrEqual(180_000);
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
