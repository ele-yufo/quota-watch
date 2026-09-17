"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type ThemeMode = "light" | "dark" | "system";
const ORDER: ThemeMode[] = ["light", "dark", "system"];
const TITLE: Record<ThemeMode, string> = {
  light: "主题：白天（点击切换夜间）",
  dark: "主题：夜间（点击切换跟随系统）",
  system: "主题：跟随系统（点击切换白天）",
};

function resolveTheme(mode: ThemeMode): "light" | "dark" {
  if (mode === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return mode;
}

function applyTheme(mode: ThemeMode): void {
  document.documentElement.dataset.theme = resolveTheme(mode);
}

/** 主题图标 — 与设置齿轮同一笔画体系（stroke 2 / round cap）。 */
function ThemeIcon({ mode }: { mode: ThemeMode }) {
  const common = {
    width: 15,
    height: 15,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  if (mode === "light") {
    return (
      <svg {...common} aria-hidden>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41m11.32-11.32 1.41-1.41" />
      </svg>
    );
  }
  if (mode === "dark") {
    return (
      <svg {...common} aria-hidden>
        <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
      </svg>
    );
  }
  // system — half-lit circle
  return (
    <svg {...common} aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" stroke="none" />
    </svg>
  );
}

/**
 * A fixed control cluster pinned top-right — refresh + setup + theme.
 * Theme cycles 白天 → 夜间 → 跟随系统 and persists in localStorage
 * ('theme-mode', default 'system').
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
  const [mode, setMode] = useState<ThemeMode | null>(null);

  // Read the persisted choice after mount — the value is decided by the
  // head script pre-paint, so no SSR/client mismatch matters before this.
  useEffect(() => {
    const stored = localStorage.getItem("theme-mode") as ThemeMode | null;
    setMode(stored && ORDER.includes(stored) ? stored : "system");
  }, []);

  function cycleTheme() {
    const next = mode === null ? "system" : ORDER[(ORDER.indexOf(mode) + 1) % ORDER.length];
    setMode(next);
    try {
      localStorage.setItem("theme-mode", next);
    } catch {
      /* private mode — apply for this visit only */
    }
    applyTheme(next);
  }

  return (
    <div className="fixed top-3 right-3 z-40 flex items-center gap-0.5 rounded-full border border-line bg-paper/85 backdrop-blur-md px-1.5 py-1 shadow-lg shadow-black/5 dark:shadow-black/40">
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

      <button
        onClick={cycleTheme}
        title={mode ? TITLE[mode] : "主题"}
        aria-label="theme"
        className="w-8 h-8 flex items-center justify-center rounded-full text-ink-3 hover:text-ink hover:bg-paper-2 transition-colors"
      >
        <ThemeIcon mode={mode ?? "system"} />
      </button>

      <Link
        href="/setup"
        title="设置 / 配对"
        aria-label="settings"
        className="w-8 h-8 flex items-center justify-center rounded-full text-ink-3 hover:text-ink hover:bg-paper-2 transition-colors"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
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
