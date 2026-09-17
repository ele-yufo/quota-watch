"use client";

import { useState } from "react";

/**
 * Dashboard login — the only public surface. Posts the access password to
 * /api/auth/login, which sets a 30-day HttpOnly session cookie, so this page
 * is a one-visit-per-month detour, not a per-refresh toll.
 */
export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: { preventDefault(): void }) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        window.location.replace("/");
        return;
      }
      setError(res.status === 401 ? "口令不对" : `登录失败（${res.status}）`);
    } catch {
      setError("网络错误，稍后再试");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      <form
        onSubmit={submit}
        className="w-full max-w-xs rounded-2xl border border-line bg-paper-2/60 p-6 shadow-lg shadow-black/5 dark:shadow-black/40"
      >
        <h1 className="font-serif text-[22px] font-semibold tracking-tight text-ink">Quota Watch</h1>
        <p className="mt-1 text-[12px] leading-relaxed text-ink-3">
          输入访问口令。会话保留 30 天，不必每次刷新都登录。
        </p>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
          autoComplete="current-password"
          placeholder="访问口令"
          className="mt-4 w-full rounded-lg border border-line bg-paper px-3 py-2 font-mono text-[13px] text-ink placeholder:text-ink-4 outline-none focus:border-ink-3"
        />
        {error && <p className="mt-2 text-[12px] text-vermillion">{error}</p>}
        <button
          type="submit"
          disabled={busy || !password}
          className="mt-4 w-full rounded-lg bg-ink py-2 font-serif text-[14px] font-semibold text-paper disabled:opacity-40 transition-opacity"
        >
          {busy ? "验证中…" : "进入"}
        </button>
      </form>
    </main>
  );
}
