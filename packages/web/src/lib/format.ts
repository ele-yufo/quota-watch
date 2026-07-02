/**
 * Display formatting — pure functions, safe for client bundle.
 * No prediction logic lives here anymore.
 */
import type { StatusLevel } from "./types";

/** 184320 -> "184k", 1240000 -> "1.24M", 2700000000 -> "2.70B". */
export function formatCount(n: number): string {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "k";
  return String(Math.round(n));
}

const UNIT_SUFFIX: Record<string, string> = {
  tokens: "tok",
  requests: "req",
  credits: "cr",
};

/** Format a used/total pair according to unit semantics. */
export function formatUsage(
  used: number,
  total: number,
  unit: string,
): { used: string; total: string; suffix: string } {
  switch (unit) {
    case "usd":
      return { used: "$" + used.toFixed(2), total: "$" + total.toFixed(2), suffix: "" };
    case "percent":
      return { used: used.toFixed(0) + "%", total: total.toFixed(0) + "%", suffix: "" };
    case "tokens":
    case "requests":
    case "credits":
      return { used: formatCount(used), total: formatCount(total), suffix: UNIT_SUFFIX[unit] };
    default:
      return { used: formatCount(used), total: formatCount(total), suffix: unit };
  }
}

/** The hero number — shows USED (usage), not remaining:
 *  used % for ratio units, used $ for usd. Users read consumption, not leftover. */
export function headline(
  usedPct: number,
  used: number,
  unit: string,
): { value: string; sub: string } {
  if (unit === "usd") return { value: "$" + used.toFixed(2), sub: "" };
  return { value: usedPct.toFixed(0), sub: "%" };
}

/** ms -> "3d 04h" / "1h 30m" / "45m" / "<1m". */
export function formatDuration(ms: number): string {
  if (ms < 60_000) return "<1m";
  const totalMin = Math.floor(ms / 60_000);
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  if (d > 0) return `${d}d ${String(h).padStart(2, "0")}h`;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  return `${m}m`;
}

/** "3d 04h" / "now" / null if no resetAt. */
export function formatResetCountdown(resetAt: string | null): string | null {
  if (!resetAt) return null;
  const ms = new Date(resetAt).getTime() - Date.now();
  if (ms <= 0) return "now";
  return formatDuration(ms);
}

/** Status level from remaining % — drives ink colour. */
export function statusFromRemaining(remainingPct: number): StatusLevel {
  if (remainingPct < 10) return "low";
  if (remainingPct < 30) return "warn";
  return "ok";
}

/** Tailwind text-colour class per status — shared by card & drawer. */
export const INK_TEXT: Record<StatusLevel, string> = {
  ok: "text-ink",
  warn: "text-ochre",
  low: "text-vermillion",
};
