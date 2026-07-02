import { loadAppConfig } from '@quota-watch/core';

/**
 * GET /api/daemon — daemon liveness for the dashboard. Proxies the daemon's
 * embedded API /health on localhost; a refused connection means the daemon
 * (or at least its API) isn't running.
 */
export async function GET() {
  const config = loadAppConfig();
  try {
    const res = await fetch(`http://127.0.0.1:${config.api.port}/health`, {
      headers: config.api.token ? { Authorization: `Bearer ${config.api.token}` } : undefined,
      signal: AbortSignal.timeout(2000),
      cache: 'no-store',
    });
    if (!res.ok) {
      return Response.json({ running: false, error: `health returned ${res.status}` });
    }
    const health = await res.json();
    return Response.json({ running: true, ...health });
  } catch {
    return Response.json({ running: false });
  }
}
