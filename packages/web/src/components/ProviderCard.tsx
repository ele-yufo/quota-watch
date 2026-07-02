import type { CardData, LatestSnapshot } from "@/lib/types";
import { InkBand } from "./InkBand";
import {
  formatResetCountdown,
  formatUsage,
  headline,
  INK_TEXT,
  statusFromRemaining,
} from "@/lib/format";

function WindowView({ snap, hero }: { snap: LatestSnapshot; hero: boolean }) {
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
        style={{ fontSize: hero ? 92 : 38, letterSpacing: "-0.04em" }}
      >
        {head.value}
        {head.sub && (
          <span
            style={{
              fontSize: hero ? 30 : 15,
              fontWeight: 400,
              verticalAlign: "super",
            }}
          >
            {head.sub}
          </span>
        )}
      </div>

      <div className={hero ? "mt-3" : "mt-2"}>
        <InkBand usedPct={usedPct} level={level} variant={hero ? "hero" : "sec"} />
      </div>

      {hero && (
        <p className="font-serif italic text-[12px] text-ink-2 mt-3">
          of {usage.total}
          {usage.suffix ? ` ${usage.suffix}` : ""} issued · used {usage.used}
          {usage.suffix ? ` ${usage.suffix}` : ""}
        </p>
      )}
    </div>
  );
}

interface ProviderCardProps {
  card: CardData;
  onOpen?: (card: CardData) => void;
}

export function ProviderCard({ card, onOpen }: ProviderCardProps) {
  const secondary = card.primary
    ? card.windows.filter((w) => w.windowName !== card.primary!.windowName)
    : [];
  const clickable = Boolean(onOpen);

  return (
    <article
      onClick={clickable ? () => onOpen!(card) : undefined}
      tabIndex={clickable ? 0 : undefined}
      className={`group relative px-6 pt-5 pb-6 bg-paper border border-line ${
        clickable
          ? "cursor-pointer transition-colors hover:bg-paper-2 focus:outline-none focus:bg-paper-2"
          : ""
      }`}
    >
      <div className="flex items-baseline justify-between mb-1">
        <span className="font-mono text-[10px] tracking-[0.18em] uppercase text-ink-3">
          {card.providerType}
        </span>
      </div>
      <h3 className="font-serif italic text-[20px] leading-tight text-ink mb-5">
        {card.displayName}
      </h3>

      {card.primary ? (
        <>
          <WindowView snap={card.primary} hero />
          {secondary.map((w) => (
            <div key={w.windowName} className="mt-5 pt-5 border-t border-line-soft">
              <WindowView snap={w} hero={false} />
            </div>
          ))}
        </>
      ) : (
        <div className="mt-2 py-8 text-center border border-dashed border-line">
          <p className="font-serif italic text-[13px] text-ink-3">等待采集</p>
          <p className="font-mono text-[10px] text-ink-4 mt-1 leading-relaxed">
            daemon 未运行或凭证无效
            <br />
            在 /setup 检查连接
          </p>
        </div>
      )}
    </article>
  );
}
