import { QuotaDB, buildQuotaResponse } from '@quota-watch/core';
import { join } from 'node:path';
import { homedir } from 'node:os';

const DB_PATH = join(homedir(), '.quota-watch', 'data.db');

/**
 * GET /api/quota — latest snapshot per provider×window, windows sorted by
 * kind (session → day → week → month). Same shape as the daemon API's /quota
 * so web + iOS render identically.
 */
export async function GET() {
  const db = new QuotaDB(DB_PATH);
  try {
    return Response.json(buildQuotaResponse(db));
  } finally {
    db.close();
  }
}
