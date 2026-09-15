/**
 * token-manager.ts — credential resolution + refresh orchestration.
 *
 * fetchWithRefresh: resolve freshest token (from official CLI file for
 * claude/codex), fetch quota; on auth_expired, proactively refresh via the
 * provider's token endpoint and retry once. A per-provider mutex serializes
 * concurrent calls so the refresh_token rotation (codex rotates every refresh)
 * isn't raced by pollNow + timer firing together.
 */
import type { ProviderConfig, ProviderQuota } from "../types.js";
import { resolveCliTokens } from "./credential-source.js";
import { refreshAndPersist } from "./refresh.js";
import { getProviderAuthMeta } from "./provider-meta.js";
import { readShellEnvVar } from "./shell-env.js";

export function resolveCredentials(
  config: ProviderConfig,
  opts: { siblingApiKeys?: string[] } = {},
): ProviderConfig {
  const cli = resolveCliTokens(config.provider);
  let credentials: ProviderConfig["credentials"] = cli
    ? {
        ...config.credentials,
        ...cli.extra,
        token: cli.accessToken,
        refreshToken: cli.refreshToken ?? config.credentials.refreshToken,
      }
    : config.credentials;

  // api-key providers with a known ~/.shell_env variable: prefer the live
  // value over the DB copy. The DB import is a snapshot from setup time —
  // once the key rotates in ~/.shell_env the stale copy just 401s (observed
  // with deepseek on 2026-09-09). Re-read per poll so rotation is picked up
  // without re-importing; the DB value remains the fallback when the file
  // is missing or the variable absent.
  //
  // Exception: a genuine multi-account setup (sibling instances of the same
  // provider holding DIFFERENT stored keys) must keep its per-instance keys —
  // letting one env var clobber them silently points every instance at the
  // same account. Callers that know the sibling set pass it; single-instance
  // callers omit it and keep the fresh-rotation behaviour.
  const envVar = getProviderAuthMeta(config.provider)?.envVar;
  if (envVar) {
    const fromEnv = readShellEnvVar(envVar);
    const stored = credentials.apiKey;
    const multiAccount =
      opts.siblingApiKeys !== undefined &&
      opts.siblingApiKeys.length > 0 &&
      stored !== undefined &&
      opts.siblingApiKeys.some((k) => k !== stored);
    if (fromEnv && !multiAccount) credentials = { ...credentials, apiKey: fromEnv };
  }

  if (!cli && credentials === config.credentials) return config;
  return { ...config, credentials };
}

export interface QuotaFetcher {
  fetchQuota(config: ProviderConfig): Promise<ProviderQuota>;
}

// per-provider mutex — prevents concurrent refreshes from racing the
// refresh_token rotation (codex rotates every refresh, so two concurrent
// refreshes invalidate each other's token and lock the account out).
const refreshLocks = new Map<string, Promise<ProviderQuota>>();

// A refresh that just FAILED (dead/rotated refresh_token, auth endpoint 4xx)
// is very likely to keep failing — retrying it on every poll POSTs the token
// endpoint at base-interval speed (10-15s) for days. Back off 10 minutes.
const REFRESH_FAIL_BACKOFF_MS = 10 * 60_000;
const refreshFailedAt = new Map<string, number>();

export async function fetchWithRefresh(
  config: ProviderConfig,
  fetcher: QuotaFetcher,
  opts: { siblingApiKeys?: string[] } = {},
): Promise<ProviderQuota> {
  const existing = refreshLocks.get(config.id);
  if (existing) return existing;

  const p = (async (): Promise<ProviderQuota> => {
    try {
      const resolved = resolveCredentials(config, opts);
      let quota = await fetcher.fetchQuota(resolved);

      if (quota.status === "auth_expired") {
        const lastFail = refreshFailedAt.get(config.id);
        if (lastFail !== undefined && Date.now() - lastFail < REFRESH_FAIL_BACKOFF_MS) {
          // Surface as-is; the provider shows its auth error without the
          // token endpoint being hammered in between.
          return quota;
        }
        const refreshed = await refreshAndPersist(config.provider);
        if (refreshed) {
          refreshFailedAt.delete(config.id);
          // Use the fresh access token directly — the credential file write
          // may have failed (concurrent CLI write, EACCES), but the in-memory
          // token is still valid for this retry.
          const resolved2: ProviderConfig = {
            ...resolved,
            credentials: { ...resolved.credentials, token: refreshed.accessToken },
          };
          quota = await fetcher.fetchQuota(resolved2);
        } else {
          refreshFailedAt.set(config.id, Date.now());
        }
      }
      return quota;
    } finally {
      refreshLocks.delete(config.id);
    }
  })();

  refreshLocks.set(config.id, p);
  return p;
}
