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

export function resolveCredentials(config: ProviderConfig): ProviderConfig {
  const cli = resolveCliTokens(config.provider);
  if (!cli) return config;
  return {
    ...config,
    credentials: {
      ...config.credentials,
      ...cli.extra,
      token: cli.accessToken,
      refreshToken: cli.refreshToken ?? config.credentials.refreshToken,
    },
  };
}

export interface QuotaFetcher {
  fetchQuota(config: ProviderConfig): Promise<ProviderQuota>;
}

// per-provider mutex — prevents concurrent refreshes from racing the
// refresh_token rotation (codex rotates every refresh, so two concurrent
// refreshes invalidate each other's token and lock the account out).
const refreshLocks = new Map<string, Promise<ProviderQuota>>();

export async function fetchWithRefresh(
  config: ProviderConfig,
  fetcher: QuotaFetcher,
): Promise<ProviderQuota> {
  const existing = refreshLocks.get(config.id);
  if (existing) return existing;

  const p = (async (): Promise<ProviderQuota> => {
    try {
      const resolved = resolveCredentials(config);
      let quota = await fetcher.fetchQuota(resolved);

      if (quota.status === "auth_expired") {
        const refreshed = await refreshAndPersist(config.provider);
        if (refreshed) {
          // Use the fresh access token directly — the credential file write
          // may have failed (concurrent CLI write, EACCES), but the in-memory
          // token is still valid for this retry.
          const resolved2: ProviderConfig = {
            ...resolved,
            credentials: { ...resolved.credentials, token: refreshed.accessToken },
          };
          quota = await fetcher.fetchQuota(resolved2);
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
