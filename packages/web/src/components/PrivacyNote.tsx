"use client";

import { useEffect, useState } from "react";

const DISMISS_KEY = "qw.privacy.ack";

/**
 * First-run privacy + credentials disclosure. Explains, before the user
 * connects anything, exactly how credentials are sourced and handled — the
 * key trust question for a tool that reads local API tokens. Dismissible;
 * the acknowledgement persists in localStorage.
 */
export function PrivacyNote() {
  const [dismissed, setDismissed] = useState(true); // assume dismissed until we read storage (no flash)

  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(DISMISS_KEY) === "1");
    } catch {
      setDismissed(false);
    }
  }, []);

  function ack() {
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* ignore */
    }
    setDismissed(true);
  }

  if (dismissed) return null;

  return (
    <section
      aria-label="privacy"
      className="border border-line bg-paper-2 px-6 py-5 mb-8"
    >
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="font-mono text-[11px] tracking-[0.18em] uppercase text-ink-2">
          凭据与隐私 · 先读这个
        </h2>
        <button
          onClick={ack}
          className="font-mono text-[10px] tracking-[0.12em] uppercase text-ink-4 hover:text-ink"
        >
          我知道了 ✕
        </button>
      </div>
      <ul className="space-y-2.5 font-serif text-[13.5px] leading-relaxed text-ink-2 max-w-[640px]">
        <li className="flex gap-2.5">
          <span className="text-ink-4 mt-0.5">01</span>
          <span>
            <span className="text-ink">Claude / Codex / Antigravity 无需手动配置</span>
            ——直接复用你本机官方 CLI 已登录的凭据（读磁盘上的
            <code className="mx-1 text-ink-3">~/.claude</code>/
            <code className="mx-1 text-ink-3">~/.codex</code>
            等文件），token 过期时自动刷新并写回同一文件。
          </span>
        </li>
        <li className="flex gap-2.5">
          <span className="text-ink-4 mt-0.5">02</span>
          <span>
            <span className="text-ink">GLM / Kimi / OpenCode Go 需要你提供凭据</span>
            （API key 或网站 Cookie）。这些只写进本机
            <code className="mx-1 text-ink-3">~/.quota-watch/data.db</code>
            （权限 600，仅当前用户可读）。
          </span>
        </li>
        <li className="flex gap-2.5">
          <span className="text-ink-4 mt-0.5">03</span>
          <span>
            <span className="text-ink">凭据只留在本地、只用于查配额</span>
            ——只向各家官方配额接口发请求，
            <span className="text-ink">从不上传到任何第三方或云端</span>
            。本项目无自有服务器。
          </span>
        </li>
        <li className="flex gap-2.5">
          <span className="text-ink-4 mt-0.5">04</span>
          <span>
            网页只把凭据的
            <span className="text-ink">字段名</span>
            回传给界面，凭据值本身从不发到浏览器。移除渠道会一并删除其存储的凭据。
          </span>
        </li>
      </ul>
    </section>
  );
}
