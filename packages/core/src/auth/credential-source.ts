/**
 * credential-source.ts — read tokens from CLI credential files on disk.
 *
 * Anthropic/OpenAI don't issue OAuth client_ids to third parties, so we can't
 * run our own OAuth flow for claude/codex. Instead we reuse the tokens the
 * official CLIs (Claude Code, Codex) already logged in and refresh on disk.
 * Antigravity follows the same pattern via the community `antigravity-usage`
 * CLI's token store (the user runs `antigravity-usage login` once).
 * The TokenManager layers proactive refresh on top of this.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";

export type TokenSource = "claude-cli" | "codex-cli" | "antigravity-cli";

export interface ResolvedTokens {
  accessToken: string;
  refreshToken?: string;
  /** epoch ms, undefined if unknown */
  expiresAt?: number;
  /** where it came from, for UI display */
  source: TokenSource;
  /** provider-specific extras merged into credentials (e.g. projectId, email) */
  extra?: Record<string, string>;
}

// mtime cache — only re-parse when the file actually changed
const cache = new Map<string, { mtime: number; tokens: ResolvedTokens | null }>();

function readWithCache(
  path: string,
  parse: (raw: string) => ResolvedTokens | null,
): ResolvedTokens | null {
  if (!existsSync(path)) return null;
  let mtime: number;
  try {
    mtime = statSync(path).mtimeMs;
  } catch {
    return null;
  }
  const cached = cache.get(path);
  if (cached && cached.mtime === mtime) return cached.tokens;
  let tokens: ResolvedTokens | null = null;
  try {
    tokens = parse(readFileSync(path, "utf-8"));
  } catch {
    tokens = null;
  }
  cache.set(path, { mtime, tokens });
  return tokens;
}

/** Claude Code's ~/.claude/.credentials.json — { claudeAiOauth: {accessToken,refreshToken,expiresAt} } */
export function readClaudeCliCredentials(): ResolvedTokens | null {
  const path = join(homedir(), ".claude", ".credentials.json");
  return readWithCache(path, parseClaudeOAuthJson) ?? readClaudeKeychainCredentials();
}

function parseClaudeOAuthJson(raw: string): ResolvedTokens | null {
  const d = JSON.parse(raw) as Record<string, unknown>;
  const oauth = (d.claudeAiOauth ?? d) as Record<string, unknown>;
  const accessToken = oauth.accessToken;
  if (typeof accessToken !== "string" || !accessToken) return null;
  return {
    accessToken,
    refreshToken:
      typeof oauth.refreshToken === "string" ? oauth.refreshToken : undefined,
    expiresAt:
      typeof oauth.expiresAt === "number" ? oauth.expiresAt : undefined,
    source: "claude-cli",
  };
}

/**
 * macOS fallback: Claude Code stores its OAuth blob in the login Keychain
 * (service "Claude Code-credentials") instead of the credentials file. The
 * payload is the same JSON shape. Without this, a Mac user who is fully
 * logged in reads as not_configured and the scheduler falls back to stale
 * DB credentials.
 *
 * First read from a new binary triggers a one-time macOS keychain consent
 * prompt; `security` blocks on it, so a timeout is mandatory — under launchd
 * there may be nobody to click "Allow".
 */
let keychainCache: { tokens: ResolvedTokens | null; readAt: number } | null = null;
// Success re-reads every 60s so token rotation is picked up quickly; failures
// back off 30min — a blocked `security` call stalls the daemon's event loop
// for up to its 5s timeout, and providers poll every 10-60s, so a short
// failure cache would freeze the API roughly once a minute.
const KEYCHAIN_OK_MS = 60_000;
const KEYCHAIN_FAIL_MS = 30 * 60_000;

function readClaudeKeychainCredentials(): ResolvedTokens | null {
  if (platform() !== "darwin") return null;
  if (keychainCache) {
    const ttl = keychainCache.tokens ? KEYCHAIN_OK_MS : KEYCHAIN_FAIL_MS;
    if (Date.now() - keychainCache.readAt < ttl) return keychainCache.tokens;
  }
  let tokens: ResolvedTokens | null = null;
  try {
    const raw = execFileSync(
      "security",
      ["find-generic-password", "-s", "Claude Code-credentials", "-w"],
      { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"], timeout: 5000 },
    ).trim();
    tokens = parseClaudeOAuthJson(raw);
  } catch {
    tokens = null;
  }
  keychainCache = { tokens, readAt: Date.now() };
  return tokens;
}

/** Codex CLI's ~/.codex/auth.json — { tokens: {access_token, refresh_token, id_token, account_id} } */
export function readCodexCliCredentials(): ResolvedTokens | null {
  const path = join(homedir(), ".codex", "auth.json");
  return readWithCache(path, (raw) => {
    const d = JSON.parse(raw) as Record<string, unknown>;
    const t = (d.tokens ?? d) as Record<string, unknown>;
    const accessToken = (t.access_token ?? t.accessToken) as unknown;
    if (typeof accessToken !== "string" || !accessToken) return null;
    const refreshToken = (t.refresh_token ?? t.refreshToken) as unknown;
    // codex auth.json has no top-level expiry; JWT exp decodable downstream if needed
    return {
      accessToken,
      refreshToken: typeof refreshToken === "string" ? refreshToken : undefined,
      expiresAt: decodeJwtExp(accessToken),
      source: "codex-cli",
    };
  });
}

// ── Antigravity (community antigravity-usage CLI token store) ─────────

/** Platform config dir of the antigravity-usage CLI. */
export function antigravityUsageConfigDir(): string {
  const os = platform();
  if (os === "darwin") return join(homedir(), "Library", "Application Support", "antigravity-usage");
  if (os === "win32") {
    return join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "antigravity-usage");
  }
  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "antigravity-usage");
}

/**
 * Newest accounts/<email>/tokens.json under the antigravity-usage config dir.
 * Multiple logged-in accounts: most recently refreshed one wins.
 */
export function antigravityTokensPath(): string | null {
  const accountsDir = join(antigravityUsageConfigDir(), "accounts");
  let entries: string[];
  try {
    entries = readdirSync(accountsDir);
  } catch {
    return null;
  }
  let best: { path: string; mtime: number } | null = null;
  for (const entry of entries) {
    const candidate = join(accountsDir, entry, "tokens.json");
    try {
      const mtime = statSync(candidate).mtimeMs;
      if (!best || mtime > best.mtime) best = { path: candidate, mtime };
    } catch {
      // account dir without tokens.json — skip
    }
  }
  return best?.path ?? null;
}

/**
 * antigravity-usage tokens.json — {accessToken, refreshToken, expiresAt(ms), email, projectId}.
 * Produced by `antigravity-usage login` (Google OAuth); we reuse + refresh it.
 */
export function readAntigravityCliCredentials(): ResolvedTokens | null {
  const path = antigravityTokensPath();
  if (!path) return null;
  return readWithCache(path, (raw) => {
    const d = JSON.parse(raw) as Record<string, unknown>;
    const accessToken = d.accessToken;
    if (typeof accessToken !== "string" || !accessToken) return null;
    const extra: Record<string, string> = {};
    if (typeof d.email === "string") extra.email = d.email;
    if (typeof d.projectId === "string") extra.projectId = d.projectId;
    return {
      accessToken,
      refreshToken: typeof d.refreshToken === "string" ? d.refreshToken : undefined,
      expiresAt: typeof d.expiresAt === "number" ? d.expiresAt : undefined,
      source: "antigravity-cli",
      extra,
    };
  });
}

/** Resolve latest tokens for a provider slug from its CLI file. null if unavailable. */
export function resolveCliTokens(providerSlug: string): ResolvedTokens | null {
  switch (providerSlug) {
    case "claude":
      return readClaudeCliCredentials();
    case "codex":
      return readCodexCliCredentials();
    case "antigravity":
      return readAntigravityCliCredentials();
    default:
      return null;
  }
}

/** Best-effort decode of a JWT's `exp` (ms). Returns undefined if not a JWT / no exp. */
function decodeJwtExp(token: string): number | undefined {
  const parts = token.split(".");
  if (parts.length < 2) return undefined;
  try {
    const payload = JSON.parse(
      Buffer.from(parts[1]!, "base64url").toString("utf-8"),
    ) as { exp?: unknown };
    return typeof payload.exp === "number" ? payload.exp * 1000 : undefined;
  } catch {
    return undefined;
  }
}
