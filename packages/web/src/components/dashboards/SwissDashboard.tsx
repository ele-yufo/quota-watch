"use client";

import type { CardData, LatestSnapshot } from "@/lib/types";
import { WINDOW_KIND_LABEL } from "@/lib/types";
import { formatResetCountdown } from "@/lib/format";
import { atRiskWindows, levelOf, usedPct, type DashboardProps } from "./types";

/**
 * Swiss theme — International Typographic Style. A strict modular grid, heavy
 * sans headline, hairline rules, tabular figures, horizontal bar charts, and a
 * single red accent reserved for at-risk. Systematic and precise.
 */

const LEVEL_VAR: Record<"ok" | "warn" | "low", string> = {
  ok: "var(--color-ink)",
  warn: "var(--color-ochre)",
  low: "var(--color-vermillion)",
};
const LEVEL_TEXT: Record<"ok" | "warn" | "low", string> = {
  ok: "text-ink",
  warn: "text-ochre",
  low: "text-vermillion",
};

function WindowCell({ w }: { w: LatestSnapshot }) {
  const pct = usedPct(w.remainingPct);
  const level = levelOf(w.remainingPct);
  const reset = formatResetCountdown(w.resetAt);
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between mb-1.5">
        <span className="font-mono text-[10px] tracking-[0.12em] uppercase text-ink-3">
          {WINDOW_KIND_LABEL[w.windowKind]} · {w.windowName}
        </span>
        <span className="font-mono text-[10px] text-ink-4">{reset ? `↻ ${reset}` : ""}</span>
      </div>
      <div className="flex items-baseline gap-3">
        <span className={`${LEVEL_TEXT[level]} tnum font-semibold text-[28px] leading-none w-[64px]`}>
          {pct.toFixed(0)}
          <span className="text-[15px] font-normal">%</span>
        </span>
        <div className="flex-1 h-[10px] bg-ink/8 relative">
          <div className="absolute inset-y-0 left-0" style={{ width: `${pct}%`, background: LEVEL_VAR[level] }} />
        </div>
      </div>
    </div>
  );
}

function ProviderRow({ card, n, onSelect }: { card: CardData; n: number; onSelect: (c: CardData) => void }) {
  return (
    <button
      onClick={() => onSelect(card)}
      className="grid grid-cols-[36px_180px_1fr] gap-6 items-start text-left py-6 border-t border-line hover:bg-paper-2/60 transition-colors px-2 -mx-2"
    >
      <span className="font-mono text-[13px] text-ink-4 tnum pt-1">
        {String(n).padStart(2, "0")}
      </span>
      <div className="pt-0.5">
        <div className="text-[17px] font-semibold text-ink leading-tight">{card.displayName}</div>
        <div className="font-mono text-[10px] tracking-[0.12em] uppercase text-ink-4 mt-1">
          {card.providerType}
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-x-8 gap-y-4">
        {card.windows.length ? (
          card.windows.map((w) => <WindowCell key={w.windowName} w={w} />)
        ) : (
          <span className="font-mono text-[12px] text-ink-3">awaiting data</span>
        )}
      </div>
    </button>
  );
}

export function SwissDashboard({
  cards,
  daemon,
  updatedAt,
  onSelect,
}: DashboardProps) {
  const atRisk = atRiskWindows(cards);
  const ago = updatedAt ? Math.max(0, Math.round((Date.now() - updatedAt) / 1000)) : null;

  return (
    <main className="max-w-[1080px] mx-auto px-8 pt-16 pb-10 md:pb-16">
      {/* masthead */}
      <header className="mb-2">
        <h1 className="text-ink font-bold leading-[0.92] tracking-[-0.03em]" style={{ fontSize: "clamp(40px, 8vw, 76px)" }}>
          Quota<br />Watch
        </h1>
        <div className="mt-6 flex items-center gap-6 font-mono text-[11px] tracking-[0.06em] text-ink-3 pb-4 border-b-[3px] border-ink">
          <span className={daemon?.running ? "" : "text-vermillion"}>
            {daemon?.running ? "LIVE" : "OFFLINE"}
          </span>
          {ago !== null && daemon?.running && <span className="text-ink-4">UPDATED {ago}S AGO</span>}
          <span className="text-ink-4">{String(cards.length).padStart(2, "0")} CHANNELS</span>
          {atRisk.length > 0 && <span className="text-vermillion">{atRisk.length} AT RISK</span>}
          <span className="ml-auto text-ink-4">FIG. 01 — CONSUMPTION</span>
        </div>
      </header>

      <div>
        {cards.map((c, i) => (
          <ProviderRow key={c.providerId} card={c} n={i + 1} onSelect={onSelect} />
        ))}
        <div className="border-t border-ink" />
      </div>
    </main>
  );
}
