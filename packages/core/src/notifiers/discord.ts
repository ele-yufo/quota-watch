import type { AlertNotifier, AlertMessage } from '../alerter.js';

const COLOR_RED = 0xff0000;
const COLOR_ORANGE = 0xff8c00;
const COLOR_YELLOW = 0xffd700;

function colorFor(remainingPct: number): number {
  if (remainingPct < 5) return COLOR_RED;
  if (remainingPct < 15) return COLOR_ORANGE;
  return COLOR_YELLOW;
}

function formatDuration(ms: number): string {
  if (ms <= 0) return '0m';
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h`;
  return `${minutes}m`;
}

/** Build the Discord webhook payload from an AlertMessage. */
export function buildDiscordPayload(message: AlertMessage): Record<string, unknown> {
  const { provider, plan, window, remainingPct, resetAt, ratePerHour, hoursRemaining } = message;

  const usedPct = (100 - remainingPct).toFixed(0) + '%';
  const remainingStr = remainingPct.toFixed(0) + '%';

  let resetStr = 'unknown';
  if (resetAt) {
    const ms = new Date(resetAt).getTime() - Date.now();
    resetStr = ms > 0 ? formatDuration(ms) : 'soon';
  }

  const fields: Array<{ name: string; value: string; inline: boolean }> = [
    { name: 'Used', value: usedPct, inline: true },
    { name: 'Remaining', value: remainingStr, inline: true },
    { name: 'Resets in', value: resetStr, inline: true },
  ];

  if (ratePerHour != null) {
    fields.push({ name: 'Rate', value: `~${ratePerHour.toFixed(0)}%/hour`, inline: true });
  }
  if (hoursRemaining != null) {
    const ms = hoursRemaining * 3_600_000;
    fields.push({ name: 'ETA', value: `~${formatDuration(ms)}`, inline: true });
  }

  return {
    embeds: [
      {
        title: `⚠️ Quota Alert: ${provider} ${plan}`,
        description: `${window.name} at ${remainingStr} remaining`,
        color: colorFor(remainingPct),
        fields,
        footer: { text: 'quota-watch' },
        timestamp: new Date().toISOString(),
      },
    ],
  };
}

export class DiscordNotifier implements AlertNotifier {
  constructor(private webhookUrl: string) {}

  async send(message: AlertMessage): Promise<void> {
    const body = buildDiscordPayload(message);
    const res = await fetch(this.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`Discord webhook failed: ${res.status} ${res.statusText}`);
    }
  }
}
