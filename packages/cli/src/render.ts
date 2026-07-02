import chalk from 'chalk';

/**
 * Render a colored progress bar for quota remaining.
 * Green if > 50%, yellow if > 20%, red if <= 20%
 */
export function renderQuotaBar(remainingPct: number, width: number = 20): string {
  const clamped = Math.max(0, Math.min(100, remainingPct));
  const filled = Math.round((clamped / 100) * width);
  const empty = width - filled;

  const bar = '█'.repeat(filled) + '░'.repeat(empty);
  const pctStr = `${Math.round(clamped)}%`;

  let colored: string;
  if (clamped > 50) {
    colored = chalk.green(bar);
  } else if (clamped > 20) {
    colored = chalk.yellow(bar);
  } else {
    colored = chalk.red(bar);
  }

  return `[${colored}] ${pctStr}`;
}

/**
 * Render a pace indicator emoji.
 * 🔵 if pace < 0.3 (underusing)
 * 🟢 if 0.3-0.8 (on track)
 * 🟡 if 0.8-1.2 (tight)
 * 🔴 if > 1.2 (overusing)
 */
export function renderPace(pace: number): string {
  if (pace < 0.3) return '🔵 under';
  if (pace <= 0.8) return '🟢 on track';
  if (pace <= 1.2) return '🟡 tight';
  return '🔴 over';
}

/**
 * Render reset time as 'resets in Xh Ym' or '-'
 */
export function renderResetTime(resetAt: string | null): string {
  if (!resetAt) return '-';

  const resetMs = new Date(resetAt).getTime();
  const diffMs = resetMs - Date.now();

  if (diffMs <= 0) return 'resetting...';

  const hours = Math.floor(diffMs / 3_600_000);
  const minutes = Math.floor((diffMs % 3_600_000) / 60_000);

  if (hours > 24) {
    const days = Math.floor(hours / 24);
    const remHours = hours % 24;
    return `${days}d ${remHours}h`;
  }

  return `${hours}h ${minutes}m`;
}

/**
 * Format token counts in human-readable form.
 * 1500000 → '1.5M', 234000 → '234K', 500 → '500'
 */
export function formatTokens(n: number): string {
  if (n >= 1_000_000_000) {
    return `${(n / 1_000_000_000).toFixed(1).replace(/\.0$/, '')}B`;
  }
  if (n >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  }
  if (n >= 1_000) {
    return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  }
  return String(Math.round(n));
}
