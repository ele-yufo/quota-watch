"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CardData, DaemonStatus, QuotaApiProvider } from "@/lib/types";
import { WINDOW_KIND_ORDER } from "@/lib/types";
import { MagazineDashboard } from "@/components/dashboards/MagazineDashboard";
import { ControlDock } from "@/components/ControlDock";
import { Drawer } from "@/components/Drawer";

// Near-realtime dashboard: the page re-reads the DB every 10s, and every 60s
// it also forces a provider poll round — otherwise an idle/backed-off daemon
// can leave the numbers frozen for minutes and the page looks dead even
// though it re-renders.
const REFRESH_MS = 10_000;
const FORCE_POLL_MS = 60_000;
// A hung GET must never wedge refresh() past its `running` guard — that would
// silently kill the interval, the button and the visibility refresh at once.
const FETCH_TIMEOUT_MS = 15_000;

function fetchCapped(input: string, init?: RequestInit): Promise<Response> {
  // Caller-provided signal wins (the poll POST uses a 35s cap — spreading
  // init after the default would silently downgrade it to 15s).
  return fetch(input, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), ...init });
}

async function loadCards(): Promise<CardData[]> {
  const res = await fetchCapped("/api/quota", { cache: "no-store" });
  // 401 = session dead (or a pre-auth stale bundle still running). Navigate —
  // keeping the last good cards here would freeze a days-old screen forever.
  if (res.status === 401) {
    window.location.href = "/login";
    throw new Error("unauthorized — redirecting to login");
  }
  if (!res.ok) throw new Error(`quota fetch failed: ${res.status}`);
  const list: QuotaApiProvider[] = await res.json();
  if (!Array.isArray(list)) return [];

  // Disabled channels (toggled off in /setup) are neither polled nor shown.
  return list.filter((p) => p.enabled).map((p) => {
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
      enabled: p.enabled,
      windows,
      primary,
      poll: p.poll ?? null,
    } satisfies CardData;
  });
}

async function loadDaemon(): Promise<DaemonStatus> {
  try {
    const res = await fetchCapped("/api/daemon", { cache: "no-store" });
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
  const [pollFailed, setPollFailed] = useState(false);
  const running = useRef(false);
  const rerunQueued = useRef(false);
  const refreshRef = useRef<(() => Promise<void>) | undefined>(undefined);

  const refresh = useCallback(async () => {
    if (running.current) {
      // A poll (or another caller) is mid-refresh holding pre-poll data —
      // queue one trailing refresh so this round ends on fresh numbers
      // instead of silently no-oping.
      rerunQueued.current = true;
      return;
    }
    running.current = true;
    try {
      const [nextCards, nextDaemon] = await Promise.all([loadCards(), loadDaemon()]);
      setCards(nextCards);
      setDaemon(nextDaemon);
      setUpdatedAt(Date.now());
      setStatus("ready");
    } catch {
      // A transient fetch failure must not wipe an already-rendered dashboard
      // with a full-screen error — keep the last good cards. Only the
      // never-loaded state gets the error screen.
      setStatus((s) => (s === "loading" ? "error" : s));
    } finally {
      running.current = false;
      if (rerunQueued.current) {
        rerunQueued.current = false;
        void refreshRef.current?.();
      }
    }
  }, []);

  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  const pollNow = useCallback(
    async (silent = false) => {
      if (!silent) setPolling(true);
      try {
        // The server allows 30s for a full fan-out (slow upstreams) — a 15s
        // client abort would flag "failed" a poll that's still running.
        const res = await fetchCapped("/api/daemon/poll", {
          method: "POST",
          signal: AbortSignal.timeout(35_000),
        });
        setPollFailed(!res.ok);
      } catch {
        // daemon down — dashboard shows the offline state; still re-read the DB
        setPollFailed(true);
      } finally {
        await refresh();
        if (!silent) setPolling(false);
      }
    },
    [refresh],
  );

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, REFRESH_MS);
    // Periodic full refresh: force the daemon to poll providers, then re-read.
    // Skipped while the tab is hidden (background timers are throttled anyway,
    // and polling into a hidden tab is wasted provider traffic).
    const forceId = setInterval(() => {
      if (!document.hidden) void pollNow(true);
    }, FORCE_POLL_MS);
    // Returning to the tab (phone especially) should show fresh data at once.
    const onVisible = () => {
      if (!document.hidden) void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      clearInterval(forceId);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh, pollNow]);

  // The drawer's provider disappeared from the latest data (removed in setup,
  // or its rows pruned) — close it instead of showing the frozen snapshot.
  useEffect(() => {
    if (selected && status === "ready" && !cards.some((c) => c.providerId === selected.providerId)) {
      setSelected(null);
    }
  }, [cards, selected, status]);

  return (
    <>
      <ControlDock polling={polling} pollFailed={pollFailed} onPollNow={pollNow} />

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
        <MagazineDashboard
          cards={cards}
          daemon={daemon}
          updatedAt={updatedAt}
          polling={polling}
          onPollNow={pollNow}
          onSelect={setSelected}
        />
      )}

      {selected && (
        // Re-resolve against the latest cards every refresh — rendering the
        // frozen click-time snapshot shows stale numbers as live in the drawer.
        <Drawer
          card={cards.find((c) => c.providerId === selected.providerId) ?? selected}
          onClose={() => setSelected(null)}
        />
      )}
    </>
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
