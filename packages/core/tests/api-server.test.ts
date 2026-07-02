import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
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
let baseUrl: string;

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
  server = await startApiServer({ db, scheduler, host: '127.0.0.1', port: 0, token });
  const addr = server.address();
  if (addr === null || typeof addr === 'string') throw new Error('no port');
  baseUrl = `http://127.0.0.1:${addr.port}`;
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
    const res = await fetch(`${baseUrl}/health`);
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
    const poll = await fetch(`${baseUrl}/poll`, { method: 'POST' });
    expect(poll.status).toBe(200);
    expect(fakeAdapter.fetchQuota).toHaveBeenCalled();

    const res = await fetch(`${baseUrl}/quota`);
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
    const res = await fetch(`${baseUrl}/poll?provider=test-1`, { method: 'POST' });
    expect((await res.json()).polled).toBe('test-1');
  });

  it('unknown routes return 404', async () => {
    await listen(null);
    const res = await fetch(`${baseUrl}/nope`);
    expect(res.status).toBe(404);
  });

  it('loopback requests skip token auth', async () => {
    await listen('secret-token');
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
  });
});
