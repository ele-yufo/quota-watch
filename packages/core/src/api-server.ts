/**
 * api-server.ts — the daemon's embedded HTTP API.
 *
 * One machine-readable surface for every client that isn't the daemon itself:
 * the web dashboard (daemon status + manual refresh), the macOS menu bar, and
 * the iOS app (over LAN when bound to 0.0.0.0).
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
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { QuotaDB } from "./db.js";
import type { QuotaScheduler } from "./scheduler.js";
import { sortWindowsByKind } from "./windows.js";

export interface ApiServerOptions {
  db: QuotaDB;
  scheduler: QuotaScheduler;
  host: string;
  port: number;
  token: string | null;
  /** app version reported by /health */
  version?: string;
}

export interface QuotaApiProvider {
  providerId: string;
  displayName: string;
  providerType: string;
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
  const snapshots = db.getLatestSnapshots();
  const byPid = new Map<string, typeof snapshots>();
  for (const s of snapshots) {
    const arr = byPid.get(s.providerId) ?? [];
    arr.push(s);
    byPid.set(s.providerId, arr);
  }
  return providers.map((p) => ({
    providerId: p.id,
    displayName: p.displayName,
    providerType: p.provider,
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

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    void handle(req, res);
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      if (!authorize(req)) {
        sendJson(res, 401, { error: "unauthorized — send Authorization: Bearer <api token>" });
        return;
      }

      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

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

      sendJson(res, 404, { error: `no route: ${req.method} ${url.pathname}` });
    } catch (err) {
      sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
  }

  function authorize(req: IncomingMessage): boolean {
    // A token gates EVERY request — do not trust loopback here. Behind an frp
    // tunnel the daemon sees all traffic as coming from 127.0.0.1, so a
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
