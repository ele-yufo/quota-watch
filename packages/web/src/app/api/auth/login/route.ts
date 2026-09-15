import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { SESSION_COOKIE, dashboardPassword, issueSession } from "@/lib/session";

/**
 * POST /api/auth/login — exchange the dashboard password for a 30-day
 * HttpOnly session cookie. The wrong-password path sleeps 500ms so the
 * public endpoint can't be brute-forced at request speed.
 */
export async function POST(req: NextRequest) {
  const password = dashboardPassword();
  if (password === null) {
    return NextResponse.json(
      { error: "auth disabled — this deployment has no api token configured" },
      { status: 400 },
    );
  }
  if (password === "broken") {
    return NextResponse.json(
      { error: "config.json is unreadable or corrupt — fix it, then retry" },
      { status: 503 },
    );
  }

  const body = (await req.json().catch(() => null)) as { password?: unknown } | null;
  const given = typeof body?.password === "string" ? body.password : "";
  const a = Buffer.from(given);
  const b = Buffer.from(password);
  const ok = a.length === b.length && timingSafeEqual(a, b);

  if (!ok) {
    await new Promise((r) => setTimeout(r, 500));
    return NextResponse.json({ error: "wrong password" }, { status: 401 });
  }

  // Secure only on https entry paths: the ECS front door sends
  // X-Forwarded-Proto, so the TLS front door gets a Secure cookie while the
  // plain-HTTP frp side door / LAN paths can still log in at all (browsers
  // drop Secure cookies from non-secure origins — unconditional Secure made
  // login there an infinite redirect loop).
  const forwardedProto = req.headers.get("x-forwarded-proto");
  const isHttps = forwardedProto
    ? forwardedProto.split(",")[0]!.trim() === "https"
    : new URL(req.url).protocol === "https:";

  const { value, maxAge } = issueSession();
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, value, {
    httpOnly: true,
    sameSite: "lax",
    secure: isHttps,
    path: "/",
    maxAge,
  });
  return res;
}
