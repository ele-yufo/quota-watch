import { loadAppConfig } from '@quota-watch/core';
import { fetchDaemon } from '@/lib/daemon-fetch';

/**
 * GET /api/daemon/tokens — absolute token usage proxy. Wraps the daemon's
 * /tokens (CLI session-log ledger + per-window budget estimates). A refused
 * connection yields an empty array so the drawer can hide the section.
 */
export async function GET() {
  const config = loadAppConfig();
  const res = await fetchDaemon(config.api.port, '/tokens', { token: config.api.token, timeoutMs: 4000 });
  if (!res.ok) {
    return Response.json([]);
  }
  return Response.json(await res.json());
}
