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
import { homedir, platform } from "node:os";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { antigravityTokensPath, grokTokensPath } from "./credential-source.js";

/** Refresh HTTP timeout — a hung token endpoint must not wedge the poll loop. */
const REFRESH_TIMEOUT_MS = 15_000;

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
  {
    // xAI OAuth (grok-cli public client — the client_id is the access token's
    // JWT `aud`). Two on-disk layouts share the same account: cliproxyapi's
    // flat xai-*.json and the official CLI's keyed ~/.grok/auth.json; both
    // rotate the refresh token on every refresh (verified live 2026-08), and
    // the CAS write-back in refreshAndPersist keeps a concurrent refresher's
    // newer token from being clobbered.
    slug: "grok",
    tokenUrl: "https://auth.x.ai/oauth2/token",
    clientId: "b1a00492-073a-47ea-816f-4c329264a828",
    bodyKind: "form",
    expiresDefaultSec: 3600,
    filePath: () => grokTokensPath(),
    readRefreshToken: (raw) => {
      if (typeof raw.refresh_token === "string") return raw.refresh_token;
      for (const [k, v] of Object.entries(raw)) {
        if (!k.startsWith("https://auth.x.ai") || typeof v !== "object" || v === null) continue;
        const rt = (v as Record<string, unknown>).refresh_token;
        if (typeof rt === "string") return rt;
      }
      return undefined;
    },
    writeTokens: (raw, tokens) => {
      if ("access_token" in raw) {
        // cliproxyapi layout — `expired` is an ISO timestamp, not a boolean
        raw.access_token = tokens.accessToken;
        raw.refresh_token = tokens.refreshToken;
        raw.expired = new Date(tokens.expiresAt).toISOString();
        raw.last_refresh = new Date().toISOString();
        return;
      }
      for (const [k, v] of Object.entries(raw)) {
        if (!k.startsWith("https://auth.x.ai") || typeof v !== "object" || v === null) continue;
        const entry = v as Record<string, unknown>;
        entry.key = tokens.accessToken;
        entry.refresh_token = tokens.refreshToken;
        entry.expires_at = new Date(tokens.expiresAt).toISOString();
        return;
      }
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
    const res = await globalThis.fetch(spec.tokenUrl, {
      ...init,
      signal: AbortSignal.timeout(REFRESH_TIMEOUT_MS),
    });
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
// ── macOS Keychain fallback (Claude only) ──────────────────────────────
// Claude Code on macOS may store the OAuth blob in the login Keychain
// (service "Claude Code-credentials", same JSON shape) instead of
// .credentials.json. Keychain-only installs could never refresh: the refresher
// read a missing file and gave up, so the access token expired forever. The
// blob travels through the `security` CLI both ways — note the JSON passes
// as an argv briefly during the write, the same exposure the official CLI
// tooling accepts.

const KEYCHAIN_SERVICE = "Claude Code-credentials";

function keychainRead(): { raw: string; account: string } | null {
  if (platform() !== "darwin") return null;
  try {
    const raw = execFileSync(
      "security",
      ["find-generic-password", "-s", KEYCHAIN_SERVICE, "-w"],
      { encoding: "utf-8", timeout: 5000, stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
    let account = "";
    try {
      const attrs = execFileSync(
        "security",
        ["find-generic-password", "-s", KEYCHAIN_SERVICE],
        { encoding: "utf-8", timeout: 5000, stdio: ["ignore", "pipe", "ignore"] },
      );
      account = attrs.match(/^\s*"acct"<blob>="(.*)"\s*$/m)?.[1] ?? "";
    } catch {
      account = "";
    }
    return { raw, account };
  } catch {
    return null;
  }
}

function keychainWrite(account: string, json: string): boolean {
  try {
    execFileSync(
      "security",
      ["add-generic-password", "-U", "-s", KEYCHAIN_SERVICE, "-a", account, "-w", json],
      { timeout: 5000, stdio: ["ignore", "ignore", "ignore"] },
    );
    return true;
  } catch {
    return false;
  }
}

export async function refreshAndPersist(providerSlug: string): Promise<RefreshedTokens | null> {
  const spec = SPECS.find((s) => s.slug === providerSlug);
  if (!spec) return null;

  const filePath = spec.filePath();
  if (!filePath) return null;

  let raw: Record<string, unknown> | null = null;
  let fromKeychain = false;
  let rt: string | undefined;
  try {
    raw = JSON.parse(readFileSync(filePath, "utf-8")) as Record<string, unknown>;
    rt = raw ? spec.readRefreshToken(raw) : undefined;
  } catch {
    // file missing/unreadable — claude falls back to the Keychain blob below
  }
  // Keychain fallback needs the file to lack a refresh token entirely — a
  // file that EXISTS but holds no OAuth creds ({}, stale shape) must not
  // block it, matching the credential reader's own fallback order.
  if (!rt && spec.slug === "claude") {
    const kc = keychainRead();
    if (kc) {
      try {
        const parsed = JSON.parse(kc.raw) as Record<string, unknown>;
        const krt = spec.readRefreshToken(parsed);
        if (krt) {
          raw = parsed;
          rt = krt;
          fromKeychain = true;
        }
      } catch {
        /* keychain blob unparseable — give up below */
      }
    }
  }
  if (!raw || !rt) return null;

  const refreshed = await refreshWithSpec(spec, rt);
  if (!refreshed) return refreshed;

  if (fromKeychain) {
    // CAS against the Keychain blob: if someone else rotated it mid-flight,
    // their state is newer — keep it, use our tokens in-memory only. Without
    // the item's account attribute a targeted -U is impossible — skip the
    // write rather than create a second item while the ORIGINAL keeps the
    // now-invalidated refresh token.
    const kc = keychainRead();
    if (kc && kc.account) {
      try {
        const now = JSON.parse(kc.raw) as Record<string, unknown>;
        if (spec.readRefreshToken(now) === rt) {
          spec.writeTokens(now, refreshed);
          if (keychainWrite(kc.account, JSON.stringify(now))) return refreshed;
        }
      } catch {
        /* fall through — in-memory tokens still valid */
      }
    }
    return refreshed;
  }

  if (refreshed) {
    try {
      // Compare-and-swap against the shared credential file: another process
      // (the official CLI, cliproxyapi) may have refreshed while our exchange
      // was in flight, and for rotating providers (codex, grok) overwriting
      // with our stale read would destroy their newer refresh_token. If the
      // on-disk refresh_token no longer matches the one we exchanged, their
      // state is newer — keep their file, use our tokens in-memory only.
      const now = JSON.parse(readFileSync(filePath, "utf-8")) as Record<string, unknown>;
      if (spec.readRefreshToken(now) === rt) {
        spec.writeTokens(now, refreshed);
        // Atomic write: a crash mid-writeFileSync would leave the OFFICIAL CLI's
        // credential file half-written — breaking the user's `claude`/`codex`
        // login, not just ours. tmp+rename is crash-safe; the pid in the tmp
        // name keeps two quota-watch processes from colliding. Residual race:
        // a non-cooperating writer (the official CLI) can still replace the
        // file between our compare above and this rename — a ms-scale window
        // with no userspace fix short of a lock the other side honors.
        const tmp = `${filePath}.qw-tmp-${process.pid}`;
        writeFileSync(tmp, JSON.stringify(now, null, 2), { mode: 0o600 });
        renameSync(tmp, filePath);
      }
    } catch {
      // best effort — refresh succeeded in-memory; file write failure (concurrent
      // CLI write truncating the file, EACCES) must not crash the poll loop.
    }
  }
  return refreshed;
}
