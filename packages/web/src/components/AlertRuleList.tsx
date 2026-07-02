"use client";

import { useCallback, useEffect, useState } from "react";
import type { LatestSnapshot } from "@/lib/types";

interface AlertRule {
  id: string;
  windowName: string;
  thresholdPct: number;
  channels: string[];
  enabled: boolean;
}

interface Props {
  providerId: string;
  windows: LatestSnapshot[];
}

export function AlertRuleList({ providerId, windows }: Props) {
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [newWindow, setNewWindow] = useState(windows[0]?.windowName ?? "");
  const [threshold, setThreshold] = useState(20);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(
        `/api/alert?provider=${encodeURIComponent(providerId)}`,
        { cache: "no-store" },
      );
      if (r.ok) setRules(await r.json());
    } catch {
      setError("加载告警规则失败");
    }
    setLoading(false);
  }, [providerId]);

  useEffect(() => {
    load();
  }, [load]);

  // Reset the selected window when the provider (and thus its windows) changes,
  // otherwise the dropdown keeps a stale windowName from the previous provider.
  useEffect(() => {
    setNewWindow(windows[0]?.windowName ?? "");
  }, [windows]);

  async function addRule() {
    setSaving(true);
    setError(null);
    try {
      const r = await fetch(`/api/alert`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: crypto.randomUUID(),
          provider: providerId,
          windowName: newWindow,
          thresholdPct: threshold,
          channels: ["macos_notification"],
        }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        setError(body.error ?? "创建失败");
      } else {
        await load();
      }
    } catch {
      setError("创建失败");
    }
    setSaving(false);
  }

  async function deleteRule(id: string) {
    setRules((rs) => rs.filter((r) => r.id !== id));
    await fetch(`/api/alert?id=${encodeURIComponent(id)}`, { method: "DELETE" });
  }

  return (
    <div>
      <div className="font-mono text-[10px] tracking-[0.18em] uppercase text-ink-3 mb-4">
        alert rules
      </div>

      {loading && (
        <div className="font-serif italic text-[13px] text-ink-3">loading…</div>
      )}

      {!loading && rules.length === 0 && (
        <div className="font-serif italic text-[13px] text-ink-3 mb-4">
          暂无规则。剩余% 跌破阈值时通知。
        </div>
      )}

      <div className="space-y-2 mb-5">
        {rules.map((r) => (
          <div
            key={r.id}
            className="flex items-center gap-3 border border-line bg-paper px-3 py-2"
          >
            <span className="font-serif italic text-[13px] text-ink flex-1 truncate">
              {r.windowName}
            </span>
            <span className="font-mono text-[11px] tnum text-ochre">
              &lt;{r.thresholdPct}%
            </span>
            <span className="font-mono text-[10px] text-ink-4">
              {r.channels.join(",")}
            </span>
            <button
              onClick={() => deleteRule(r.id)}
              className="font-mono text-ink-3 hover:text-vermillion text-base leading-none"
              aria-label="delete rule"
            >
              ×
            </button>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 border border-line bg-paper px-3 py-2">
        <select
          value={newWindow}
          onChange={(e) => setNewWindow(e.target.value)}
          className="bg-transparent font-mono text-[12px] text-ink outline-none flex-1"
        >
          {windows.map((w) => (
            <option key={w.windowName} value={w.windowName} className="bg-paper">
              {w.windowName}
            </option>
          ))}
        </select>
        <input
          type="number"
          min={1}
          max={100}
          value={threshold}
          onChange={(e) => setThreshold(Number(e.target.value))}
          className="w-14 bg-transparent font-mono text-[12px] text-ink tnum outline-none text-right"
        />
        <span className="font-mono text-[11px] text-ink-3">%</span>
        <button
          onClick={addRule}
          disabled={saving || !newWindow}
          className="font-mono text-[11px] text-vermillion border border-vermillion/40 px-2 py-0.5 hover:bg-vermillion/10 disabled:opacity-40"
        >
          {saving ? "…" : "add"}
        </button>
      </div>
      {error && (
        <div className="font-serif italic text-[12px] text-vermillion mt-2">
          {error}
        </div>
      )}
    </div>
  );
}
