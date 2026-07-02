/**
 * config.ts — app-level configuration (~/.quota-watch/config.json).
 *
 * Poll cadence + daemon API binding live here so users can tune them without
 * touching code. Missing file or fields fall back to defaults; a corrupt file
 * is treated as absent (never crashes the daemon).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { randomBytes } from "node:crypto";

export interface PollConfig {
  /** cadence while usage is moving or a window is under alert threshold */
  fastMs: number;
  /** default cadence */
  baseMs: number;
  /** cadence after several unchanged polls */
  idleMs: number;
}

export interface ApiConfig {
  /** 127.0.0.1 = local only; 0.0.0.0 exposes to the LAN (iOS app) */
  host: string;
  port: number;
  /**
   * Bearer token required for non-loopback clients. Auto-generated the first
   * time the config is saved with a non-loopback host. null = loopback-only.
   */
  token: string | null;
}

export interface AppConfig {
  poll: PollConfig;
  api: ApiConfig;
}

export const DEFAULT_APP_CONFIG: AppConfig = {
  poll: {
    fastMs: 10_000,
    baseMs: 15_000,
    idleMs: 60_000,
  },
  api: {
    host: "127.0.0.1",
    port: 3737,
    token: null,
  },
};

export function defaultConfigPath(): string {
  return join(homedir(), ".quota-watch", "config.json");
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

export function loadAppConfig(path: string = defaultConfigPath()): AppConfig {
  let raw: Record<string, unknown> = {};
  if (existsSync(path)) {
    try {
      raw = JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
    } catch {
      raw = {};
    }
  }
  const poll = (raw.poll ?? {}) as Record<string, unknown>;
  const api = (raw.api ?? {}) as Record<string, unknown>;
  return {
    poll: {
      fastMs: numberOr(poll.fastMs, DEFAULT_APP_CONFIG.poll.fastMs),
      baseMs: numberOr(poll.baseMs, DEFAULT_APP_CONFIG.poll.baseMs),
      idleMs: numberOr(poll.idleMs, DEFAULT_APP_CONFIG.poll.idleMs),
    },
    api: {
      host: typeof api.host === "string" && api.host ? api.host : DEFAULT_APP_CONFIG.api.host,
      port: numberOr(api.port, DEFAULT_APP_CONFIG.api.port),
      token: typeof api.token === "string" && api.token ? api.token : null,
    },
  };
}

export function saveAppConfig(config: AppConfig, path: string = defaultConfigPath()): void {
  const dir = dirname(path);
  if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
}

export function isLoopbackHost(host: string): boolean {
  return host === "127.0.0.1" || host === "::1" || host === "localhost";
}

/**
 * Ensure an API token exists when binding beyond loopback; persists the
 * generated token so clients keep working across daemon restarts.
 */
export function ensureApiToken(config: AppConfig, path: string = defaultConfigPath()): AppConfig {
  if (isLoopbackHost(config.api.host) || config.api.token) return config;
  const next: AppConfig = {
    ...config,
    api: { ...config.api, token: randomBytes(16).toString("hex") },
  };
  saveAppConfig(next, path);
  return next;
}
