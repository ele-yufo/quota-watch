import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  quotaError,
  quotaOk,
  percentWindow,
  httpStatusToQuotaStatus,
  fetchJson,
} from '../../src/providers/base.js';
import type { ProviderConfig } from '../../src/types.js';

const CONFIG: ProviderConfig = {
  id: 'cfg-1',
  provider: 'test',
  displayName: 'Test',
  credentials: {},
  enabled: true,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('quotaError', () => {
  it('builds a consistent error envelope', () => {
    const q = quotaError('test', CONFIG, 'auth_expired', 'token dead');
    expect(q.provider).toBe('test');
    expect(q.account).toBe('cfg-1');
    expect(q.plan).toBe('unknown');
    expect(q.status).toBe('auth_expired');
    expect(q.windows).toEqual([]);
    expect(q.error).toBe('token dead');
    expect(Date.parse(q.fetchedAt)).not.toBeNaN();
  });
});

describe('quotaOk', () => {
  it('builds an ok envelope with windows', () => {
    const w = percentWindow('session (5h)', 'session', 42, '2026-07-02T14:00:00Z');
    const q = quotaOk('test', 'acct@x', 'pro', [w]);
    expect(q.status).toBe('ok');
    expect(q.account).toBe('acct@x');
    expect(q.plan).toBe('pro');
    expect(q.windows).toHaveLength(1);
    expect(q.error).toBeUndefined();
  });
});

describe('percentWindow', () => {
  it('fills used/remaining/remainingPct from usedPct', () => {
    const w = percentWindow('weekly (7d)', 'week', 37, '2026-07-06T00:00:00Z');
    expect(w).toEqual({
      name: 'weekly (7d)',
      kind: 'week',
      used: 37,
      total: 100,
      unit: 'percent',
      remaining: 63,
      remainingPct: 63,
      resetAt: '2026-07-06T00:00:00Z',
      unlimited: false,
    });
  });

  it('clamps usedPct into [0,100]', () => {
    expect(percentWindow('w', 'week', -5, null).used).toBe(0);
    expect(percentWindow('w', 'week', 130, null).used).toBe(100);
    expect(percentWindow('w', 'week', 130, null).remainingPct).toBe(0);
  });

  it('supports unlimited windows', () => {
    const w = percentWindow('daily (24h)', 'day', 0, null, { unlimited: true });
    expect(w.unlimited).toBe(true);
  });
});

describe('httpStatusToQuotaStatus', () => {
  it('maps 401/403 to auth_expired, everything else to error', () => {
    expect(httpStatusToQuotaStatus(401)).toBe('auth_expired');
    expect(httpStatusToQuotaStatus(403)).toBe('auth_expired');
    expect(httpStatusToQuotaStatus(429)).toBe('error');
    expect(httpStatusToQuotaStatus(500)).toBe('error');
  });
});

describe('fetchJson', () => {
  it('returns parsed JSON on 200', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ a: 1 }), { status: 200 })),
    );
    const res = await fetchJson<{ a: number }>('https://x.test/api');
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.a).toBe(1);
  });

  it('returns status on non-2xx without throwing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 403 })));
    const res = await fetchJson('https://x.test/api');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(403);
  });

  it('returns a network error result when fetch rejects', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('ECONNREFUSED'))));
    const res = await fetchJson('https://x.test/api');
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.status).toBeNull();
      expect(res.error).toContain('ECONNREFUSED');
    }
  });

  it('returns a parse error result on invalid JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>', { status: 200 })));
    const res = await fetchJson('https://x.test/api');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/JSON/i);
  });

  it('aborts after timeoutMs', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () =>
              reject(new DOMException('aborted', 'AbortError')),
            );
          }),
      ),
    );
    const res = await fetchJson('https://x.test/slow', {}, 20);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/timed out/i);
  });
});
