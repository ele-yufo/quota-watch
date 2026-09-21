/**
 * api-server.ts — the daemon's embedded HTTP API.
 *
 * One machine-readable surface for every client that isn't the daemon itself:
 * the web dashboard (daemon status + manual refresh) and remote MCP clients
 * (streamable HTTP at /mcp, over LAN or a tunnel when bound to 0.0.0.0).
 *
 *   GET  /health           liveness + per-provider poll intervals
 *   GET  /quota            latest snapshot per provider×window (kind-sorted)
 *   POST /poll[?provider=] force an immediate poll (all or one provider)
 *
 * Auth: when an api.token is set, EVERY request must send
 * `Authorization: Bearer <api.token>` — loopback included. A reverse tunnel
 * (frp, Cloudflare, …) connects to the daemon from 127.0.0.1, so a loopback
 * bypass would silently expose the whole public internet unauthenticated.
 * When no token is set (loopback-only deployment, host stays 127.0.0.1),
 * local clients are allowed and everything else is refused.
 */
import { createServer, type Server } from "node:https";
import type { IncomingMessage, ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import type { QuotaDB } from "./db.js";
import { sortSnapshotsForDisplay, providerDisplayTier } from "./db.js";
import type { QuotaScheduler } from "./scheduler.js";
import { sortWindowsByKind } from "./windows.js";
import { PROVIDER_AUTH_META } from "./auth/provider-meta.js";

/** Read and JSON-parse a request body (capped), null on empty/oversize/invalid. */
async function readJsonBody(req: IncomingMessage, maxBytes = 4096): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > maxBytes) return null;
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return null;
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf-8"));
  } catch {
    return null;
  }
}

export interface ApiServerOptions {
  db: QuotaDB;
  scheduler: QuotaScheduler;
  host: string;
  port: number;
  token: string | null;
  /** app version reported by /health */
  version?: string;
  /**
   * TLS material. Required — the API is HTTPS-only, there is no plaintext
   * fallback. `createServer` throws if the files are unreadable. The server
   * presents the full chain (leaf + CA) so pinning clients can verify against
   * the CA from the very first handshake.
   */
  tls: { certPath: string; keyPath: string; caPath: string };
  /**
   * Optional MCP (streamable HTTP) handler mounted at /mcp. core stays free
   * of the MCP SDK dependency — the CLI builds the server and passes this in.
   * Called with the already-parsed JSON body; return false to fall through
   * to 404. Bearer auth has already been enforced by the time this runs.
   */
  mcpHandler?: (req: IncomingMessage, res: ServerResponse, body: unknown) => Promise<boolean>;
}

export interface QuotaApiProvider {
  providerId: string;
  displayName: string;
  providerType: string;
  /** Disabled providers are not polled — clients should not flag them stale. */
  enabled: boolean;
  /**
   * Live poll health from provider_poll_state. Clients MUST consult this:
   * windows below are change-only snapshots, so a provider stuck in error
   * keeps serving its last good numbers — without this field stale data
   * is indistinguishable from live data.
   */
  poll: { lastPollAt: string; lastStatus: string; lastError: string | null; plan?: string | null } | null;
  windows: Array<{
    windowName: string;
    windowKind: string;
    used: number;
    total: number;
    unit: string;
    remainingPct: number;
    resetAt: string | null;
    timestamp: string;
  }>;
}

function isLoopbackAddress(addr: string | undefined): boolean {
  if (!addr) return false;
  return addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1";
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

/** GET /quota response — shared shape with the web dashboard's /api/quota. */
export function buildQuotaResponse(db: QuotaDB): QuotaApiProvider[] {
  const providers = db.listProviders();
  const snapshots = sortSnapshotsForDisplay(db.getLatestSnapshots());
  const byPid = new Map<string, typeof snapshots>();
  for (const s of snapshots) {
    const arr = byPid.get(s.providerId) ?? [];
    arr.push(s);
    byPid.set(s.providerId, arr);
  }
  // Same ordering contract as sortSnapshotsForDisplay: progress-bar providers
  // first, balance-only providers last, no-snapshot providers trailing. Within
  // a tier, displayPriority then name.
  const priority = (type: string): number =>
    PROVIDER_AUTH_META.find((m) => m.slug === type)?.displayPriority ?? 0;
  return providers
    .slice()
    .sort(
      (a, b) =>
        providerDisplayTier(byPid.get(a.id) ?? []) - providerDisplayTier(byPid.get(b.id) ?? []) ||
        priority(a.provider) - priority(b.provider) ||
        a.displayName.localeCompare(b.displayName),
    )
    .map((p) => ({
    providerId: p.id,
    displayName: p.displayName,
    providerType: p.provider,
    enabled: p.enabled,
    poll: db.getPollState(p.id),
    windows: sortWindowsByKind(byPid.get(p.id) ?? [], (w) => w.windowKind).map((w) => ({
      windowName: w.windowName,
      windowKind: w.windowKind,
      used: w.used,
      total: w.total,
      unit: w.unit,
      remainingPct: w.remainingPct,
      resetAt: w.resetAt,
      timestamp: w.timestamp,
    })),
  }));
}

export function startApiServer(options: ApiServerOptions): Promise<Server> {
  const { db, scheduler, host, port, token } = options;
  const startedAt = new Date().toISOString();

  const server = createServer(
    {
      // Leaf + CA concatenated: use_certificate_chain semantics (first cert is
      // the leaf matched against the key, the rest form the presented chain).
      // A `cert: [leaf, ca]` array instead makes each cert "current" in turn
      // and the private-key check then fails against the CA.
      cert: readFileSync(options.tls.certPath, "utf-8") + readFileSync(options.tls.caPath, "utf-8"),
      key: readFileSync(options.tls.keyPath),
    },
    (req: IncomingMessage, res: ServerResponse) => {
      void handle(req, res);
    },
  );

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

      if (!authorize(req)) {
        sendJson(res, 401, { error: "unauthorized — send Authorization: Bearer <api token>" });
        return;
      }

      if (req.method === "GET" && url.pathname === "/health") {
        const providers = db.listProviders().filter((p) => p.enabled);
        sendJson(res, 200, {
          status: "ok",
          pid: process.pid,
          version: options.version ?? "dev",
          startedAt,
          uptimeSec: Math.round(process.uptime()),
          providers: providers.map((p) => ({
            id: p.id,
            provider: p.provider,
            displayName: p.displayName,
            pollIntervalMs: scheduler.getIntervalMs(p.id),
          })),
        });
        return;
      }

      if (req.method === "GET" && url.pathname === "/quota") {
        sendJson(res, 200, buildQuotaResponse(db));
        return;
      }

      if (req.method === "POST" && url.pathname === "/poll") {
        const providerId = url.searchParams.get("provider") ?? undefined;
        await scheduler.pollNow(providerId);
        sendJson(res, 200, { ok: true, polled: providerId ?? "all" });
        return;
      }

      // ── MCP (streamable HTTP) — same Bearer gate as every other route. ──
      if (url.pathname === "/mcp" && options.mcpHandler) {
        // MCP tools/call payloads (params + context) blow past the 4KB default
        // body limit — a truncated body parses to null and the call dies
        // mysteriously. 1MB is still far from abuse territory.
        const body = req.method === "POST" ? await readJsonBody(req, 1_048_576) : undefined;
        if (await options.mcpHandler(req, res, body)) return;
      }

      sendJson(res, 404, { error: `no route: ${req.method} ${url.pathname}` });
    } catch (err) {
      sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
  }

  function authorize(req: IncomingMessage): boolean {
    // A token gates EVERY request — do not trust loopback here. Behind an
    // frp tunnel the daemon sees all traffic as coming from 127.0.0.1, so a
    // loopback exemption would let the public internet through unauthenticated.
    // Local tools (web dashboard, CLI) send the token explicitly.
    if (token) {
      const header = req.headers.authorization ?? "";
      return header === `Bearer ${token}`;
    }
    // No token configured → loopback-only deployment; allow local, refuse rest.
    return isLoopbackAddress(req.socket.remoteAddress);
  }

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.removeListener("error", reject);
      resolve(server);
    });
  });
}
