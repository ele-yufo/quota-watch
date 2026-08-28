import { QuotaDB } from '@quota-watch/core';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { type NextRequest } from 'next/server';
import type { AlertRule } from '@quota-watch/core';

const DB_PATH = join(homedir(), '.quota-watch', 'data.db');

/** Open the DB as JSON-500 on failure — a raw throw renders an HTML error page. */
function openDb(): QuotaDB | Response {
  try {
    return new QuotaDB(DB_PATH);
  } catch (err) {
    return Response.json(
      { error: `database unavailable: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    );
  }
}

/** POST accepts slug or UUID; GET historically took only the UUID — resolve both. */
function resolveProviderId(db: QuotaDB, slugOrId: string): string | null {
  return db.getProviderBySlug(slugOrId)?.id ?? db.getProvider(slugOrId)?.id ?? null;
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const provider = searchParams.get('provider') ?? undefined;

  const db = openDb();
  if (db instanceof Response) return db;
  try {
    const rules = db.getAlertRules(provider ? (resolveProviderId(db, provider) ?? provider) : undefined);
    return Response.json(rules);
  } finally {
    db.close();
  }
}

export async function DELETE(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const id = searchParams.get('id');

  if (!id) {
    return Response.json({ error: 'Missing required query parameter: id' }, { status: 400 });
  }

  const db = openDb();
  if (db instanceof Response) return db;
  try {
    db.deleteAlertRule(id);
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  } finally {
    db.close();
  }
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const rule = body as Partial<AlertRule>;

  if (!rule.id || !rule.provider || !rule.windowName || rule.thresholdPct == null) {
    return Response.json(
      { error: 'Missing required fields: id, provider, windowName, thresholdPct' },
      { status: 400 },
    );
  }

  // 'abc'/NaN/0/-5 all passed the old check: NaN violates the DB column,
  // 0 makes a dead rule that can never fire, ≥100 fires every single poll.
  if (
    typeof rule.thresholdPct !== 'number' ||
    !Number.isFinite(rule.thresholdPct) ||
    rule.thresholdPct <= 0 ||
    rule.thresholdPct >= 100
  ) {
    return Response.json(
      { error: 'thresholdPct must be a finite number in (0, 100)' },
      { status: 400 },
    );
  }

  const db = openDb();
  if (db instanceof Response) return db;
  try {
    // Resolve provider slug to UUID (alert_rules FK references providers.id)
    const providerId = resolveProviderId(db, rule.provider);
    if (!providerId) {
      return Response.json(
        { error: `Provider not found: ${rule.provider}` },
        { status: 400 },
      );
    }

    const newRule: AlertRule = {
      id: rule.id,
      provider: providerId,
      windowName: rule.windowName,
      thresholdPct: rule.thresholdPct,
      channels: rule.channels ?? ['macos_notification'],
      cooldownMs: rule.cooldownMs ?? 3600000,
      enabled: rule.enabled ?? true,
    };

    db.addAlertRule(newRule);
    return Response.json(newRule, { status: 201 });
  } finally {
    db.close();
  }
}
