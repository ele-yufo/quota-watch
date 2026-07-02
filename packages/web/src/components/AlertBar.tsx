"use client";

import type { CardData, LatestSnapshot } from "@/lib/types";

interface Props {
  cards: CardData[];
  onOpen: (card: CardData) => void;
}

/**
 * Bottom risk strip — appears only when a channel is critical (< 10%).
 * Print-style: a vermillion rule under the columns at risk.
 */
export function AlertBar({ cards, onOpen }: Props) {
  const atRisk = cards.filter(
    (c): c is CardData & { primary: LatestSnapshot } =>
      c.primary != null && c.primary.remainingPct < 10,
  );
  if (atRisk.length === 0) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-30 border-t-[3px] border-vermillion bg-paper">
      <div className="max-w-[1100px] mx-auto px-8 py-2.5 flex items-center gap-3 flex-wrap">
        <span className="font-mono text-[11px] tracking-[0.14em] uppercase text-vermillion">
          {atRisk.length} at risk
        </span>
        <div className="flex gap-2 flex-wrap">
          {atRisk.map((c) => (
            <button
              key={c.providerId}
              onClick={() => onOpen(c)}
              className="font-mono text-[11px] text-ink-2 border border-line px-2 py-1 hover:border-vermillion transition-colors"
            >
              {c.displayName} · {c.primary.windowName} ·{" "}
              <span className="tnum">{(100 - c.primary.remainingPct).toFixed(0)}%</span> used
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
