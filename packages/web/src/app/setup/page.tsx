"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { DaemonStatus } from "@/lib/types";
import { PrivacyNote } from "@/components/PrivacyNote";

interface CredentialField {
  key: string;
  label: string;
  hint?: string;
}
interface ProviderAuthMeta {
  slug: string;
  displayName: string;
  authKind: "oauth-file" | "api-key";
  cliSource?: string;
  cliLoginHint?: string;
  fields?: CredentialField[];
  available?: boolean;
}
interface Configured {
  id: string;
  provider: string;
  displayName: string;
  enabled: boolean;
}
interface ProvidersResp {
  meta: ProviderAuthMeta[];
  configured: Configured[];
}
interface ScanResp {
  found: boolean;
  source?: string;
  account?: string;
  expiresAt?: number;
  expired?: boolean;
  importable?: boolean;
  hint?: string;
  reason?: string;
}

export default function SetupPage() {
  const [data, setData] = useState<ProvidersResp | null>(null);
  const [daemon, setDaemon] = useState<DaemonStatus | null>(null);
  const [scans, setScans] = useState<Record<string, ScanResp>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [fieldValues, setFieldValues] = useState<Record<string, Record<string, string>>>({});
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [providersRes, daemonRes] = await Promise.all([
        fetch("/api/providers", { cache: "no-store" }),
        fetch("/api/daemon", { cache: "no-store" }),
      ]);
      if (providersRes.ok) setData(await providersRes.json());
      if (daemonRes.ok) setDaemon(await daemonRes.json());
    } catch {
      setError("加载失败");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function scan(slug: string) {
    setBusy(slug);
    setError(null);
    try {
      const r = await fetch(`/api/auth/scan?slug=${slug}`, { cache: "no-store" });
      const res: ScanResp = await r.json();
      setScans((s) => ({ ...s, [slug]: res }));
    } catch {
      setError("扫描失败");
    } finally {
      setBusy(null);
    }
  }

  async function connect(slug: string, autoImport = false) {
    setBusy(slug);
    setError(null);
    const r = await fetch("/api/providers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(autoImport ? { slug, autoImport: true } : { slug }),
    });
    if (!r.ok) setError(await r.json().then((b) => b.error).catch(() => "连接失败"));
    setBusy(null);
    await load();
  }

  async function saveFields(slug: string, fields: CredentialField[]) {
    const values = fieldValues[slug] ?? {};
    if (fields.some((f) => !values[f.key]?.trim())) return;
    setBusy(slug);
    setError(null);
    const r = await fetch("/api/providers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug, credentials: values }),
    });
    if (!r.ok) setError(await r.json().then((b) => b.error).catch(() => "保存失败"));
    setBusy(null);
    setFieldValues((v) => ({ ...v, [slug]: {} }));
    await load();
  }

  async function remove(id: string) {
    await fetch(`/api/providers?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    await load();
  }

  const configuredCount = data?.configured.length ?? 0;

  return (
    <main className="max-w-[820px] mx-auto px-8 py-6 pb-20">
      <header className="flex items-baseline justify-between pb-3 mb-6 border-b-[3px] border-ink">
        <div>
          <Link
            href="/"
            className="font-mono text-[11px] tracking-[0.14em] uppercase text-ink-3 hover:text-ink"
          >
            ← dashboard
          </Link>
          <h1 className="font-serif font-semibold text-[28px] leading-none tracking-[-0.02em] text-ink mt-2">
            setup
          </h1>
        </div>
      </header>

      <PrivacyNote />

      {/* Progress: the two things that must both be true before data flows */}
      <div className="grid grid-cols-2 gap-3 mb-8">
        <StepCard
          index={1}
          title="连接渠道"
          done={configuredCount > 0}
          detail={configuredCount > 0 ? `${configuredCount} 个已连接` : "至少连接一个"}
        />
        <StepCard
          index={2}
          title="daemon 采集中"
          done={daemon?.running === true}
          detail={
            daemon?.running
              ? `pid ${daemon.pid} · 每 ~10s 采集`
              : "终端执行：quota-watch daemon start"
          }
        />
      </div>

      <p className="font-serif italic text-[14px] text-ink-2 mb-8 max-w-[600px]">
        OAuth 类（Claude / Codex / Antigravity）复用本机 CLI 已登录的凭证——点「扫描」即可导入，
        token 过期自动保活。API key / Cookie 类直接填表单，OpenCode Go 若配置过社区 CLI 可一键导入。
      </p>

      {error && (
        <div className="font-serif italic text-[13px] text-vermillion mb-6 border-l-2 border-vermillion pl-3">
          {error}
        </div>
      )}

      {!data && <div className="font-serif italic text-ink-3">loading…</div>}
      {data && (
        <div className="space-y-4">
          {data.meta.filter((m) => m.available !== false).map((m) => {
            const cfg = data.configured.find((c) => c.provider === m.slug);
            const scanRes = scans[m.slug];
            const values = fieldValues[m.slug] ?? {};
            const fields = m.fields ?? [];
            const canScan = m.authKind === "oauth-file" || m.slug === "opencode-go";

            return (
              <article key={m.slug} className="border border-line bg-paper px-6 py-5">
                <div className="flex items-baseline justify-between mb-1">
                  <h3 className="font-serif italic text-[19px] text-ink">{m.displayName}</h3>
                  <span className="font-mono text-[10px] tracking-[0.14em] uppercase text-ink-4">
                    {m.authKind === "oauth-file" ? "oauth · cli" : m.slug === "opencode-go" ? "cookie" : "api key"}
                  </span>
                </div>
                {!cfg && (
                  <p className="font-serif italic text-[12px] text-ink-3 mb-3">
                    {m.authKind === "oauth-file"
                      ? "自动 · 复用本机官方 CLI 凭据，扫描即可，无需手填"
                      : m.slug === "opencode-go"
                        ? "半自动 · 配过社区 CLI 可一键导入，否则手填 Workspace + Cookie"
                        : "手动 · 填一次 API key"}
                  </p>
                )}

                {cfg ? (
                  <div className="flex items-center justify-between">
                    <span className="font-serif italic text-[13px] text-ink-2">
                      ✓ {cfg.displayName} — connected
                    </span>
                    <button
                      onClick={() => remove(cfg.id)}
                      className="font-mono text-[11px] text-vermillion border border-vermillion/40 px-2 py-0.5 hover:bg-vermillion/10"
                    >
                      remove
                    </button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {canScan && (
                      <div className="flex items-center gap-3 flex-wrap">
                        <button
                          onClick={() => scan(m.slug)}
                          disabled={busy === m.slug}
                          className="font-mono text-[11px] text-ink border border-ink/40 px-3 py-1 hover:bg-ink/5 disabled:opacity-40"
                        >
                          {busy === m.slug ? "scanning…" : "扫描本机凭据"}
                        </button>
                        {scanRes?.found && (
                          <>
                            <span className="font-serif italic text-[12px] text-ink-2">
                              已检测到
                              {scanRes.account ? ` · ${scanRes.account}` : ""}
                              {scanRes.expired ? " · 已过期，将自动刷新" : ""}
                            </span>
                            <button
                              onClick={() => connect(m.slug, Boolean(scanRes.importable))}
                              disabled={busy === m.slug}
                              className="font-mono text-[11px] text-paper bg-ink px-3 py-1 hover:bg-ink/80 disabled:opacity-40"
                            >
                              {scanRes.importable ? "一键导入" : "connect"}
                            </button>
                          </>
                        )}
                        {scanRes && !scanRes.found && (
                          <span className="font-serif italic text-[12px] text-ink-3">
                            {scanRes.hint ?? m.cliLoginHint ?? "未找到本机凭据"}
                          </span>
                        )}
                      </div>
                    )}

                    {m.authKind === "api-key" && fields.length > 0 && (
                      <div className="space-y-2">
                        {fields.map((f) => (
                          <div key={f.key}>
                            <input
                              type="password"
                              placeholder={f.hint ? `${f.label} — ${f.hint}` : f.label}
                              value={values[f.key] ?? ""}
                              onChange={(e) =>
                                setFieldValues((v) => ({
                                  ...v,
                                  [m.slug]: { ...v[m.slug], [f.key]: e.target.value },
                                }))
                              }
                              className="w-full bg-transparent border border-line font-mono text-[12px] text-ink px-3 py-1.5 outline-none focus:border-ink/60"
                            />
                          </div>
                        ))}
                        <button
                          onClick={() => saveFields(m.slug, fields)}
                          disabled={
                            busy === m.slug || fields.some((f) => !values[f.key]?.trim())
                          }
                          className="font-mono text-[11px] text-paper bg-ink px-3 py-1.5 hover:bg-ink/80 disabled:opacity-40"
                        >
                          save
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}

      <div className="mt-10 border-t border-line pt-5 space-y-1.5">
        <p className="font-mono text-[11px] text-ink-4 leading-relaxed">
          手机（iOS）连接：终端运行{" "}
          <code className="text-ink-3">quota-watch daemon start --lan</code>，再用{" "}
          <code className="text-ink-3">quota-watch connect</code> 查看配对信息。
        </p>
        <p className="font-mono text-[11px] text-ink-4 leading-relaxed">
          连接后回{" "}
          <Link href="/" className="underline hover:text-ink">
            dashboard
          </Link>{" "}
          查看；采集节奏 ~10s，可在 ~/.quota-watch/config.json 调整。
        </p>
      </div>
    </main>
  );
}

function StepCard({
  index,
  title,
  done,
  detail,
}: {
  index: number;
  title: string;
  done: boolean;
  detail: string;
}) {
  return (
    <div className={`border px-4 py-3 ${done ? "border-line bg-paper" : "border-ink/40 bg-paper-2"}`}>
      <div className="flex items-baseline gap-2">
        <span className={`font-mono text-[11px] ${done ? "text-ink-3" : "text-vermillion"}`}>
          {done ? "✓" : index}
        </span>
        <span className="font-serif text-[14px] text-ink">{title}</span>
      </div>
      <p className="font-mono text-[10px] text-ink-4 mt-1 truncate" title={detail}>
        {detail}
      </p>
    </div>
  );
}
