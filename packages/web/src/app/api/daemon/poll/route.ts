import { loadAppConfig } from '@quota-watch/core';

/**
 * POST /api/daemon/poll — trigger an immediate poll of all providers via the
 * daemon's embedded API ("refresh now" button).
 */
export async function POST() {
  const config = loadAppConfig();
  try {
    const res = await fetch(`http://127.0.0.1:${config.api.port}/poll`, {
      method: 'POST',
      // a full poll fans out to every provider — allow slow upstreams
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      return Response.json({ ok: false, error: `poll returned ${res.status}` }, { status: 502 });
    }
    return Response.json(await res.json());
  } catch {
    return Response.json(
      { ok: false, error: 'daemon not running — start it with: quota-watch daemon start' },
      { status: 502 },
    );
  }
}
