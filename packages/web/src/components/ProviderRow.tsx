"use client";

import type { CardData, LatestSnapshot } from "@/lib/types";
import { windowKindLabel } from "@/lib/types";
import { InkBand } from "./InkBand";
import {
  formatResetCountdown,
  INK_TEXT,
  statusFromRemaining,
} from "@/lib/format";

/**
 * One compact row per provider in the broadsheet list view.
 *
 * Layout (horizontal):
 *   [provider name + plan]  [session]  [week]  [month]  [reset countdown]
 *
 * - window order is FIXED by kind (session → day → week → month), sorted
 *   upstream in loadCards; up to 3 windows render inline (OpenCode Go's
 *   5h/7d/1mo all visible at once), extras remain in the Drawer.
 * - the 3 window columns are always reserved so numbers align vertically
 *   across providers even when a provider has fewer windows.
 * - shows USED % (consumption), not remaining.
 * - clicking the row opens the Drawer (detail view untouched).
 */

const INLINE_WINDOWS = 3;

/** Compact inline window cell: kind chip + used% + small ink band + reset. */
function WindowCell({ snap }: { snap: LatestSnapshot }) {
  const usedPct = 100 - snap.remainingPct;
  const level = statusFromRemaining(snap.remainingPct);
  const reset = formatResetCountdown(snap.resetAt);

  return (
    <div className="min-w-0 flex-1">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-mono text-[9px] tracking-[0.16em] uppercase text-ink-3 truncate">
          <span className="text-ink-2">{windowKindLabel(snap.windowKind)}</span>
          {" · "}
          {snap.windowName}
        </span>
        <span className="font-mono text-[9px] tracking-[0.08em] text-ink-4 whitespace-nowrap">
          {reset ? `↻ ${reset}` : ""}
        </span>
      </div>
      <div className="flex items-baseline gap-1.5 mt-0.5">
        <span
          className={`font-serif font-semibold tnum leading-none text-[20px] sm:text-[24px] ${INK_TEXT[level]}`}
          style={{ letterSpacing: "-0.03em" }}
        >
          {usedPct.toFixed(0)}
        </span>
        <span
          className={`font-serif leading-none ${INK_TEXT[level]}`}
          style={{ fontSize: 12 }}
        >
          %
        </span>
        <span className="font-mono text-[9px] tracking-[0.1em] uppercase text-ink-4 ml-0.5">
          used
        </span>
      </div>
      <div className="mt-1.5">
        <InkBand usedPct={usedPct} level={level} variant="sec" />
      </div>
    </div>
  );
}

interface ProviderRowProps {
  card: CardData;
  onOpen?: (card: CardData) => void;
}

export function ProviderRow({ card, onOpen }: ProviderRowProps) {
  const clickable = Boolean(onOpen);
  // kind-sorted upstream; render up to 3 inline, pad so columns stay aligned
  const inline = card.windows.slice(0, INLINE_WINDOWS);
  const padding = Array.from({ length: INLINE_WINDOWS - inline.length });

  return (
    <article
      onClick={clickable ? () => onOpen!(card) : undefined}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onOpen!(card);
              }
            }
          : undefined
      }
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      className={`group relative grid grid-cols-1 gap-3 px-4 py-4 sm:grid-cols-[minmax(130px,180px)_1fr_1fr_1fr_auto] sm:items-center sm:gap-5 sm:px-5 bg-paper border-t border-line-soft ${
        clickable
          ? "cursor-pointer transition-colors hover:bg-paper-2 focus:outline-none focus:bg-paper-2"
          : ""
      }`}
    >
      {/* Provider nameplate + plan type */}
      <div className="min-w-0">
        <div className="font-mono text-[9px] tracking-[0.18em] uppercase text-ink-3 truncate">
          {card.providerType}
        </div>
        <h3 className="font-serif italic text-[17px] leading-tight text-ink truncate">
          {card.displayName}
        </h3>
      </div>

      {/* Windows: session → week → month, columns aligned across rows.
          On narrow screens the cells form their own 2-col grid instead of
          squeezing into 30px columns that overlap. */}
      {card.primary ? (
        <div className="grid grid-cols-2 gap-3 sm:contents">
          {inline.map((w) => (
            <WindowCell key={w.windowName} snap={w} />
          ))}
          {padding.map((_, i) => (
            <div key={`pad-${i}`} aria-hidden className="hidden sm:block" />
          ))}
        </div>
      ) : (
        <div className="sm:col-span-3 py-2 text-left sm:text-center">
          <p className="font-serif italic text-[12px] text-ink-3">等待采集</p>
          <p className="font-mono text-[9px] text-ink-4 mt-0.5">该渠道暂无采集数据</p>
        </div>
      )}

      {/* Reset countdown for the most-at-risk window + open affordance */}
      {card.primary ? (
        <div className="flex items-baseline gap-3 sm:block sm:text-right whitespace-nowrap">
          <div className="font-mono text-[9px] tracking-[0.14em] uppercase text-ink-3">
            reset
          </div>
          <div className="font-mono text-[11px] tracking-[0.06em] text-ink-2 tnum">
            {formatResetCountdown(card.primary.resetAt) ?? "—"}
          </div>
          <div className="font-mono text-[9px] tracking-[0.12em] uppercase text-ink-4 sm:mt-0.5 group-hover:text-ink-2">
            details →
          </div>
        </div>
      ) : (
        <div />
      )}
    </article>
  );
}
