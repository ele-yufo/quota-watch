import type { CardData, DaemonStatus } from "@/lib/types";

/**
 * Every per-theme dashboard renders the whole page body from this same data +
 * callbacks, in its own layout and visual language.
 */
export interface DashboardProps {
  cards: CardData[];
  daemon: DaemonStatus | null;
  updatedAt: number | null;
  polling: boolean;
  onPollNow: () => void;
  onSelect: (card: CardData) => void;
}

/** used% for a window (the headline consumption figure). */
export function usedPct(remainingPct: number): number {
  return Math.max(0, Math.min(100, 100 - remainingPct));
}

/** status bucket from remaining %. */
export function levelOf(remainingPct: number): "ok" | "warn" | "low" {
  if (remainingPct < 10) return "low";
  if (remainingPct < 30) return "warn";
  return "ok";
}

/** windows across all providers flagged critical (<10% remaining). */
export function atRiskWindows(cards: CardData[]) {
  return cards.flatMap((c) =>
    c.windows.filter((w) => w.remainingPct < 10).map((w) => ({ card: c, window: w })),
  );
}
