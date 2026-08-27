import { loadAppConfig } from '@quota-watch/core';
import { fetchDaemon } from '@/lib/daemon-fetch';

/**
 * POST /api/daemon/poll — trigger an immediate poll of all providers via the
 * daemon's embedded API ("refresh now" button).
 */
export async function POST() {
  const config = loadAppConfig();
  // a full poll fans out to every provider — allow slow upstreams
  const res = await fetchDaemon(config.api.port, '/poll', {
    method: 'POST',
    token: config.api.token,
    timeoutMs: 30_000,
  });
  if (!res.ok) {
    return Response.json({ ok: false, error: `poll returned ${res.status}` }, { status: 502 });
  }
  return Response.json(await res.json());
}
