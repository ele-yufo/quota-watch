import type { StatusLevel } from "@/lib/types";

/**
 * A block of printed ink — not a UI progress bar. The consumed portion is
 * solid ink coloured by status, with a faint halftone dot screen. Colours come
 * from theme tokens (var(--color-*)) so the band recolours with the theme.
 */
const INK_VAR: Record<StatusLevel, string> = {
  ok: "var(--color-ink)",
  warn: "var(--color-ochre)",
  low: "var(--color-vermillion)",
};

interface InkBandProps {
  /** percentage already consumed (0-100) — drives how much paper is inked over */
  usedPct: number;
  level: StatusLevel;
  variant?: "hero" | "sec";
}

export function InkBand({ usedPct, level, variant = "hero" }: InkBandProps) {
  const w = Math.max(0, Math.min(100, usedPct));
  return (
    <div
      className={`w-full bg-ink/[0.05] ${variant === "hero" ? "h-[14px]" : "h-[8px]"}`}
      role="img"
      aria-label={`${w.toFixed(0)}% consumed`}
    >
      <span
        className="block h-full transition-[width] duration-500 ease-out"
        style={{
          width: `${w}%`,
          backgroundColor: INK_VAR[level],
          backgroundImage:
            "radial-gradient(rgba(245,240,232,0.10) 0.7px, transparent 0.8px)",
          backgroundSize: variant === "hero" ? "2.5px 2.5px" : "2px 2px",
        }}
      />
    </div>
  );
}
