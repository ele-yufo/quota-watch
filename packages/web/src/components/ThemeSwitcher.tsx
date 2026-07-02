"use client";

import { useEffect, useRef, useState } from "react";
import { THEMES } from "@/lib/themes";
import { useTheme } from "@/lib/theme-context";

/**
 * Theme picker — a small popover of the available themes. Each theme is a whole
 * different dashboard layout (see components/dashboards), not just a recolour,
 * so this drives the shared ThemeContext. Styling uses theme tokens so the
 * control adapts to whichever dashboard is active.
 */
export function ThemeSwitcher() {
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const active = THEMES.find((t) => t.id === theme) ?? THEMES[0]!;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="切换主题"
        className="font-mono text-[11px] tracking-[0.14em] uppercase text-ink-3 hover:text-ink"
      >
        ◑ {active.label}
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute right-0 top-full mt-2 z-40 min-w-[176px] border border-line bg-paper shadow-lg [animation:qw-fade-in_0.12s_ease-out]"
        >
          {THEMES.map((t) => (
            <button
              key={t.id}
              role="option"
              aria-selected={t.id === theme}
              onClick={() => {
                setTheme(t.id);
                setOpen(false);
              }}
              className={`flex w-full items-baseline justify-between gap-4 px-3 py-2 text-left hover:bg-paper-2 ${
                t.id === theme ? "bg-paper-2" : ""
              }`}
            >
              <span className="text-[14px] text-ink">{t.label}</span>
              <span className="font-mono text-[9px] tracking-[0.12em] uppercase text-ink-4">
                {t.id === theme ? "● " : ""}
                {t.hint}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
