"use client";

import { Header } from "@/components/Header";
import { ProviderRow } from "@/components/ProviderRow";
import { AlertBar } from "@/components/AlertBar";
import type { DashboardProps } from "./types";

/**
 * Magazine theme — the original editorial broadsheet: a masthead, a ruled list
 * of provider rows with ink bands, and a bottom at-risk strip. Text-forward.
 */
export function MagazineDashboard({
  cards,
  daemon,
  updatedAt,
  onSelect,
}: DashboardProps) {
  const hasSnapshots = cards.some((c) => c.windows.length > 0);

  return (
    <main className="max-w-[1100px] mx-auto px-8 pt-16 pb-16">
      <Header cards={cards} daemon={daemon} updatedAt={updatedAt} />

      {daemon !== null && !daemon.running && cards.length > 0 && (
        <div className="border border-vermillion/50 bg-paper px-5 py-3 mb-4 flex items-baseline justify-between gap-4 flex-wrap">
          <div>
            <span className="font-mono text-[10px] tracking-[0.16em] uppercase text-vermillion mr-3">
              daemon offline
            </span>
            <span className="font-serif italic text-[13px] text-ink-2">
              数据不再更新 — 在终端启动采集进程：
            </span>
          </div>
          <code className="font-mono text-[12px] text-ink bg-paper-2 border border-line px-2 py-0.5">
            quota-watch daemon start
          </code>
        </div>
      )}

      <section aria-label="providers" className="border-t border-b border-line bg-paper">
        {cards.map((c) => (
          <ProviderRow key={c.providerId} card={c} onOpen={onSelect} />
        ))}
      </section>

      {cards.length > 0 && !hasSnapshots && daemon?.running && (
        <p className="font-serif italic text-[13px] text-ink-3 text-center mt-6">
          daemon 已运行，等待第一轮采集（约 10 秒）…
        </p>
      )}

      <AlertBar cards={cards} onOpen={onSelect} />
    </main>
  );
}
