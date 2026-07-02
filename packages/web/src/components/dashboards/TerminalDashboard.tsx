"use client";

import type { CardData, LatestSnapshot } from "@/lib/types";
import { WINDOW_KIND_LABEL } from "@/lib/types";
import { formatResetCountdown } from "@/lib/format";
import { atRiskWindows, levelOf, usedPct, type DashboardProps } from "./types";

/**
 * Terminal theme — the dashboard IS a terminal. A window chrome + CRT scanlines,
 * a live `quota status --watch` session rendering each provider as a btop-style
 * block with ASCII bar gauges. Monospace, phosphor glow, blinking cursor.
 */

const LEVEL_TEXT: Record<"ok" | "warn" | "low", string> = {
  ok: "text-ink",
  warn: "text-ochre",
  low: "text-vermillion",
};

function Bar({ pct, level }: { pct: number; level: "ok" | "warn" | "low" }) {
  const cells = 24;
  const filled = Math.round((pct / 100) * cells);
  return (
    <span className="tracking-[-0.05em]">
      <span className={LEVEL_TEXT[level]}>{"█".repeat(filled)}</span>
      <span className="text-ink-4">{"░".repeat(cells - filled)}</span>
    </span>
  );
}

function WindowLine({ w }: { w: LatestSnapshot }) {
  const pct = usedPct(w.remainingPct);
  const level = levelOf(w.remainingPct);
  const reset = formatResetCountdown(w.resetAt);
  return (
    <div className="flex items-center gap-3 whitespace-nowrap">
      <span className="text-ink-3 w-[52px] shrink-0">
        {WINDOW_KIND_LABEL[w.windowKind]}
      </span>
      <Bar pct={pct} level={level} />
      <span className={`${LEVEL_TEXT[level]} tnum w-[42px] text-right`}>
        {pct.toFixed(0)}%
      </span>
      <span className="text-ink-4 tnum">{reset ? `↻ ${reset}` : "—"}</span>
    </div>
  );
}

function ProviderBlock({ card, onSelect }: { card: CardData; onSelect: (c: CardData) => void }) {
  const worst = card.primary ? levelOf(card.primary.remainingPct) : "ok";
  return (
    <button
      onClick={() => onSelect(card)}
      className="block w-full text-left group hover:bg-ink/[0.04] px-2 py-1.5 -mx-2 rounded transition-colors"
    >
      <div className="flex items-baseline gap-2">
        <span className="text-ink-3">┌─</span>
        <span className={`${LEVEL_TEXT[worst]}`}>●</span>
        <span className="text-ink font-semibold">{card.displayName}</span>
        <span className="text-ink-4">:{card.providerType}</span>
        <span className="text-ink-4 opacity-0 group-hover:opacity-100 transition-opacity ml-1">
          ↵ inspect
        </span>
      </div>
      <div className="pl-5 mt-1 space-y-1">
        {card.windows.length ? (
          card.windows.map((w) => <WindowLine key={w.windowName} w={w} />)
        ) : (
          <div className="text-ink-4">awaiting first poll…</div>
        )}
      </div>
    </button>
  );
}

export function TerminalDashboard({
  cards,
  daemon,
  updatedAt,
  onSelect,
}: DashboardProps) {
  const atRisk = atRiskWindows(cards);
  const ago = updatedAt ? Math.max(0, Math.round((Date.now() - updatedAt) / 1000)) : null;

  return (
    <div className="min-h-screen px-4 pt-16 pb-8 md:px-8 md:pb-12 flex justify-center">
      <div className="w-full max-w-[900px]">
        {/* window chrome */}
        <div className="flex items-center gap-2 px-4 py-2.5 border border-line border-b-0 rounded-t-lg bg-paper-2">
          <span className="flex gap-1.5">
            <span className="w-3 h-3 rounded-full bg-vermillion/80" />
            <span className="w-3 h-3 rounded-full bg-ochre/80" />
            <span className="w-3 h-3 rounded-full bg-ink/50" />
          </span>
          <span className="flex-1 text-center font-mono text-[11px] text-ink-3">
            quota-watch — watch — 90×40
          </span>
          <span className="w-12" />
        </div>

        {/* terminal body */}
        <div className="relative border border-line rounded-b-lg bg-paper overflow-hidden">
          {/* CRT scanlines + glow */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 z-10 opacity-[0.35]"
            style={{
              backgroundImage:
                "repeating-linear-gradient(0deg, rgba(0,0,0,0.25) 0px, rgba(0,0,0,0.25) 1px, transparent 1px, transparent 3px)",
            }}
          />
          <div
            className="relative z-0 p-5 md:p-7 font-mono text-[13px] leading-[1.7] text-ink"
            style={{ textShadow: "0 0 6px color-mix(in srgb, var(--color-ink) 45%, transparent)" }}
          >
            {/* command line */}
            <div className="text-ink-3 mb-3">
              <span className="text-ochre">➜</span>{" "}
              <span className="text-ink">~/quota-watch</span>{" "}
              <span className="text-ink-4">git:(</span>
              <span className="text-vermillion">main</span>
              <span className="text-ink-4">)</span>{" "}
              <span className="text-ink">quota status --watch --interval 10s</span>
            </div>

            {/* status line */}
            <div className="text-ink-3 mb-1">
              <span className={daemon?.running ? "text-ink" : "text-vermillion"}>
                {daemon?.running ? "● live" : "● offline"}
              </span>
              {ago !== null && daemon?.running && <span className="text-ink-4"> · updated {ago}s ago</span>}
              <span className="text-ink-4"> · {cards.length} channels</span>
              {atRisk.length > 0 && <span className="text-vermillion"> · {atRisk.length} at risk</span>}
            </div>

            {!daemon?.running && (
              <div className="text-vermillion mb-2">
                ! daemon offline — run{" "}
                <span className="text-ink underline">quota-watch daemon start</span>
              </div>
            )}

            <div className="text-ink-4 mb-4">{"─".repeat(64)}</div>

            {/* provider blocks */}
            <div className="space-y-3">
              {cards.map((c) => (
                <ProviderBlock key={c.providerId} card={c} onSelect={onSelect} />
              ))}
            </div>

            {/* prompt + blinking cursor */}
            <div className="mt-5 text-ink-3">
              <span className="text-ochre">➜</span>{" "}
              <span className="text-ink">~/quota-watch</span>{" "}
              <span className="inline-block w-[9px] h-[16px] align-middle bg-ink [animation:qw-blink_1.1s_step-end_infinite]" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
