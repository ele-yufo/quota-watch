/**
 * api-server.ts — the daemon's embedded HTTP API.
 *
 * One machine-readable surface for every client that isn't the daemon itself:
 * the web dashboard (daemon status + manual refresh), the macOS menu bar, and
 * the iOS app (over LAN when bound to 0.0.0.0).
 *
 *   GET  /health           liveness + per-provider poll intervals
 *   GET  /quota            latest snapshot per provider×window (kind-sorted)
 *   GET  /tokens           absolute token usage from CLI logs + budget estimates
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
import type { QuotaScheduler } from "./scheduler.js";
import { sortWindowsByKind } from "./windows.js";
import { startPairingSession, claimPairingCode } from "./pairing.js";
import { estimateWindowTokens, WINDOW_SECONDS } from "./token-ledger.js";

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
   * presents the full chain (leaf + CA): iOS pins `chain.last` and never sees
   * the CA if only the leaf is sent.
   */
  tls: { certPath: string; keyPath: string; caPath: string };
  /** CA SHA-256 fingerprint, handed out via /pair/claim so clients can pin. */
  caFingerprint?: string;
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

export interface TokensApiProvider {
  providerId: string;
  displayName: string;
  providerType: string;
  /** raw token sums over rolling spans; null when the CLI writes no logs */
  spans: Record<
    string,
    { seconds: number; totalTokens: number; inputTokens: number; outputTokens: number; cacheTokens: number; events: number }
  >;
  /** per percent-window absolute estimate (anchored to the provider's used%) */
  windows: Array<{
    windowName: string;
    windowKind: string;
    usedPct: number;
    consumedTokens: number;
    estimatedBudgetTokens: number | null;
    estimatedRemainingTokens: number | null;
    burnRatePerHour: number | null;
  }>;
}

/**
 * GET /tokens — absolute token consumption from CLI session logs plus
 * per-window budget estimates. The daemon scans logs into token_events; this
 * route only aggregates. Estimates are extrapolations (cache tokens don't
 * count 1:1 against the real plan budget) — treat as orders of magnitude.
 */
export function buildTokensResponse(db: QuotaDB): TokensApiProvider[] {
  const providers = db.listProviders();
  const snapshots = db.getLatestSnapshots();
  const byPid = new Map<string, typeof snapshots>();
  for (const s of snapshots) {
    const arr = byPid.get(s.providerId) ?? [];
    arr.push(s);
    byPid.set(s.providerId, arr);
  }

  const now = new Date();
  return providers.map((p) => {
    const spans: TokensApiProvider["spans"] = {};
    for (const [kind, seconds] of Object.entries(WINDOW_SECONDS)) {
      const agg = db.tokenUsageSince(
        p.provider,
        new Date(now.getTime() - seconds * 1000).toISOString(),
      );
      if (agg.events === 0) continue;
      spans[kind] = {
        seconds,
        totalTokens: agg.totalTokens,
        inputTokens: agg.inputTokens,
        outputTokens: agg.outputTokens,
        cacheTokens: agg.cacheReadTokens + agg.cacheWriteTokens,
        events: agg.events,
      };
    }

    const windows = (byPid.get(p.id) ?? [])
      .filter((w) => w.unit === "percent")
      .flatMap((w) => {
        const est = estimateWindowTokens(db, p.provider, {
          kind: w.windowKind,
          name: w.windowName,
          usedPct: w.total > 0 ? (w.used / w.total) * 100 : 0,
          remainingPct: w.remainingPct,
        });
        return est ? [est] : [];
      });

    return {
      providerId: p.id,
      displayName: p.displayName,
      providerType: p.provider,
      spans,
      windows,
    };
  });
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

      if (!authorize(req, url.pathname)) {
        sendJson(res, 401, { error: "unauthorized — send Authorization: Bearer <api token>" });
        return;
      }

      // ── Pairing: claim a code → receive the token (the code is the credential,
      // so this route is intentionally token-exempt; the session is short-lived,
      // single-use and attempt-capped). ──
      if (req.method === "POST" && url.pathname === "/pair/claim") {
        const body = (await readJsonBody(req)) as { code?: unknown } | null;
        const code = typeof body?.code === "string" ? body.code : "";
        const result = claimPairingCode(code, token);
        if (result.ok) {
          sendJson(res, 200, {
            ok: true,
            token: result.token,
            port,
            // The one channel a fresh device can learn the CA pin from.
            caFingerprint: options.caFingerprint,
          });
        } else {
          sendJson(res, 401, { ok: false, error: result.reason });
        }
        return;
      }

      // Start a pairing session (token-authed — only someone who already has
      // access can begin pairing a new device). Returns the code + expiry, and
      // the CA fingerprint so the pairing client can pin from the very first
      // request instead of trusting-on-first-use.
      if (req.method === "POST" && url.pathname === "/pair/start") {
        const session = startPairingSession();
        sendJson(res, 200, { ...session, caFingerprint: options.caFingerprint });
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

      if (req.method === "GET" && url.pathname === "/tokens") {
        sendJson(res, 200, buildTokensResponse(db));
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

  function authorize(req: IncomingMessage, pathname: string): boolean {
    // Claiming a pairing code is how a device OBTAINS the token, so it cannot
    // require the token. It is guarded instead by the short-lived, single-use,
    // attempt-capped code (see pairing.ts).
    if (req.method === "POST" && pathname === "/pair/claim") return true;

    // A token gates EVERY other request — do not trust loopback here. Behind an
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
