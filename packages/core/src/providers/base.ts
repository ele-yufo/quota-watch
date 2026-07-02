/**
 * base.ts — shared building blocks for provider adapters.
 *
 * Every adapter used to hand-roll the same four ProviderQuota envelopes
 * (not_configured / auth_expired / error / ok) plus its own fetch error
 * handling. These helpers are the single source of that shape.
 */
import type { ProviderConfig, ProviderQuota, QuotaWindow } from '../types.js';
import type { WindowKind } from '../windows.js';

/** Error/edge envelope: no windows, explicit status + message. */
export function quotaError(
  provider: string,
  config: ProviderConfig,
  status: 'error' | 'not_configured' | 'auth_expired',
  error: string,
): ProviderQuota {
  return {
    provider,
    account: config.id,
    plan: 'unknown',
    status,
    windows: [],
    fetchedAt: new Date().toISOString(),
    error,
  };
}

/** Success envelope. */
export function quotaOk(
  provider: string,
  account: string,
  plan: string,
  windows: QuotaWindow[],
): ProviderQuota {
  return {
    provider,
    account,
    plan,
    status: 'ok',
    windows,
    fetchedAt: new Date().toISOString(),
  };
}

/** Percent-unit window from a used% figure (the common case for coding plans). */
export function percentWindow(
  name: string,
  kind: WindowKind,
  usedPct: number,
  resetAt: string | null,
  opts?: { unlimited?: boolean },
): QuotaWindow {
  const used = Math.max(0, Math.min(100, usedPct));
  return {
    name,
    kind,
    used,
    total: 100,
    unit: 'percent',
    remaining: 100 - used,
    remainingPct: 100 - used,
    resetAt,
    unlimited: opts?.unlimited ?? false,
  };
}

/** 401/403 mean credentials died; everything else is a plain error. */
export function httpStatusToQuotaStatus(status: number): 'auth_expired' | 'error' {
  return status === 401 || status === 403 ? 'auth_expired' : 'error';
}

export type FetchJsonResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number | null; error: string };

const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * fetch + JSON parse with timeout, never throws.
 * status is null for network-level failures (DNS, refused, timeout).
 */
export async function fetchJson<T>(
  url: string,
  init: RequestInit = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<FetchJsonResult<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await globalThis.fetch(url, { ...init, signal: controller.signal });
    if (!res.ok) {
      return { ok: false, status: res.status, error: `HTTP ${res.status}: ${res.statusText}` };
    }
    try {
      return { ok: true, status: res.status, data: (await res.json()) as T };
    } catch {
      return { ok: false, status: res.status, error: 'Invalid JSON in response body' };
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return { ok: false, status: null, error: `Request timed out after ${timeoutMs}ms` };
    }
    return { ok: false, status: null, error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}
