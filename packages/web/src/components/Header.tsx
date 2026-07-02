import type { CardData, DaemonStatus } from "@/lib/types";

interface HeaderProps {
  cards: CardData[];
  daemon: DaemonStatus | null;
  /** epoch ms of the last successful page refresh */
  updatedAt: number | null;
}

function ago(ts: number): string {
  const sec = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (sec < 60) return `${sec}s`;
  return `${Math.floor(sec / 60)}m`;
}

/**
 * Broadsheet masthead — title, daemon state, channel count. Controls (refresh /
 * setup / theme) live in the fixed ControlDock so they never move between themes.
 */
export function Header({ cards, daemon, updatedAt }: HeaderProps) {
  const total = cards.length;
  const atRisk = cards.filter(
    (c) => c.primary != null && c.primary.remainingPct < 10,
  ).length;

  return (
    <header className="flex items-baseline justify-between pb-3 mb-4 border-b-[3px] border-ink">
      <div className="flex items-baseline gap-4">
        <h1 className="font-serif font-semibold text-[26px] leading-none tracking-[-0.02em] text-ink">
          quota<span className="text-vermillion">·</span>watch
        </h1>
        {daemon !== null && (
          <span
            className="font-mono text-[10px] tracking-[0.12em] uppercase"
            title={daemon.running ? `daemon pid ${daemon.pid}` : "daemon not running"}
          >
            <span className={daemon.running ? "text-ink-3" : "text-vermillion"}>
              ●{" "}{daemon.running ? "live" : "offline"}
            </span>
            {updatedAt !== null && daemon.running && (
              <span className="text-ink-4"> · {ago(updatedAt)} ago</span>
            )}
          </span>
        )}
      </div>
      <div className="font-mono text-[11px] tracking-[0.14em] uppercase text-ink-2 text-right">
        {total} channel{total !== 1 ? "s" : ""}
        {atRisk > 0 && <span className="text-vermillion"> · {atRisk} at risk</span>}
      </div>
    </header>
  );
}
