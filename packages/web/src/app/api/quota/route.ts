import { QuotaDB, buildQuotaResponse } from '@quota-watch/core';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { requireSession } from '@/lib/session';

const DB_PATH = join(homedir(), '.quota-watch', 'data.db');

/**
 * GET /api/quota — latest snapshot per provider×window, windows sorted by
 * kind (session → day → week → month). Same shape as the daemon API's /quota
 * so every client renders identically.
 */
export async function GET(req: Request) {
  const denied = requireSession(req);
  if (denied) return denied;
  let db: QuotaDB;
  try {
    db = new QuotaDB(DB_PATH);
  } catch (err) {
    // A raw throw renders an HTML error page the dashboard can't parse —
    // respond JSON so the client shows its retry state instead.
    return Response.json(
      { error: `database unavailable: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    );
  }
  try {
    return Response.json(buildQuotaResponse(db));
  } finally {
    db.close();
  }
}
