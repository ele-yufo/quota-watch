"use client";

import { useEffect, useState } from "react";
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

// ── Token ledger (absolute consumption from CLI session logs) ──────────

interface TokensApiWindow {
  windowName: string;
  windowKind: string;
  usedPct: number;
  consumedTokens: number;
  estimatedBudgetTokens: number | null;
  estimatedRemainingTokens: number | null;
  burnRatePerHour: number | null;
}
interface TokensApiProvider {
  providerId: string;
  spans: Record<string, { totalTokens: number; events: number }>;
  windows: TokensApiWindow[];
}

/** 1234567 → "1.23M" — small values get rounded too ("512.3847561/h" is not a number humans read). */
function fmtTokens(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(Math.round(n));
}

function TokenSection({ providerId }: { providerId: string }) {
  const [entry, setEntry] = useState<TokensApiProvider | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/daemon/tokens")
      .then((r) => (r.ok ? r.json() : []))
      .then((all: TokensApiProvider[]) => {
        if (cancelled) return;
        const found = all.find((p) => p.providerId === providerId);
        // hide entirely when this provider's CLI writes no usable logs
        if (found && found.windows.length > 0) setEntry(found);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [providerId]);

  if (!entry) return null;

  return (
    <section className="mb-9">
      <div className="font-mono text-[10px] tracking-[0.18em] uppercase text-ink-3 mb-4">
        token ledger
      </div>
      <div className="space-y-3">
        {entry.windows.map((w) => (
          <div key={w.windowName} className="flex items-baseline justify-between gap-3">
            <span className="font-mono text-[10px] tracking-[0.1em] uppercase text-ink-4 shrink-0">
              {w.windowName}
            </span>
            <span className="font-mono text-[12px] text-ink tnum text-right">
              {fmtTokens(w.consumedTokens)} used
              {w.estimatedRemainingTokens !== null && (
                <span className="text-ink-3"> · ≈{fmtTokens(w.estimatedRemainingTokens)} left</span>
              )}
              {w.burnRatePerHour !== null && (
                <span className="text-ink-4"> · {fmtTokens(w.burnRatePerHour)}/h</span>
              )}
            </span>
          </div>
        ))}
      </div>
      <p className="font-serif italic text-[11px] text-ink-4 mt-3">
        按会话日志统计；余量按当前用量百分比外推，是数量级估计。
      </p>
    </section>
  );
}

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
            <TokenSection providerId={card.providerId} />
          </section>

          <section>
            <AlertRuleList providerId={card.providerId} windows={card.windows} />
          </section>
        </div>
      </aside>
    </div>
  );
}
