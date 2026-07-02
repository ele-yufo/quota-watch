/**
 * refresh.ts — proactive token refresh for OAuth providers whose tokens come
 * from official CLI credential files.
 *
 * Anthropic/OpenAI don't issue OAuth client_ids to third parties, so we can't
 * run our own OAuth flow. But we CAN take the refresh_token the official CLI
 * stored, exchange it at the provider's token endpoint, and write the fresh
 * tokens back to the SAME file — keeping quota-watch and the official CLI in
 * sync.
 *
 * Data-driven: each provider is a REFRESH_SPEC entry. Adding a new file-based
 * OAuth provider means appending one spec, not editing refresh/write/persist
 * in four mirrored places.
 *
 * Endpoints reverse-engineered from Claude Code 2.1.196 and Codex 0.137.0.
 */
import { homedir } from "node:os";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { antigravityTokensPath } from "./credential-source.js";

export interface RefreshedTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // epoch ms
}

interface RefreshSpec {
  slug: string;
  tokenUrl: string;
  clientId: string;
  /** confidential-client secret — only Google's endpoint requires one */
  clientSecret?: string;
  /** request body encoding — Claude uses JSON, Codex uses form-urlencoded */
  bodyKind: "json" | "form";
  /** default access_token TTL (seconds) if the response omits expires_in */
  expiresDefaultSec: number;
  /** path to the CLI credential file; null when it can't be located (e.g. never logged in) */
  filePath: () => string | null;
  /** extract the current refresh_token from the parsed file */
  readRefreshToken: (raw: Record<string, unknown>) => string | undefined;
  /** merge refreshed tokens back into the parsed file object (mutates) */
  writeTokens: (raw: Record<string, unknown>, tokens: RefreshedTokens) => void;
}

// NOTE: scope is intentionally NOT sent — platform.claude.com returns HTTP 400
// invalid_scope if scope is included. The refresh_token carries its own scope.
const SPECS: RefreshSpec[] = [
  {
    slug: "claude",
    tokenUrl: "https://platform.claude.com/v1/oauth/token",
    clientId: "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
    bodyKind: "json",
    expiresDefaultSec: 600,
    filePath: () => join(homedir(), ".claude", ".credentials.json"),
    readRefreshToken: (raw) => {
      const o = raw.claudeAiOauth as { refreshToken?: string } | undefined;
      return o?.refreshToken;
    },
    writeTokens: (raw, tokens) => {
      raw.claudeAiOauth = {
        ...(raw.claudeAiOauth as object | undefined),
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresAt,
      };
    },
  },
  {
    slug: "codex",
    tokenUrl: "https://auth.openai.com/oauth/token",
    clientId: "app_EMoamEEZ73f0CkXaXp7hrann",
    bodyKind: "form",
    expiresDefaultSec: 3600,
    filePath: () => join(homedir(), ".codex", "auth.json"),
    readRefreshToken: (raw) => {
      const t = raw.tokens as { refresh_token?: string } | undefined;
      return t?.refresh_token;
    },
    writeTokens: (raw, tokens) => {
      const t = (raw.tokens ?? {}) as Record<string, unknown>;
      t.access_token = tokens.accessToken;
      t.refresh_token = tokens.refreshToken;
      raw.tokens = t;
      raw.last_refresh = new Date().toISOString();
    },
  },
  {
    // Community antigravity-usage CLI token store (Google OAuth). The Google
    // installed-app client_id/secret belong to that CLI, not to quota-watch, so
    // we don't ship them — set ANTIGRAVITY_OAUTH_CLIENT_SECRET (and, if it ever
    // changes, ANTIGRAVITY_OAUTH_CLIENT_ID) to enable proactive refresh. Without
    // them, quota-watch still reads the token the CLI already refreshed on disk;
    // it just can't refresh it itself.
    slug: "antigravity",
    tokenUrl: "https://oauth2.googleapis.com/token",
    clientId:
      process.env.ANTIGRAVITY_OAUTH_CLIENT_ID ??
      "1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com",
    clientSecret: process.env.ANTIGRAVITY_OAUTH_CLIENT_SECRET,
    bodyKind: "form",
    expiresDefaultSec: 3600,
    filePath: () => antigravityTokensPath(),
    readRefreshToken: (raw) =>
      typeof raw.refreshToken === "string" ? raw.refreshToken : undefined,
    writeTokens: (raw, tokens) => {
      raw.accessToken = tokens.accessToken;
      raw.refreshToken = tokens.refreshToken;
      raw.expiresAt = tokens.expiresAt;
    },
  },
];

async function refreshWithSpec(
  spec: RefreshSpec,
  refreshToken: string,
): Promise<RefreshedTokens | null> {
  try {
    const body: Record<string, string> = {
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: spec.clientId,
    };
    if (spec.clientSecret) body.client_secret = spec.clientSecret;
    const init: RequestInit =
      spec.bodyKind === "json"
        ? {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }
        : {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams(body).toString(),
          };
    const res = await globalThis.fetch(spec.tokenUrl, init);
    if (!res.ok) return null;
    const data = (await res.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
    };
    if (!data.access_token) return null;
    const expiresIn =
      typeof data.expires_in === "number" ? data.expires_in : spec.expiresDefaultSec;
    return {
      accessToken: data.access_token,
      // refresh_token may rotate (codex always does); fall back to the old one
      refreshToken: data.refresh_token ?? refreshToken,
      expiresAt: Date.now() + expiresIn * 1000,
    };
  } catch {
    return null;
  }
}

/**
 * Refresh + persist for a file-based provider. Reads the credential file once,
 * exchanges its refresh_token, and writes the fresh tokens back. Returns null
 * if the provider isn't file-based or the refresh failed (caller treats as
 * needs-relogin).
 */
export async function refreshAndPersist(providerSlug: string): Promise<RefreshedTokens | null> {
  const spec = SPECS.find((s) => s.slug === providerSlug);
  if (!spec) return null;

  const filePath = spec.filePath();
  if (!filePath) return null;

  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(readFileSync(filePath, "utf-8")) as Record<string, unknown>;
  } catch {
    return null;
  }

  const rt = spec.readRefreshToken(raw);
  if (!rt) return null;

  const refreshed = await refreshWithSpec(spec, rt);
  if (refreshed) {
    try {
      spec.writeTokens(raw, refreshed);
      writeFileSync(filePath, JSON.stringify(raw, null, 2));
    } catch {
      // best effort — refresh succeeded in-memory; file write failure (concurrent
      // CLI write truncating the file, EACCES) must not crash the poll loop.
    }
  }
  return refreshed;
}
