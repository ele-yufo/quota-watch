"use client";

import type { CardData } from "@/lib/types";
import { WINDOW_KIND_LABEL } from "@/lib/types";
import { formatResetCountdown } from "@/lib/format";
import { atRiskWindows, levelOf, usedPct, type DashboardProps } from "./types";

/**
 * OLED theme — pure black, maximal restraint. A grid of provider tiles, each led
 * by one enormous used% figure. Giant type, deep black, one accent per status,
 * generous negative space. Reads like an always-on vitals display.
 */

const LEVEL_TEXT: Record<"ok" | "warn" | "low", string> = {
  ok: "text-ink",
  warn: "text-ochre",
  low: "text-vermillion",
};
const LEVEL_VAR: Record<"ok" | "warn" | "low", string> = {
  ok: "var(--color-ink)",
  warn: "var(--color-ochre)",
  low: "var(--color-vermillion)",
};

function Tile({ card, onSelect }: { card: CardData; onSelect: (c: CardData) => void }) {
  const primary = card.primary;
  const level = primary ? levelOf(primary.remainingPct) : "ok";
  const pct = primary ? usedPct(primary.remainingPct) : 0;
  const others = card.windows.filter((w) => w.windowName !== primary?.windowName);

  return (
    <button
      onClick={() => onSelect(card)}
      className="group text-left w-full rounded-3xl px-7 py-8 bg-paper-2/40 hover:bg-paper-2 border border-line-soft transition-colors"
    >
      <div className="flex items-baseline justify-between mb-6">
        <span className="text-[15px] text-ink font-medium tracking-tight">{card.displayName}</span>
        <span className="font-mono text-[10px] tracking-[0.14em] uppercase text-ink-4">
          {card.providerType}
        </span>
      </div>

      {primary ? (
        <>
          <div className="flex items-end gap-2">
            <span
              className={`${LEVEL_TEXT[level]} tnum font-semibold leading-[0.85]`}
              style={{ fontSize: 88, letterSpacing: "-0.05em" }}
            >
              {pct.toFixed(0)}
            </span>
            <span className={`${LEVEL_TEXT[level]} text-[26px] font-light mb-2`}>%</span>
            <span className="font-mono text-[10px] tracking-[0.14em] uppercase text-ink-4 mb-4 ml-1">
              {WINDOW_KIND_LABEL[primary.windowKind]} used
            </span>
          </div>

          <div className="mt-5 h-[3px] w-full bg-ink/10 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-[width] duration-500"
              style={{ width: `${pct}%`, background: LEVEL_VAR[level] }}
            />
          </div>

          {others.length > 0 && (
            <div className="mt-6 flex flex-wrap gap-x-6 gap-y-2">
              {others.map((w) => {
                const l = levelOf(w.remainingPct);
                return (
                  <span key={w.windowName} className="font-mono text-[11px] text-ink-3">
                    <span className="text-ink-4">{WINDOW_KIND_LABEL[w.windowKind]}</span>{" "}
                    <span className={`${LEVEL_TEXT[l]} tnum`}>{usedPct(w.remainingPct).toFixed(0)}%</span>
                  </span>
                );
              })}
            </div>
          )}

          {primary.resetAt && (
            <div className="mt-4 font-mono text-[10px] tracking-[0.1em] text-ink-4">
              ↻ resets {formatResetCountdown(primary.resetAt)}
            </div>
          )}
        </>
      ) : (
        <div className="text-ink-3 text-[13px] py-8">等待采集…</div>
      )}
    </button>
  );
}

export function OledDashboard({
  cards,
  daemon,
  updatedAt,
  onSelect,
}: DashboardProps) {
  const atRisk = atRiskWindows(cards);
  const ago = updatedAt ? Math.max(0, Math.round((Date.now() - updatedAt) / 1000)) : null;

  return (
    <main className="min-h-screen px-6 pt-16 pb-8 md:px-12 md:pb-14 max-w-[1200px] mx-auto">
      <header className="mb-12">
        <h1 className="text-[22px] font-semibold tracking-tight text-ink">quota·watch</h1>
        <div className="mt-1 font-mono text-[10px] tracking-[0.12em] uppercase text-ink-4">
          <span className={daemon?.running ? "text-ink-3" : "text-vermillion"}>
            {daemon?.running ? "● live" : "● offline"}
          </span>
          {ago !== null && daemon?.running && ` · ${ago}s ago`}
          {` · ${cards.length} ch`}
          {atRisk.length > 0 && <span className="text-vermillion"> · {atRisk.length} at risk</span>}
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {cards.map((c) => (
          <Tile key={c.providerId} card={c} onSelect={onSelect} />
        ))}
      </div>
    </main>
  );
}
