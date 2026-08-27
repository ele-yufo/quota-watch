import { loadAppConfig } from '@quota-watch/core';
import { fetchDaemon } from '@/lib/daemon-fetch';

/**
 * GET /api/daemon — daemon liveness for the dashboard. Proxies the daemon's
 * embedded API /health on localhost; a refused connection means the daemon
 * (or at least its API) isn't running.
 */
export async function GET() {
  const config = loadAppConfig();
  const res = await fetchDaemon(config.api.port, '/health', { token: config.api.token, timeoutMs: 2000 });
  if (!res.ok) {
    return Response.json({ running: false, error: `health returned ${res.status}` });
  }
  const health = await res.json();
  return Response.json({ running: true, ...(health ?? {}) });
}
