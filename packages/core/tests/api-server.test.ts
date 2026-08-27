import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import https from 'node:https';
import { readFileSync } from 'node:fs';
import { ensureTlsConfig } from '../src/certs.js';
import { QuotaDB } from '../src/db.js';
import { QuotaScheduler } from '../src/scheduler.js';
import { ProviderRegistry } from '../src/providers/registry.js';
import { startApiServer } from '../src/api-server.js';
import { quotaOk, percentWindow } from '../src/providers/base.js';
import type { ProviderConfig } from '../src/types.js';

let dir: string;
let db: QuotaDB;
let scheduler: QuotaScheduler;
let server: Server;
let basePort: number;
let caPem: string;

const PROVIDER: ProviderConfig = {
  id: 'test-1',
  provider: 'fake',
  displayName: 'Fake',
  credentials: {},
  enabled: true,
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
};

const fakeAdapter = {
  id: 'fake',
  displayName: 'Fake',
  fetchQuota: vi.fn(async () =>
    quotaOk('fake', 'test-1', 'test-plan', [
      percentWindow('weekly (7d)', 'week', 20, null),
      percentWindow('session (5h)', 'session', 10, null),
    ]),
  ),
};

async function listen(token: string | null): Promise<void> {
  const tls = ensureTlsConfig(join(dir, 'certs'));
  caPem = readFileSync(tls.caPath, 'utf-8');
  server = await startApiServer({
    db,
    scheduler,
    host: '127.0.0.1',
    port: 0,
    token,
    tls: { certPath: tls.certPath, keyPath: tls.keyPath, caPath: tls.caPath },
  });
  const addr = server.address();
  if (addr === null || typeof addr === 'string') throw new Error('no port');
  basePort = addr.port;
}

/** HTTPS request pinned to the daemon's own CA — Node's fetch can't take a ca option. */
function api(
  path: string,
  init?: { method?: string; headers?: Record<string, string> },
): Promise<{ status: number; json(): Promise<unknown> }> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        host: '127.0.0.1',
        port: basePort,
        path,
        method: init?.method ?? 'GET',
        ca: caPem,
        headers: init?.headers,
      },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, json: async () => (body ? JSON.parse(body) : null) }),
        );
      },
    );
    req.on('error', reject);
    req.end();
  });
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'qw-api-'));
  db = new QuotaDB(join(dir, 'data.db'));
  db.upsertProvider(PROVIDER);
  const registry = new ProviderRegistry();
  registry.register(fakeAdapter);
  scheduler = new QuotaScheduler({ registry, db });
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  scheduler.stop();
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('daemon API server', () => {
  it('GET /health reports providers and poll intervals', async () => {
    await listen(null);
    const res = await api('/health');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.pid).toBe(process.pid);
    expect(body.providers).toHaveLength(1);
    expect(body.providers[0].id).toBe('test-1');
    expect(body.providers[0].pollIntervalMs).toBeGreaterThan(0);
  });

  it('POST /poll triggers an immediate fetch and /quota returns kind-sorted windows', async () => {
    await listen(null);
    const poll = await api('/poll', { method: 'POST' });
    expect(poll.status).toBe(200);
    expect(fakeAdapter.fetchQuota).toHaveBeenCalled();

    const res = await api('/quota');
    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0].providerId).toBe('test-1');
    // session before week regardless of insert order
    expect(body[0].windows.map((w: { windowKind: string }) => w.windowKind)).toEqual([
      'session',
      'week',
    ]);
  });

  it('POST /poll?provider=x polls only that provider', async () => {
    await listen(null);
    const res = await api('/poll?provider=test-1', { method: 'POST' });
    expect((await res.json()).polled).toBe('test-1');
  });

  it('unknown routes return 404', async () => {
    await listen(null);
    const res = await api('/nope');
    expect(res.status).toBe(404);
  });

  it('loopback requests skip token auth when no token is configured', async () => {
    await listen(null);
    const res = await api('/health');
    expect(res.status).toBe(200);
  });

  it('token auth applies to loopback too when a token is set', async () => {
    // Behind an frp tunnel the daemon sees every connection as 127.0.0.1, so a
    // loopback exemption with a token configured would expose the public
    // internet unauthenticated — token mode is strict everywhere.
    await listen('secret-token');
    const res = await api('/health');
    expect(res.status).toBe(401);
    const authed = await api('/health', {
      headers: { Authorization: 'Bearer secret-token' },
    });
    expect(authed.status).toBe(200);
  });
});
