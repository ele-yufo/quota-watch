"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CardData, DaemonStatus, QuotaApiProvider } from "@/lib/types";
import { WINDOW_KIND_ORDER } from "@/lib/types";
import { ThemeProvider } from "@/lib/theme-context";
import { Dashboard } from "@/components/dashboards/Dashboard";
import { ControlDock } from "@/components/ControlDock";
import { Drawer } from "@/components/Drawer";

// Near-realtime dashboard: the daemon polls providers every ~10-15s, the page
// re-reads the DB on the same cadence.
const REFRESH_MS = 10_000;

async function loadCards(): Promise<CardData[]> {
  const res = await fetch("/api/quota", { cache: "no-store" });
  if (!res.ok) throw new Error(`quota fetch failed: ${res.status}`);
  const list: QuotaApiProvider[] = await res.json();
  if (!Array.isArray(list)) return [];

  return list.map((p) => {
    const valid = p.windows.filter(
      (w) => typeof w.remainingPct === "number" && !isNaN(w.remainingPct),
    );
    const primary = valid.length
      ? valid.reduce((a, b) => (a.remainingPct <= b.remainingPct ? a : b))
      : null;
    const windows = [...p.windows].sort(
      (a, b) =>
        (WINDOW_KIND_ORDER[a.windowKind] ?? 5) - (WINDOW_KIND_ORDER[b.windowKind] ?? 5),
    );
    return {
      providerId: p.providerId,
      displayName: p.displayName,
      providerType: p.providerType,
      windows,
      primary,
    } satisfies CardData;
  });
}

async function loadDaemon(): Promise<DaemonStatus> {
  try {
    const res = await fetch("/api/daemon", { cache: "no-store" });
    if (!res.ok) return { running: false };
    return (await res.json()) as DaemonStatus;
  } catch {
    return { running: false };
  }
}

export default function Page() {
  const [cards, setCards] = useState<CardData[]>([]);
  const [daemon, setDaemon] = useState<DaemonStatus | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [polling, setPolling] = useState(false);
  const [selected, setSelected] = useState<CardData | null>(null);
  const running = useRef(false);

  const refresh = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    try {
      const [nextCards, nextDaemon] = await Promise.all([loadCards(), loadDaemon()]);
      setCards(nextCards);
      setDaemon(nextDaemon);
      setUpdatedAt(Date.now());
      setStatus("ready");
    } catch {
      setStatus("error");
    } finally {
      running.current = false;
    }
  }, []);

  const pollNow = useCallback(async () => {
    setPolling(true);
    try {
      await fetch("/api/daemon/poll", { method: "POST" });
    } catch {
      /* daemon down — dashboard shows the offline state; still re-read the DB */
    } finally {
      await refresh();
      setPolling(false);
    }
  }, [refresh]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(id);
  }, [refresh]);

  return (
    <ThemeProvider>
      {/* Controls live here, fixed and consistent across every theme, so they
          never move when the layout changes. */}
      <ControlDock polling={polling} onPollNow={pollNow} />

      {status === "loading" && <FullScreenNote>loading…</FullScreenNote>}
      {status === "error" && (
        <FullScreenNote>
          无法连接本地 API，确认 web 已启动。
          <button
            onClick={refresh}
            className="ml-3 underline decoration-line-soft hover:text-ink"
          >
            retry
          </button>
        </FullScreenNote>
      )}
      {status === "ready" && cards.length === 0 && <EmptyState />}
      {status === "ready" && cards.length > 0 && (
        <Dashboard
          cards={cards}
          daemon={daemon}
          updatedAt={updatedAt}
          polling={polling}
          onPollNow={pollNow}
          onSelect={setSelected}
        />
      )}

      {selected && <Drawer card={selected} onClose={() => setSelected(null)} />}
    </ThemeProvider>
  );
}

function FullScreenNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center px-8">
      <p className="font-mono text-[13px] text-ink-2 text-center">{children}</p>
    </div>
  );
}

/** First-run onboarding — theme-neutral, uses tokens so it reads in any theme. */
function EmptyState() {
  return (
    <div className="min-h-screen flex items-center justify-center px-8">
      <div className="border border-line bg-paper px-10 py-12 max-w-[600px]">
        <div className="font-mono text-[11px] tracking-[0.18em] uppercase text-ink-3 mb-2">
          first run
        </div>
        <h2 className="text-[24px] text-ink mb-8">三步开始盯配额</h2>
        <ol className="space-y-6">
          <li className="flex gap-4">
            <span className="font-mono text-[18px] text-ink-3">1</span>
            <div>
              <p className="text-[14px] text-ink mb-1">连接订阅渠道</p>
              <p className="text-[13px] text-ink-2 mb-2">
                Claude / Codex / Antigravity 自动复用本机 CLI 凭据，GLM / Kimi 填 API key。
              </p>
              <a href="/setup" className="inline-block font-mono text-[12px] text-paper bg-ink px-3 py-1.5 hover:bg-ink/80">
                打开 setup →
              </a>
            </div>
          </li>
          <li className="flex gap-4">
            <span className="font-mono text-[18px] text-ink-3">2</span>
            <div>
              <p className="text-[14px] text-ink mb-1">启动采集 daemon</p>
              <pre className="inline-block font-mono text-[12px] text-ink-2 bg-paper-2 border border-line px-3 py-1.5">
quota-watch daemon start
              </pre>
            </div>
          </li>
          <li className="flex gap-4">
            <span className="font-mono text-[18px] text-ink-3">3</span>
            <div>
              <p className="text-[14px] text-ink mb-1">回到这里</p>
              <p className="text-[13px] text-ink-2">约 10 秒后出数据。</p>
            </div>
          </li>
        </ol>
      </div>
    </div>
  );
}
