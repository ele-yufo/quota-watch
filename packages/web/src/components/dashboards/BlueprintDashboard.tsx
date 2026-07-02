"use client";

import type { CardData, LatestSnapshot } from "@/lib/types";
import { WINDOW_KIND_LABEL } from "@/lib/types";
import { formatResetCountdown } from "@/lib/format";
import { atRiskWindows, levelOf, usedPct, type DashboardProps } from "./types";

/**
 * Blueprint theme — a technical drawing sheet. Each window is a schematic gauge
 * instrument (SVG arc + tick ring), annotated with monospace callouts on the
 * blueprint grid. A title block anchors the sheet like a real drawing.
 */

const LEVEL_VAR: Record<"ok" | "warn" | "low", string> = {
  ok: "var(--color-ink)",
  warn: "var(--color-ochre)",
  low: "var(--color-vermillion)",
};

function Gauge({ w }: { w: LatestSnapshot }) {
  const pct = usedPct(w.remainingPct);
  const level = levelOf(w.remainingPct);
  const color = LEVEL_VAR[level];
  const R = 34;
  const C = 2 * Math.PI * R;
  const ticks = Array.from({ length: 24 });

  return (
    <div className="flex flex-col items-center">
      <svg width="96" height="96" viewBox="0 0 96 96" className="overflow-visible">
        {/* corner registration ticks */}
        {[[6, 6], [90, 6], [6, 90], [90, 90]].map(([x, y], i) => (
          <g key={i} stroke="var(--color-line)" strokeWidth="1">
            <line x1={x - 4} y1={y} x2={x + 4} y2={y} />
            <line x1={x} y1={y - 4} x2={x} y2={y + 4} />
          </g>
        ))}
        {/* tick ring */}
        {ticks.map((_, i) => {
          const a = (i / ticks.length) * 2 * Math.PI - Math.PI / 2;
          const major = i % 6 === 0;
          const r0 = major ? 40 : 42;
          return (
            <line
              key={i}
              x1={48 + Math.cos(a) * r0}
              y1={48 + Math.sin(a) * r0}
              x2={48 + Math.cos(a) * 45}
              y2={48 + Math.sin(a) * 45}
              stroke="var(--color-line)"
              strokeWidth={major ? 1.2 : 0.6}
            />
          );
        })}
        {/* track */}
        <circle cx="48" cy="48" r={R} fill="none" stroke="var(--color-line-soft)" strokeWidth="4" />
        {/* progress arc */}
        <circle
          cx="48" cy="48" r={R} fill="none" stroke={color} strokeWidth="4" strokeLinecap="round"
          strokeDasharray={C}
          strokeDashoffset={C * (1 - pct / 100)}
          transform="rotate(-90 48 48)"
          style={{ transition: "stroke-dashoffset 0.6s ease" }}
        />
        <text x="48" y="46" textAnchor="middle" className="font-mono" style={{ fontSize: 19, fontWeight: 700, fill: color }}>
          {pct.toFixed(0)}
        </text>
        <text x="48" y="60" textAnchor="middle" className="font-mono" style={{ fontSize: 8, letterSpacing: "0.1em", fill: "var(--color-ink-3)" }}>
          {WINDOW_KIND_LABEL[w.windowKind].toUpperCase()}
        </text>
      </svg>
      <div className="mt-1 font-mono text-[9px] tracking-[0.08em] text-ink-4">
        {formatResetCountdown(w.resetAt) ? `↻ ${formatResetCountdown(w.resetAt)}` : "— NO RESET"}
      </div>
    </div>
  );
}

function Instrument({ card, code, onSelect }: { card: CardData; code: string; onSelect: (c: CardData) => void }) {
  return (
    <button
      onClick={() => onSelect(card)}
      className="text-left border border-line hover:border-ink/50 transition-colors bg-paper/40 relative"
    >
      {/* part label */}
      <div className="flex items-baseline justify-between px-4 py-2.5 border-b border-line-soft">
        <div>
          <span className="font-mono text-[10px] text-ink-4 tracking-[0.1em]">{code}</span>
          <span className="text-[14px] text-ink font-medium ml-2">{card.displayName}</span>
        </div>
        <span className="font-mono text-[9px] tracking-[0.12em] uppercase text-ink-4">{card.providerType}</span>
      </div>
      <div className="px-4 py-5 flex items-start justify-center gap-4 flex-wrap">
        {card.windows.length ? (
          card.windows.map((w) => <Gauge key={w.windowName} w={w} />)
        ) : (
          <span className="font-mono text-[11px] text-ink-3 py-6">AWAITING DATA</span>
        )}
      </div>
    </button>
  );
}

export function BlueprintDashboard({
  cards,
  daemon,
  updatedAt,
  onSelect,
}: DashboardProps) {
  const atRisk = atRiskWindows(cards);
  const ago = updatedAt ? Math.max(0, Math.round((Date.now() - updatedAt) / 1000)) : null;

  return (
    <main className="max-w-[1160px] mx-auto px-6 pt-16 pb-8 md:px-10 md:pb-12">
      {/* title block */}
      <header className="border-2 border-ink mb-8">
        <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] divide-y md:divide-y-0 md:divide-x divide-ink">
          <div className="px-5 py-4">
            <h1 className="font-mono text-[26px] font-bold tracking-[0.02em] text-ink leading-none">
              QUOTA·WATCH
            </h1>
            <div className="mt-2 font-mono text-[10px] tracking-[0.1em] text-ink-3">
              AI SUBSCRIPTION QUOTA — INSTRUMENT SHEET
            </div>
          </div>
          <div className="px-5 py-4 font-mono text-[10px] tracking-[0.08em] text-ink-3 grid grid-cols-2 gap-x-6 gap-y-1 content-center">
            <span className="text-ink-4">STATUS</span>
            <span className={daemon?.running ? "text-ink" : "text-vermillion"}>{daemon?.running ? "LIVE" : "OFFLINE"}</span>
            <span className="text-ink-4">UPDATED</span>
            <span>{ago !== null ? `${ago}S AGO` : "—"}</span>
            <span className="text-ink-4">CHANNELS</span>
            <span>{String(cards.length).padStart(2, "0")}</span>
            <span className="text-ink-4">AT RISK</span>
            <span className={atRisk.length > 0 ? "text-vermillion" : ""}>{String(atRisk.length).padStart(2, "0")}</span>
          </div>
        </div>
        <div className="flex items-center gap-3 px-5 py-2 border-t border-ink font-mono text-[10px] tracking-[0.12em] text-ink-4">
          <span>DWG. QW-001</span>
          <span>·</span>
          <span>SCALE 1:1</span>
          <span className="ml-auto">SHEET 1 OF 1</span>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {cards.map((c, i) => (
          <Instrument key={c.providerId} card={c} code={`A${String(i + 1).padStart(2, "0")}`} onSelect={onSelect} />
        ))}
      </div>
    </main>
  );
}
