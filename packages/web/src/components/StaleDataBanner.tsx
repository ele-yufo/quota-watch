"use client";

import type { CardData, DaemonStatus } from "@/lib/types";

interface Props {
  cards: CardData[];
  daemon: DaemonStatus | null;
  onOpen: (card: CardData) => void;
}

function ageOf(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "";
  const min = Math.round(ms / 60000);
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

/**
 * Stale-data banner — the honest counterpart to change-only snapshots.
 * When a provider's last poll failed (or the daemon is down), its windows
 * keep showing the last good numbers; without this strip those stale numbers
 * are indistinguishable from live data. Rendered by page.tsx so every theme
 * gets it.
 */
export function StaleDataBanner({ cards, daemon, onOpen }: Props) {
  const daemonDown = daemon != null && daemon.running === false;
  // Poll cadence is 15–60s; past 10min an "ok" timestamp is a hung scheduler,
  // not freshness. poll===null with windows = snapshots predate poll tracking.
  const STALE_OK_MS = 10 * 60_000;
  const stale = cards.filter((c) => {
    if (!c.enabled) return false; // disabled channels are not polled
    if (c.poll == null) return c.windows.length > 0;
    if (c.poll.lastStatus !== "ok") return true;
    const age = Date.now() - new Date(c.poll.lastPollAt).getTime();
    return Number.isFinite(age) && age > STALE_OK_MS;
  });
  if (!daemonDown && stale.length === 0) return null;

  return (
    <div className="fixed top-3 left-3 z-40 max-w-[min(92vw,480px)] border border-vermillion/60 bg-paper/95 backdrop-blur-md px-3 py-2 shadow-lg shadow-black/5">
      <div className="font-mono text-[10px] tracking-[0.14em] uppercase text-vermillion mb-1">
        数据不是最新
      </div>
      {daemonDown && (
        <p className="font-serif italic text-[12px] text-ink-2 leading-snug">
          daemon 未运行——所有渠道显示的都是历史快照。终端执行 quota-watch daemon start。
        </p>
      )}
      <div className="flex flex-col gap-1">
        {stale.map((c) => (
          <button
            key={c.providerId}
            onClick={() => onOpen(c)}
            className="text-left font-mono text-[11px] text-ink-2 hover:text-ink leading-snug"
          >
            <span className="text-vermillion">✕</span> {c.displayName}
            {c.poll?.lastPollAt && ageOf(c.poll.lastPollAt) ? ` · ${ageOf(c.poll.lastPollAt)}前` : ""}：{c.poll?.lastError ?? (c.poll ? "轮询停滞" : "从未成功轮询")}
            <span className="text-ink-4">（数字是旧快照）</span>
          </button>
        ))}
      </div>
    </div>
  );
}
