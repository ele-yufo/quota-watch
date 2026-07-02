import {
  resolveCliTokens,
  resolveOpenCodeGoCredentials,
  getProviderAuthMeta,
} from '@quota-watch/core';
import { type NextRequest } from 'next/server';

/**
 * GET /api/auth/scan?slug=claude — detect whether reusable credentials for a
 * provider already exist on this machine.
 *
 * oauth-file providers: the CLI credential file (claude/codex/antigravity).
 * opencode-go: the community opencode-quota config file or env vars — found
 * credentials can be imported without retyping the cookie.
 */
export async function GET(request: NextRequest) {
  const slug = request.nextUrl.searchParams.get('slug');
  if (!slug) return Response.json({ error: 'slug required' }, { status: 400 });

  const meta = getProviderAuthMeta(slug);
  if (!meta) return Response.json({ error: `unknown provider: ${slug}` }, { status: 400 });

  // opencode-go: env vars / community CLI config file
  if (slug === 'opencode-go') {
    const creds = resolveOpenCodeGoCredentials({});
    if (!creds) {
      return Response.json({
        found: false,
        hint: '未找到现成凭据 — 手动填 Workspace ID + Auth Cookie，或配置过 @slkiser/opencode-quota 的话会被自动识别',
      });
    }
    return Response.json({
      found: true,
      source: creds.source,
      // safe to import server-side on connect; values never sent to the client
      importable: true,
    });
  }

  if (meta.authKind !== 'oauth-file') {
    return Response.json({ found: false, reason: 'not a file-based provider' });
  }

  const tokens = resolveCliTokens(slug);
  if (!tokens) {
    return Response.json({
      found: false,
      hint: meta.cliLoginHint ?? 'Run the official CLI to log in',
    });
  }

  return Response.json({
    found: true,
    source: tokens.source,
    account: tokens.extra?.email,
    expiresAt: tokens.expiresAt,
    expired: tokens.expiresAt ? tokens.expiresAt < Date.now() : false,
  });
}
