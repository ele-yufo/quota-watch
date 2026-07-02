import type { ProviderQuota, ProviderConfig } from '../types.js';

/**
 * Every provider implements this interface.
 * The registry uses it to dispatch quota fetches.
 */
export interface ProviderAdapter {
  /** Unique slug, e.g. "claude", "codex" */
  readonly id: string;
  /** Human-readable name for UI, e.g. "Claude Code" */
  readonly displayName: string;
  /**
   * Floor for the adaptive scheduler's poll interval. Protects rate-limited
   * or heavyweight upstreams from the global fast cadence. Omit for plain
   * HTTP APIs that tolerate ~10s polling.
   */
  readonly minPollIntervalMs?: number;
  /** Fetch current quota for the given account config */
  fetchQuota(config: ProviderConfig): Promise<ProviderQuota>;
  /** Optional: validate that stored credentials are still valid */
  validateCredentials?(config: ProviderConfig): Promise<boolean>;
}
