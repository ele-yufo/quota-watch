import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  opencodeGoProvider,
  resolveOpenCodeGoCredentials,
  _internals,
} from '../../src/providers/opencode-go.js';
import type { ProviderConfig } from '../../src/types.js';

const CREDS = { workspaceId: 'wrk_test123', authCookie: 'Fe26.2**testcookie' };

function makeConfig(credentials: Record<string, string> = CREDS): ProviderConfig {
  return {
    id: 'opencode-main',
    provider: 'opencode-go',
    displayName: 'OpenCode Go',
    credentials,
    enabled: true,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

/** Real-world shaped SolidJS hydration blob (strategy A). */
const HYDRATION_HTML = `
<html><body><script>
window.$R=[];data:{rollingUsage:$R[12]={usagePercent:0,resetInSec:18000,foo:1},
weeklyUsage:$R[13]={usagePercent:37,resetInSec:311132},
monthlyUsage:$R[14]={resetInSec:2364236,usagePercent:18}}
</script></body></html>`;

/** data-slot render format (strategy B). */
const DATA_SLOT_HTML = `
<div data-slot="usage-item">
  <span data-slot="usage-label">Rolling Usage</span>
  <span data-slot="usage-value"> 12%</span>
  <span data-slot="reset-time"><!--$-->Resets in 1 hour 56 minutes<!--/$--></span>
</div>
<div data-slot="usage-item">
  <span data-slot="usage-label">Weekly Usage</span>
  <span data-slot="usage-value"> 37%</span>
  <span data-slot="reset-time">Resets in 3 days 14 hours</span>
</div>
<div data-slot="usage-item">
  <span data-slot="usage-label">Monthly Usage</span>
  <span data-slot="usage-value"> 18%</span>
  <span data-slot="reset-now"></span>
</div>`;

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchSpy = vi.fn();
  vi.stubGlobal('fetch', fetchSpy);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('resolveOpenCodeGoCredentials', () => {
  it('prefers quota-watch config credentials', () => {
    const creds = resolveOpenCodeGoCredentials(CREDS);
    expect(creds).toEqual({ ...CREDS, source: 'quota-watch config' });
  });

  it('requires both fields from the same source', () => {
    // only one field in config → config source rejected (falls through to env/file;
    // in the test env those may or may not exist, so just assert source ≠ config)
    const creds = resolveOpenCodeGoCredentials({ workspaceId: 'wrk_only' });
    expect(creds?.source === 'quota-watch config').toBe(false);
  });

  it('trims whitespace', () => {
    const creds = resolveOpenCodeGoCredentials({
      workspaceId: '  wrk_x ',
      authCookie: ' Fe26.2**y ',
    });
    expect(creds?.workspaceId).toBe('wrk_x');
    expect(creds?.authCookie).toBe('Fe26.2**y');
  });
});

describe('HTML parsing internals', () => {
  it('parses hydration blob in pct-first order', () => {
    const w = _internals.parseHydrationBlob('weeklyUsage:$R[3]={usagePercent:37,resetInSec:100}', 'weeklyUsage');
    expect(w).toEqual({ usagePercent: 37, resetInSec: 100 });
  });

  it('parses hydration blob in reset-first order', () => {
    const w = _internals.parseHydrationBlob('monthlyUsage:$R[9]={resetInSec:200,usagePercent:18.5}', 'monthlyUsage');
    expect(w).toEqual({ usagePercent: 18.5, resetInSec: 200 });
  });

  it('parses human readable durations', () => {
    expect(_internals.parseHumanReadableTime('1 hour 56 minutes')).toBe(6960);
    expect(_internals.parseHumanReadableTime('26 days 17 hours')).toBe(2307600);
    expect(_internals.parseHumanReadableTime('45 seconds')).toBe(45);
    expect(_internals.parseHumanReadableTime('now')).toBe(0);
  });

  it('parses the data-slot format with reset-now', () => {
    const result = _internals.parseDataSlots(DATA_SLOT_HTML);
    expect(result.rolling).toEqual({ usagePercent: 12, resetInSec: 6960 });
    expect(result.weekly).toEqual({ usagePercent: 37, resetInSec: 3 * 86_400 + 14 * 3_600 });
    expect(result.monthly).toEqual({ usagePercent: 18, resetInSec: 0 });
  });

  it('scrapeWindows prefers strategy A and falls back to B', () => {
    expect(_internals.scrapeWindows(HYDRATION_HTML).rolling).toBeDefined();
    expect(_internals.scrapeWindows(DATA_SLOT_HTML).rolling).toBeDefined();
    expect(_internals.scrapeWindows('<html>login</html>')).toEqual({});
  });
});

describe('opencodeGoProvider (native dashboard scraper)', () => {
  it('has correct id, displayName and a poll floor', () => {
    expect(opencodeGoProvider.id).toBe('opencode-go');
    expect(opencodeGoProvider.minPollIntervalMs).toBeGreaterThanOrEqual(30_000);
  });

  it('GETs the workspace /go page with the auth cookie', async () => {
    fetchSpy.mockResolvedValue(new Response(HYDRATION_HTML, { status: 200 }));
    await opencodeGoProvider.fetchQuota(makeConfig());

    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe('https://opencode.ai/workspace/wrk_test123/go');
    expect(init.headers.Cookie).toBe('auth=Fe26.2**testcookie');
    expect(init.headers.Accept).toBe('text/html');
  });

  it('maps the three windows with canonical names, kinds and computed resetAt', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-02T09:34:28Z'));
    fetchSpy.mockResolvedValue(new Response(HYDRATION_HTML, { status: 200 }));

    const result = await opencodeGoProvider.fetchQuota(makeConfig());
    expect(result.status).toBe('ok');
    expect(result.account).toBe('wrk_test123');
    expect(result.windows.map((w) => [w.name, w.kind])).toEqual([
      ['session (5h)', 'session'],
      ['weekly (7d)', 'week'],
      ['monthly (1mo)', 'month'],
    ]);

    const [session, weekly, monthly] = result.windows;
    expect(session!.used).toBe(0);
    expect(session!.resetAt).toBe('2026-07-02T14:34:28.000Z'); // +5h rolling
    expect(weekly!.used).toBe(37);
    expect(monthly!.used).toBe(18);
  });

  it('falls back to data-slot parsing', async () => {
    fetchSpy.mockResolvedValue(new Response(DATA_SLOT_HTML, { status: 200 }));
    const result = await opencodeGoProvider.fetchQuota(makeConfig());
    expect(result.status).toBe('ok');
    expect(result.windows).toHaveLength(3);
    expect(result.windows[0]!.used).toBe(12);
  });

  it('returns not_configured when no credentials anywhere', async () => {
    // config empty + env cleared; community file may exist on dev machines, so
    // point XDG_CONFIG_HOME somewhere empty to isolate.
    vi.stubEnv('OPENCODE_GO_WORKSPACE_ID', '');
    vi.stubEnv('OPENCODE_GO_AUTH_COOKIE', '');
    vi.stubEnv('XDG_CONFIG_HOME', '/nonexistent-quota-watch-test');
    vi.stubEnv('HOME', '/nonexistent-quota-watch-test');

    const result = await opencodeGoProvider.fetchQuota(makeConfig({}));
    expect(result.status).toBe('not_configured');
    expect(result.error).toContain('workspaceId');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns auth_expired on 401/403', async () => {
    fetchSpy.mockResolvedValue(new Response('nope', { status: 401 }));
    const result = await opencodeGoProvider.fetchQuota(makeConfig());
    expect(result.status).toBe('auth_expired');
  });

  it('returns auth_expired when a 200 page has no parseable windows (login page)', async () => {
    fetchSpy.mockResolvedValue(new Response('<html>sign in to opencode</html>', { status: 200 }));
    const result = await opencodeGoProvider.fetchQuota(makeConfig());
    expect(result.status).toBe('auth_expired');
    expect(result.error).toContain('cookie');
  });

  it('returns error with truncated body on 5xx', async () => {
    fetchSpy.mockResolvedValue(new Response('server exploded '.repeat(50), { status: 500 }));
    const result = await opencodeGoProvider.fetchQuota(makeConfig());
    expect(result.status).toBe('error');
    expect(result.error!.length).toBeLessThan(200);
  });

  it('returns error on network failure', async () => {
    fetchSpy.mockRejectedValue(new Error('ENOTFOUND opencode.ai'));
    const result = await opencodeGoProvider.fetchQuota(makeConfig());
    expect(result.status).toBe('error');
    expect(result.error).toContain('ENOTFOUND');
  });
});
