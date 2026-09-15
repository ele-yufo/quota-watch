import { createHmac, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { cookies } from "next/headers";

/**
 * Dashboard session auth — replaces the ECS-BJ Basic Auth gate.
 *
 * The old gate had two failures: browsers re-prompt Basic Auth on every
 * refresh (mobile Safari especially), and the frp side door (:38300) reaches
 * this app directly, bypassing OpenResty entirely. Auth therefore lives HERE,
 * inside the app, guarding every entry point.
 *
 * Cookie: `qw_session = "<exp-epoch>.<hmac-sha256(secret, "qw-session|exp")>"`
 * — stateless, HttpOnly, 30d. Secret is the daemon api.token (config.json),
 * overridable via QW_SESSION_SECRET.
 *
 * FAIL-CLOSED: auth is disabled ONLY when a readable config.json explicitly
 * has no api.token (loopback-only deployment, matching the daemon). A corrupt
 * or unreadable config is NOT "no auth" — it's deny-all — because this app
 * binds beyond loopback and an accidentally-empty secret would expose the
 * read-write API (provider CRUD, credential import) to the public tunnel.
 */

export const SESSION_COOKIE = "qw_session";
const SESSION_TTL_S = 30 * 24 * 3600;

type AuthState =
  | { kind: "off" } // explicit loopback-only deployment — auth off
  | { kind: "on"; secret: string }
  | { kind: "broken" }; // config unreadable/corrupt — deny everything

function authState(): AuthState {
  const fromEnv = process.env.QW_SESSION_SECRET;
  if (fromEnv) return { kind: "on", secret: fromEnv };

  // Parse the raw file ourselves: loadAppConfig() deliberately swallows
  // corrupt-JSON errors into defaults, which would read as "no token" and
  // fail open. Raw parsing distinguishes the three states honestly.
  let raw: string;
  try {
    raw = readFileSync(join(homedir(), ".quota-watch", "config.json"), "utf-8");
  } catch {
    return { kind: "off" }; // no config file = fresh loopback-only install
  }
  let parsed: { api?: { token?: unknown } };
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { kind: "broken" };
  }
  const token = parsed?.api?.token;
  return typeof token === "string" && token.length > 0
    ? { kind: "on", secret: token }
    : { kind: "off" };
}

function sign(exp: number, sec: string): string {
  return createHmac("sha256", sec).update(`qw-session|${exp}`).digest("hex");
}

/** Fresh cookie payload + its TTL for Set-Cookie attributes. */
export function issueSession(): { value: string; maxAge: number } {
  const { secret } = authState() as { kind: "on"; secret: string };
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_S;
  return { value: `${exp}.${sign(exp, secret)}`, maxAge: SESSION_TTL_S };
}

export function verifySession(value: string | undefined | null): boolean {
  const state = authState();
  if (state.kind !== "on") return false; // off → nothing to verify; broken → deny
  if (!value) return false;
  const dot = value.indexOf(".");
  if (dot <= 0) return false;
  const exp = Number(value.slice(0, dot));
  if (!Number.isFinite(exp) || exp * 1000 < Date.now()) return false;
  const expect = Buffer.from(sign(exp, state.secret));
  const got = Buffer.from(value.slice(dot + 1));
  return got.length === expect.length && timingSafeEqual(got, expect);
}

/** Guard for API route handlers: null = proceed, Response = 401 to return. */
export function requireSession(req: Request): Response | null {
  const state = authState();
  if (state.kind === "off") return null;
  const header = req.headers.get("cookie") ?? "";
  const match = header
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${SESSION_COOKIE}=`));
  let value: string | undefined;
  if (match) {
    try {
      value = decodeURIComponent(match.slice(SESSION_COOKIE.length + 1));
    } catch {
      value = undefined; // malformed % sequence — treat as no session, not a 500
    }
  }
  if (value && verifySession(value)) return null;
  return Response.json({ error: "unauthorized" }, { status: 401 });
}

/** Server-component check for layouts: awaited cookies() store. */
export async function serverSessionValid(): Promise<boolean> {
  const state = authState();
  if (state.kind === "off") return true; // loopback-only — no gate at all
  if (state.kind === "broken") return false; // fail closed
  const store = await cookies();
  return verifySession(store.get(SESSION_COOKIE)?.value);
}

/**
 * The dashboard password — same secret that signs the session.
 * - string: auth on, verify against it
 * - null:   auth off (loopback-only deployment) — login not applicable
 * - "broken": config.json unreadable/corrupt — refuse login until fixed
 */
export function dashboardPassword(): string | null | "broken" {
  const state = authState();
  return state.kind === "on" ? state.secret : state.kind === "broken" ? "broken" : null;
}
