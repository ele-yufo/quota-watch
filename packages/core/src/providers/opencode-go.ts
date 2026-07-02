import type { ProviderAdapter } from './types.js';
import type { ProviderConfig, ProviderQuota, QuotaWindow } from '../types.js';
import { percentWindow, quotaError, quotaOk } from './base.js';
import { existsSync, readFileSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';

/**
 * OpenCode Go quota — native opencode.ai dashboard scraper.
 *
 * Ported from the community `@slkiser/opencode-quota` 3.10.1 (we previously
 * shelled out to its `show --json`, which only read a disk cache that OpenCode's
 * plugin loop populated — data was only as fresh as the user's last `opencode`
 * run). Fetching the dashboard directly is both fresher and dependency-free.
 *
 * There is no JSON API: GET the workspace's /go page (SolidJS SSR HTML) with
 * the browser session cookie and extract three windows from the hydration
 * blob (strategy A) or data-slot attributes (strategy B, the site's other
 * known render format).
 *
 * Window semantics (server-computed; we only trust resetInSec):
 *   rolling  — true 5h rolling window
 *   weekly   — resets at the ISO-week boundary (Monday 00:00 UTC)
 *   monthly  — anchored to the subscription's billing-cycle timestamp
 */

const DASHBOARD_URL = (workspaceId: string): string =>
  `https://opencode.ai/workspace/${encodeURIComponent(workspaceId)}/go`;
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Gecko/20100101 Firefox/148.0';
const SCRAPE_TIMEOUT_MS = 10_000;

// ── Credentials ────────────────────────────────────────────────────────

export interface OpenCodeGoCredentials {
  workspaceId: string;
  authCookie: string;
  /** for UI display: quota-watch config, env, or the community config file path */
  source: string;
}

/** Candidate community config files (@slkiser/opencode-quota compatible). */
function communityConfigPaths(): string[] {
  const xdgConfig = process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config');
  const paths = [join(xdgConfig, 'opencode', 'opencode-quota', 'opencode-go.json')];
  if (platform() === 'darwin') {
    paths.push(
      join(homedir(), 'Library', 'Application Support', 'opencode', 'opencode-quota', 'opencode-go.json'),
    );
  }
  return paths;
}

/**
 * Resolution order: quota-watch's own credential store → env vars
 * (OPENCODE_GO_WORKSPACE_ID / OPENCODE_GO_AUTH_COOKIE) → the community
 * CLI's config file. Both values must come from the same source.
 */
export function resolveOpenCodeGoCredentials(
  credentials: Record<string, string>,
): OpenCodeGoCredentials | null {
  if (credentials.workspaceId?.trim() && credentials.authCookie?.trim()) {
    return {
      workspaceId: credentials.workspaceId.trim(),
      authCookie: credentials.authCookie.trim(),
      source: 'quota-watch config',
    };
  }

  const envWorkspace = process.env.OPENCODE_GO_WORKSPACE_ID?.trim();
  const envCookie = process.env.OPENCODE_GO_AUTH_COOKIE?.trim();
  if (envWorkspace && envCookie) {
    return { workspaceId: envWorkspace, authCookie: envCookie, source: 'env' };
  }

  for (const path of communityConfigPaths()) {
    if (!existsSync(path)) continue;
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>;
      const workspaceId = typeof parsed.workspaceId === 'string' ? parsed.workspaceId.trim() : '';
      const authCookie = typeof parsed.authCookie === 'string' ? parsed.authCookie.trim() : '';
      if (workspaceId && authCookie) return { workspaceId, authCookie, source: path };
    } catch {
      // unreadable/corrupt file — fall through to the next candidate
    }
  }
  return null;
}

// ── HTML parsing ───────────────────────────────────────────────────────

interface ScrapedWindow {
  usagePercent: number;
  resetInSec: number;
}

type WindowKey = 'rolling' | 'weekly' | 'monthly';

const NUM = String.raw`(-?\d+(?:\.\d+)?)`;

/** Strategy A: SolidJS SSR hydration blob, field order not guaranteed. */
function parseHydrationBlob(html: string, field: string): ScrapedWindow | null {
  const pctFirst = new RegExp(
    String.raw`${field}:\$R\[\d+\]=\{[^}]*usagePercent:${NUM}[^}]*resetInSec:${NUM}[^}]*\}`,
  );
  const resetFirst = new RegExp(
    String.raw`${field}:\$R\[\d+\]=\{[^}]*resetInSec:${NUM}[^}]*usagePercent:${NUM}[^}]*\}`,
  );
  const a = pctFirst.exec(html);
  if (a) return { usagePercent: Number(a[1]), resetInSec: Number(a[2]) };
  const b = resetFirst.exec(html);
  if (b) return { usagePercent: Number(b[2]), resetInSec: Number(b[1]) };
  return null;
}

/** "1 hour 56 minutes" / "26 days 17 hours" / "now" → seconds. */
function parseHumanReadableTime(text: string): number {
  const cleaned = text.trim().toLowerCase();
  if (/^(resets?\s+now|now|reset-now)$/.test(cleaned)) return 0;
  let seconds = 0;
  const days = /(\d+)\s*days?/.exec(cleaned);
  const hours = /(\d+)\s*hours?/.exec(cleaned);
  const minutes = /(\d+)\s*minutes?/.exec(cleaned);
  const secs = /(\d+)\s*seconds?/.exec(cleaned);
  if (days) seconds += Number(days[1]) * 86_400;
  if (hours) seconds += Number(hours[1]) * 3_600;
  if (minutes) seconds += Number(minutes[1]) * 60;
  if (secs) seconds += Number(secs[1]);
  return seconds;
}

/** Strategy B: data-slot="usage-item" blocks (the site's newer render format). */
function parseDataSlots(html: string): Partial<Record<WindowKey, ScrapedWindow>> {
  const result: Partial<Record<WindowKey, ScrapedWindow>> = {};
  const blocks = html.split('data-slot="usage-item"').slice(1);
  for (const block of blocks) {
    const labelMatch = /data-slot="usage-label"[^>]*>([^<]*)</.exec(block);
    const valueMatch = /data-slot="usage-value">[^0-9]*(\d+(?:\.\d+)?)/.exec(block);
    if (!labelMatch || !valueMatch) continue;

    const label = labelMatch[1]!.toLowerCase();
    const key: WindowKey | null = label.includes('rolling')
      ? 'rolling'
      : label.includes('weekly')
        ? 'weekly'
        : label.includes('monthly')
          ? 'monthly'
          : null;
    if (!key) continue;

    let resetInSec = 0;
    if (!/data-slot="reset-now"/.test(block)) {
      const resetMatch = /data-slot="reset-time"[^>]*>([\s\S]*?)<\/span>/.exec(block);
      if (resetMatch) {
        const text = resetMatch[1]!
          .replace(/<!--\/?\$-->/g, '')
          .replace(/^resets?\s+in\s+/i, '')
          .trim();
        resetInSec = parseHumanReadableTime(text);
      }
    }
    result[key] = { usagePercent: Number(valueMatch[1]), resetInSec };
  }
  return result;
}

function scrapeWindows(html: string): Partial<Record<WindowKey, ScrapedWindow>> {
  const a: Partial<Record<WindowKey, ScrapedWindow>> = {};
  const rolling = parseHydrationBlob(html, 'rollingUsage');
  const weekly = parseHydrationBlob(html, 'weeklyUsage');
  const monthly = parseHydrationBlob(html, 'monthlyUsage');
  if (rolling) a.rolling = rolling;
  if (weekly) a.weekly = weekly;
  if (monthly) a.monthly = monthly;
  if (Object.keys(a).length > 0) return a;
  return parseDataSlots(html);
}

/** Exported for tests. */
export const _internals = { parseHydrationBlob, parseDataSlots, parseHumanReadableTime, scrapeWindows };

// ── Window mapping ─────────────────────────────────────────────────────

const WINDOW_META: Array<{ key: WindowKey; name: string; kind: 'session' | 'week' | 'month' }> = [
  { key: 'rolling', name: 'session (5h)', kind: 'session' },
  { key: 'weekly', name: 'weekly (7d)', kind: 'week' },
  { key: 'monthly', name: 'monthly (1mo)', kind: 'month' },
];

function toWindows(scraped: Partial<Record<WindowKey, ScrapedWindow>>): QuotaWindow[] {
  const now = Date.now();
  return WINDOW_META.flatMap(({ key, name, kind }) => {
    const w = scraped[key];
    if (!w) return [];
    const resetAt = new Date(now + Math.max(0, w.resetInSec) * 1000).toISOString();
    return [percentWindow(name, kind, Math.max(0, w.usagePercent), resetAt)];
  });
}

// ── Provider adapter ───────────────────────────────────────────────────

export const opencodeGoProvider: ProviderAdapter = {
  id: 'opencode-go',
  displayName: 'OpenCode Go',
  // HTML dashboard scrape — stay polite.
  minPollIntervalMs: 30_000,

  async fetchQuota(config: ProviderConfig): Promise<ProviderQuota> {
    const creds = resolveOpenCodeGoCredentials(config.credentials);
    if (!creds) {
      return quotaError(
        'opencode-go',
        config,
        'not_configured',
        'OpenCode Go needs workspaceId + authCookie — copy them from opencode.ai ' +
          '(DevTools → Cookies → "auth"; workspace id is in the dashboard URL) ' +
          'into quota-watch setup, or set OPENCODE_GO_WORKSPACE_ID / OPENCODE_GO_AUTH_COOKIE',
      );
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SCRAPE_TIMEOUT_MS);
    let html: string;
    let status: number;
    try {
      const res = await globalThis.fetch(DASHBOARD_URL(creds.workspaceId), {
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'text/html',
          Cookie: `auth=${creds.authCookie}`,
        },
        signal: controller.signal,
      });
      status = res.status;
      html = await res.text();
    } catch (err) {
      const message =
        err instanceof DOMException && err.name === 'AbortError'
          ? `Request timed out after ${SCRAPE_TIMEOUT_MS}ms`
          : err instanceof Error
            ? err.message
            : String(err);
      return quotaError('opencode-go', config, 'error', message);
    } finally {
      clearTimeout(timer);
    }

    if (status === 401 || status === 403) {
      return quotaError(
        'opencode-go',
        config,
        'auth_expired',
        `Dashboard returned ${status} — auth cookie expired, re-copy it from opencode.ai`,
      );
    }
    if (status < 200 || status >= 300) {
      return quotaError(
        'opencode-go',
        config,
        'error',
        `Dashboard returned ${status}: ${html.slice(0, 120).replace(/\s+/g, ' ')}`,
      );
    }

    const scraped = scrapeWindows(html);
    const windows = toWindows(scraped);
    if (windows.length === 0) {
      // A stale cookie often yields a 200 login page instead of the dashboard —
      // all three windows unparseable is the auth-expired signature.
      return quotaError(
        'opencode-go',
        config,
        'auth_expired',
        'Dashboard rendered without any usage windows — auth cookie likely expired, re-copy it from opencode.ai',
      );
    }

    return quotaOk('opencode-go', creds.workspaceId, 'opencode-go', windows);
  },
};
