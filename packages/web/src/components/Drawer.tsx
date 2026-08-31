"use client";

import { useEffect } from "react";
import type { CardData, LatestSnapshot } from "@/lib/types";
import { InkBand } from "./InkBand";
import { AlertRuleList } from "./AlertRuleList";
import {
  formatResetCountdown,
  formatUsage,
  headline,
  INK_TEXT,
  statusFromRemaining,
} from "@/lib/format";

function WindowRow({ snap }: { snap: LatestSnapshot }) {
  const usedPct = 100 - snap.remainingPct;
  const level = statusFromRemaining(snap.remainingPct);
  const reset = formatResetCountdown(snap.resetAt);
  const usage = formatUsage(snap.used, snap.total, snap.unit);
  const head = headline(usedPct, snap.used, snap.unit);

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-[10px] tracking-[0.18em] uppercase text-ink-3">
          {snap.windowName}
        </span>
        <span className="font-mono text-[10px] tracking-[0.1em] text-ink-2">
          {reset ? `RESETS  ${reset}` : "NO RESET"}
        </span>
      </div>
      <div
        className={`font-serif font-semibold tnum leading-none mt-2 ${INK_TEXT[level]}`}
        style={{ fontSize: 64, letterSpacing: "-0.04em" }}
      >
        {head.value}
        {head.sub && (
          <span style={{ fontSize: 22, fontWeight: 400, verticalAlign: "super" }}>
            {head.sub}
          </span>
        )}
      </div>
      <div className="mt-3">
        <InkBand usedPct={usedPct} level={level} variant="hero" />
      </div>
      <p className="font-serif italic text-[12px] text-ink-2 mt-2">
        of {usage.total}
        {usage.suffix ? ` ${usage.suffix}` : ""} · used {usage.used}
        {usage.suffix ? ` ${usage.suffix}` : ""}
      </p>
    </div>
  );
}

interface DrawerProps {
  card: CardData;
  onClose: () => void;
}

export function Drawer({ card, onClose }: DrawerProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div
        className="absolute inset-0 bg-ink/30 [animation:qw-fade-in_0.15s_ease-out]"
        onClick={onClose}
      />
      <aside className="relative w-full max-w-[460px] h-full bg-paper border-l border-line overflow-y-auto [animation:qw-slide-in_0.2s_ease-out]">
        <div className="p-8">
          <div className="flex items-baseline justify-between mb-1">
            <span className="font-mono text-[10px] tracking-[0.18em] uppercase text-ink-3">
              {card.providerType}
            </span>
            <button
              onClick={onClose}
              className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3 hover:text-ink"
            >
              close ×
            </button>
          </div>
          <h2 className="font-serif italic text-[28px] leading-tight text-ink pb-5 border-b-[3px] border-ink">
            {card.displayName}
          </h2>

          <section className="mt-6 mb-9">
            <div className="font-mono text-[10px] tracking-[0.18em] uppercase text-ink-3 mb-5">
              windows
            </div>
            <div className="space-y-7">
              {card.windows.map((w) => (
                <WindowRow key={w.windowName} snap={w} />
              ))}
            </div>
          </section>

          <section>
            <AlertRuleList providerId={card.providerId} windows={card.windows} />
          </section>
        </div>
      </aside>
    </div>
  );
}
