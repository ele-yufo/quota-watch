"use client";

import Link from "next/link";

/**
 * A fixed control cluster pinned top-right — refresh + setup.
 */
export function ControlDock({
  polling,
  pollFailed = false,
  onPollNow,
}: {
  polling: boolean;
  /** Last forced poll round failed (daemon down / non-200) — tint ↻ so the
   *  staleness is visible instead of silent. */
  pollFailed?: boolean;
  onPollNow: () => void;
}) {
  return (
    <div className="fixed top-3 right-3 z-40 flex items-center gap-0.5 rounded-full border border-line bg-paper/85 backdrop-blur-md px-1.5 py-1 shadow-lg shadow-black/5">
      <button
        onClick={() => onPollNow()}
        disabled={polling}
        title={pollFailed ? "采集失败 — 稍后自动重试" : "立即刷新"}
        aria-label="refresh"
        className={`w-8 h-8 flex items-center justify-center rounded-full hover:text-ink hover:bg-paper-2 disabled:opacity-40 transition-colors ${
          pollFailed ? "text-vermillion" : "text-ink-3"
        }`}
      >
        <span className={`text-[15px] leading-none ${polling ? "animate-spin" : ""}`}>↻</span>
      </button>

      <Link
        href="/setup"
        title="设置 / 配对"
        aria-label="settings"
        className="w-8 h-8 flex items-center justify-center rounded-full text-ink-3 hover:text-ink hover:bg-paper-2 transition-colors"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </Link>

      <button
        onClick={async () => {
          try {
            await fetch("/api/auth/logout", { method: "POST" });
          } catch {
            /* network blip — navigate anyway; the cookie dies with the session */
          }
          window.location.href = "/login";
        }}
        title="退出登录"
        aria-label="logout"
        className="w-8 h-8 flex items-center justify-center rounded-full text-ink-3 hover:text-ink hover:bg-paper-2 transition-colors"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
          <polyline points="16 17 21 12 16 7" />
          <line x1="21" y1="12" x2="9" y2="12" />
        </svg>
      </button>
    </div>
  );
}
