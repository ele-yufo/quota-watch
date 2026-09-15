/**
 * antigravity-local.ts — quota via the locally running Antigravity IDE's
 * language server over Connect RPC. No OAuth tokens, no expiry, no refresh:
 * the IDE process itself knows the quota.
 *
 * Mechanism (mirrors antigravity-usage CLI 0.2.9's local mode):
 *   1. find the `language_server` process in `ps aux`, extracting
 *      --csrf_token / --extension_server_port from its command line
 *   2. list its listening TCP ports (lsof on darwin, ss on linux)
 *   3. probe each port with a Connect-RPC POST until one answers like a
 *      Connect endpoint (HTTP 200/401 on GetUnleashData)
 *   4. POST GetUserStatus for email + plan credits + per-model quota
 *
 * The resolved endpoint is cached for 5 min; any request failure drops the
 * cache so the next poll re-discovers (IDE restarts change the port/token).
 * All IO failures throw LocalUnavailableError — the caller falls back to the
 * Google API path.
 */
import { execFile } from 'node:child_process';
import http from 'node:http';
import https from 'node:https';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export class LocalUnavailableError extends Error {}

const CONNECT_BASE = '/exa.language_server_pb.LanguageServerService';
const PROBE_PATH = `${CONNECT_BASE}/GetUnleashData`;
const STATUS_PATH = `${CONNECT_BASE}/GetUserStatus`;
const QUOTA_SUMMARY_PATH = `${CONNECT_BASE}/RetrieveUserQuotaSummary`;
// 401 = a real Connect endpoint rejecting a bad/missing CSRF token; a random
// port serving something else answers 404 or doesn't speak Connect at all.
const CONNECT_STATUSES = new Set([200, 401]);
const PROBE_TIMEOUT_MS = 500;
const REQUEST_TIMEOUT_MS = 5000;
const ENDPOINT_CACHE_MS = 5 * 60_000;

export interface AntigravityProcess {
  pid: number;
  csrfToken?: string;
  extensionServerPort?: number;
}

export interface LocalEndpoint {
  baseUrl: string;
  csrfToken?: string;
  pid: number;
}

// ── Process detection (pure parsing, IO at the edges) ──────────────────

const SERVER_SIGNALS = [
  'language-server',
  'language_server',
  'exa.language_server_pb',
  '--csrf_token',
  '--extension_server_port',
];

/** Extract `--name=value` or `--name value` from a command line. */
export function extractArgument(commandLine: string, argName: string): string | null {
  const eq = commandLine.match(new RegExp(`${argName}=([^\\s"']+|"[^"]*"|'[^']*')`, 'i'));
  const space = commandLine.match(new RegExp(`${argName}\\s+([^\\s"']+|"[^"]*"|'[^']*')`, 'i'));
  const raw = eq?.[1] ?? space?.[1];
  return raw ? raw.replace(/^["']|["']$/g, '') : null;
}

/** Find the Antigravity language-server row in `ps aux` output. */
export function parseProcessList(psOutput: string): AntigravityProcess | null {
  for (const line of psOutput.split('\n')) {
    const lower = line.toLowerCase();
    if (!lower.includes('antigravity')) continue;
    if (lower.includes('server installation script')) continue;
    if (!SERVER_SIGNALS.some((s) => lower.includes(s.toLowerCase()))) continue;

    const parts = line.trim().split(/\s+/);
    if (parts.length < 11) continue;
    const pid = parseInt(parts[1]!, 10);
    if (Number.isNaN(pid)) continue;

    const commandLine = parts.slice(10).join(' ');
    const port = extractArgument(commandLine, '--extension_server_port');
    return {
      pid,
      csrfToken: extractArgument(commandLine, '--csrf_token') ?? undefined,
      extensionServerPort: port ? parseInt(port, 10) || undefined : undefined,
    };
  }
  return null;
}

/** Parse listening TCP ports from lsof/ss output lines. */
export function parseListenPorts(output: string): number[] {
  const ports: number[] = [];
  for (const line of output.split('\n')) {
    const m = line.match(/:(\d+)\s+\(LISTEN\)/) ?? line.match(/:(\d+)\s/);
    if (!m) continue;
    const port = parseInt(m[1]!, 10);
    if (!Number.isNaN(port) && !ports.includes(port)) ports.push(port);
  }
  return ports;
}

async function detectProcess(): Promise<AntigravityProcess> {
  if (process.platform === 'win32') {
    throw new LocalUnavailableError('local mode not implemented on Windows');
  }
  const { stdout } = await execFileAsync('ps', ['aux'], { maxBuffer: 4 * 1024 * 1024 });
  const found = parseProcessList(stdout);
  if (!found) throw new LocalUnavailableError('Antigravity language server not running');
  return found;
}

async function discoverPorts(pid: number): Promise<number[]> {
  try {
    if (process.platform === 'darwin') {
      const { stdout } = await execFileAsync('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-a', '-p', String(pid)]);
      return parseListenPorts(stdout);
    }
    const { stdout } = await execFileAsync('ss', ['-tlnp']);
    return parseListenPorts(
      stdout.split('\n').filter((l) => l.includes(`pid=${pid},`)).join('\n'),
    );
  } catch {
    return [];
  }
}

// ── Connect RPC ─────────────────────────────────────────────────────────

interface ConnectRequestOptions {
  baseUrl: string;
  path: string;
  csrfToken?: string;
  body: unknown;
  timeoutMs: number;
}

/** Minimal Connect-RPC POST (JSON). HTTPS tolerates the IDE's self-signed cert. */
function connectRequest<T>(opts: ConnectRequestOptions): Promise<{ status: number; data: T | null }> {
  return new Promise((resolve, reject) => {
    const isHttps = opts.baseUrl.startsWith('https://');
    const url = new URL(opts.path, opts.baseUrl);
    const transport = isHttps ? https : http;
    const req = transport.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: 'POST',
        timeout: opts.timeoutMs,
        rejectUnauthorized: false,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'Connect-Protocol-Version': '1',
          ...(opts.csrfToken ? { 'X-Codeium-Csrf-Token': opts.csrfToken } : {}),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => (data += chunk.toString()));
        res.on('end', () => {
          const status = res.statusCode ?? 0;
          try {
            resolve({ status, data: JSON.parse(data) as T });
          } catch {
            resolve({ status, data: null });
          }
        });
        // The IDE can die mid-body: without these the promise never settles
        // and the poll (and any Google fallback) hangs forever.
        res.on('error', reject);
        res.on('aborted', () => reject(new LocalUnavailableError('connect response aborted mid-body')));
      },
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new LocalUnavailableError('connect request timed out'));
    });
    req.write(JSON.stringify(opts.body));
    req.end();
  });
}

async function probePort(port: number, csrfToken?: string): Promise<LocalEndpoint | null> {
  for (const scheme of ['https', 'http'] as const) {
    const baseUrl = `${scheme}://127.0.0.1:${port}`;
    try {
      const { status } = await connectRequest({
        baseUrl,
        path: PROBE_PATH,
        csrfToken,
        body: { wrapper_data: {} },
        timeoutMs: PROBE_TIMEOUT_MS,
      });
      if (CONNECT_STATUSES.has(status)) {
        return { baseUrl, csrfToken, pid: 0 };
      }
    } catch {
      // connection refused / wrong protocol — try the next scheme
    }
  }
  return null;
}

// ── Endpoint resolution with cache ──────────────────────────────────────

let cached: { endpoint: LocalEndpoint; expiresAt: number } | null = null;

/** Drop the cached endpoint (called when a request against it fails). */
export function invalidateLocalEndpoint(): void {
  cached = null;
}

export async function resolveLocalEndpoint(): Promise<LocalEndpoint> {
  if (cached && Date.now() < cached.expiresAt) return cached.endpoint;

  const proc = await detectProcess();
  let ports = await discoverPorts(proc.pid);
  if (ports.length === 0 && proc.extensionServerPort) ports = [proc.extensionServerPort];
  if (ports.length === 0) {
    throw new LocalUnavailableError(`no listening ports found for pid ${proc.pid}`);
  }

  const results = await Promise.allSettled(ports.map((p) => probePort(p, proc.csrfToken)));
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value) {
      const endpoint: LocalEndpoint = { ...r.value, pid: proc.pid };
      cached = { endpoint, expiresAt: Date.now() + ENDPOINT_CACHE_MS };
      return endpoint;
    }
  }
  throw new LocalUnavailableError('no port answered like a Connect endpoint');
}

// ── UserStatus ──────────────────────────────────────────────────────────

export interface LocalModelQuota {
  modelId: string;
  label?: string;
  remainingFraction?: number;
  resetTime?: string;
}

export interface LocalUserStatus {
  email?: string;
  promptCredits?: { used: number; limit: number; remaining: number };
  models: LocalModelQuota[];
}

/** Parse the raw GetUserStatus response into the pieces quota-watch needs. */
export function parseUserStatus(response: unknown): LocalUserStatus {
  const status: LocalUserStatus = { models: [] };
  if (typeof response !== 'object' || response === null) return status;

  const data = response as Record<string, unknown>;
  const userStatus = (data.userStatus ?? data) as Record<string, unknown>;
  if (typeof userStatus.email === 'string') status.email = userStatus.email;

  const planStatus = userStatus.planStatus as
    | { availablePromptCredits?: unknown; planInfo?: { monthlyPromptCredits?: unknown } }
    | undefined;
  const available = planStatus?.availablePromptCredits;
  const monthly = planStatus?.planInfo?.monthlyPromptCredits;
  if (typeof available === 'number' && typeof monthly === 'number' && monthly > 0) {
    status.promptCredits = { used: monthly - available, limit: monthly, remaining: available };
  }

  const cascade = userStatus.cascadeModelConfigData as
    | { clientModelConfigs?: unknown }
    | undefined;
  if (Array.isArray(cascade?.clientModelConfigs)) {
    for (const m of cascade.clientModelConfigs) {
      if (typeof m !== 'object' || m === null) continue;
      const cfg = m as {
        modelOrAlias?: { model?: unknown };
        label?: unknown;
        quotaInfo?: { remainingFraction?: unknown; resetTime?: unknown };
      };
      status.models.push({
        modelId: typeof cfg.modelOrAlias?.model === 'string' ? cfg.modelOrAlias.model : 'unknown',
        label: typeof cfg.label === 'string' ? cfg.label : undefined,
        remainingFraction:
          typeof cfg.quotaInfo?.remainingFraction === 'number'
            ? cfg.quotaInfo.remainingFraction
            : undefined,
        resetTime: typeof cfg.quotaInfo?.resetTime === 'string' ? cfg.quotaInfo.resetTime : undefined,
      });
    }
  }
  return status;
}

/** Full local fetch: resolve endpoint → GetUserStatus. Throws LocalUnavailableError. */
export async function fetchLocalUserStatus(): Promise<LocalUserStatus> {
  const endpoint = await resolveLocalEndpoint();
  try {
    const { status, data } = await connectRequest<unknown>({
      baseUrl: endpoint.baseUrl,
      path: STATUS_PATH,
      csrfToken: endpoint.csrfToken,
      body: { metadata: { ideName: 'antigravity', extensionName: 'antigravity', locale: 'en' } },
      timeoutMs: REQUEST_TIMEOUT_MS,
    });
    if (status === 401 || status === 403) {
      throw new LocalUnavailableError(`CSRF token rejected (HTTP ${status})`);
    }
    if (status < 200 || status >= 300 || data === null) {
      throw new LocalUnavailableError(`GetUserStatus failed (HTTP ${status})`);
    }
    return parseUserStatus(data);
  } catch (err) {
    invalidateLocalEndpoint();
    throw err;
  }
}

// ── QuotaSummary (the IDE's own settings-page data source) ───────────────

export interface QuotaBucket {
  group: string; // displayName of the parent group, e.g. "Gemini Models"
  bucketId: string; // e.g. "gemini-5h", "3p-weekly"
  window: string; // "5h" | "weekly"
  remainingFraction: number; // 0.0–1.0
  resetTime?: string;
}

/**
 * Parse RetrieveUserQuotaSummary → flat bucket list. This is the RPC the
 * IDE's own quota UI renders ("Weekly Limit Remaining" etc.) — unlike the
 * legacy promptCredits fields in GetUserStatus, these numbers are live.
 */
export function parseQuotaSummary(response: unknown): QuotaBucket[] {
  if (typeof response !== 'object' || response === null) return [];
  const data = response as Record<string, unknown>;
  const inner = (data.response ?? data) as Record<string, unknown>;
  const groups = inner.groups;
  if (!Array.isArray(groups)) return [];

  const out: QuotaBucket[] = [];
  for (const g of groups) {
    if (typeof g !== 'object' || g === null) continue;
    const group = g as { displayName?: unknown; buckets?: unknown };
    if (!Array.isArray(group.buckets)) continue;
    for (const b of group.buckets) {
      if (typeof b !== 'object' || b === null) continue;
      const bucket = b as {
        bucketId?: unknown;
        window?: unknown;
        remainingFraction?: unknown;
        resetTime?: unknown;
      };
      if (typeof bucket.remainingFraction !== 'number') continue;
      out.push({
        group: typeof group.displayName === 'string' ? group.displayName : 'unknown',
        bucketId: typeof bucket.bucketId === 'string' ? bucket.bucketId : 'unknown',
        window: typeof bucket.window === 'string' ? bucket.window : 'unknown',
        remainingFraction: bucket.remainingFraction,
        resetTime: typeof bucket.resetTime === 'string' ? bucket.resetTime : undefined,
      });
    }
  }
  return out;
}

/** Full local fetch of the quota summary. Throws LocalUnavailableError. */
export async function fetchLocalQuotaSummary(): Promise<QuotaBucket[]> {
  const endpoint = await resolveLocalEndpoint();
  try {
    const { status, data } = await connectRequest<unknown>({
      baseUrl: endpoint.baseUrl,
      path: QUOTA_SUMMARY_PATH,
      csrfToken: endpoint.csrfToken,
      body: {},
      timeoutMs: REQUEST_TIMEOUT_MS,
    });
    if (status === 401 || status === 403) {
      throw new LocalUnavailableError(`CSRF token rejected (HTTP ${status})`);
    }
    if (status < 200 || status >= 300 || data === null) {
      throw new LocalUnavailableError(`RetrieveUserQuotaSummary failed (HTTP ${status})`);
    }
    return parseQuotaSummary(data);
  } catch (err) {
    invalidateLocalEndpoint();
    throw err;
  }
}
