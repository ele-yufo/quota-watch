import {
  QuotaDB,
  PROVIDER_AUTH_META,
  getProviderAuthMeta,
  resolveOpenCodeGoCredentials,
} from '@quota-watch/core';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { type NextRequest } from 'next/server';

const DB_PATH = join(homedir(), '.quota-watch', 'data.db');

/** GET — list provider auth metadata + currently configured providers. */
export async function GET() {
  const db = new QuotaDB(DB_PATH);
  try {
    const configured = db.listProviders().map((p) => ({
      id: p.id,
      provider: p.provider,
      displayName: p.displayName,
      enabled: p.enabled,
      // never ship stored credential VALUES to the client — field names only
      credentialKeys: Object.keys(p.credentials),
    }));
    return Response.json({ meta: PROVIDER_AUTH_META, configured });
  } finally {
    db.close();
  }
}

/**
 * POST — add/update a provider.
 * api-key providers send `credentials: {field: value}` matching meta.fields
 * (legacy single `apiKey` body still accepted). oauth-file providers store
 * empty credentials — the adapter reads the CLI file at fetch time.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const { slug, displayName, apiKey, credentials: bodyCredentials, autoImport } = body as {
    slug?: string;
    displayName?: string;
    apiKey?: string;
    credentials?: Record<string, string>;
    autoImport?: boolean;
  };
  if (!slug) return Response.json({ error: 'slug required' }, { status: 400 });
  const meta = getProviderAuthMeta(slug);
  if (!meta) return Response.json({ error: `unknown provider: ${slug}` }, { status: 400 });

  const credentials: Record<string, string> = {};
  if (slug === 'opencode-go' && autoImport) {
    // pull detected env/community-CLI credentials server-side; the values
    // never round-trip through the browser
    const detected = resolveOpenCodeGoCredentials({});
    if (!detected) {
      return Response.json({ error: 'no importable opencode-go credentials found' }, { status: 400 });
    }
    credentials.workspaceId = detected.workspaceId;
    credentials.authCookie = detected.authCookie;
  } else if (meta.authKind === 'api-key') {
    const fields = meta.fields ?? [{ key: 'apiKey', label: 'API Key' }];
    for (const field of fields) {
      const value = bodyCredentials?.[field.key] ?? (fields.length === 1 ? apiKey : undefined);
      if (!value?.trim()) {
        return Response.json({ error: `${field.key} required` }, { status: 400 });
      }
      credentials[field.key] = value.trim();
    }
  }
  // oauth-file: credentials intentionally empty — resolved from CLI file at fetch time

  const now = new Date().toISOString();
  const config = {
    id: randomUUID(),
    provider: slug,
    displayName: displayName || meta.displayName,
    credentials,
    enabled: true,
    createdAt: now,
    updatedAt: now,
  };
  const db = new QuotaDB(DB_PATH);
  try {
    const existing = db.listProviders().find((p) => p.provider === slug);
    if (existing) {
      // re-configuring: update credentials in place (don't 409 — that stranded
      // users who re-typed a key, since the old row stayed with stale creds)
      const updated = {
        ...existing,
        displayName: displayName || existing.displayName,
        credentials,
        updatedAt: new Date().toISOString(),
      };
      db.upsertProvider(updated);
      return Response.json({ ...updated, credentials: undefined }, { status: 200 });
    }
    db.upsertProvider(config);
    return Response.json({ ...config, credentials: undefined }, { status: 201 });
  } finally {
    db.close();
  }
}

/** DELETE — remove a provider by id. */
export async function DELETE(request: NextRequest) {
  const id = request.nextUrl.searchParams.get('id');
  if (!id) return Response.json({ error: 'id required' }, { status: 400 });
  const db = new QuotaDB(DB_PATH);
  try {
    db.deleteProvider(id);
    return Response.json({ ok: true });
  } finally {
    db.close();
  }
}
