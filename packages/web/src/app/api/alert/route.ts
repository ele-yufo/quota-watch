import { QuotaDB } from '@quota-watch/core';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { type NextRequest } from 'next/server';
import type { AlertRule } from '@quota-watch/core';

const DB_PATH = join(homedir(), '.quota-watch', 'data.db');

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const provider = searchParams.get('provider') ?? undefined;

  const db = new QuotaDB(DB_PATH);
  try {
    const rules = db.getAlertRules(provider);
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

  const db = new QuotaDB(DB_PATH);
  try {
    db.deleteAlertRule(id);
    return Response.json({ ok: true });
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

  const db = new QuotaDB(DB_PATH);
  try {
    // Resolve provider slug to UUID (alert_rules FK references providers.id)
    let providerId = rule.provider;
    const resolved = db.getProviderBySlug(rule.provider);
    if (resolved) {
      providerId = resolved.id;
    } else {
      // Also try direct UUID lookup
      const direct = db.getProvider(rule.provider);
      if (!direct) {
        return Response.json(
          { error: `Provider not found: ${rule.provider}` },
          { status: 400 },
        );
      }
      providerId = direct.id;
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
