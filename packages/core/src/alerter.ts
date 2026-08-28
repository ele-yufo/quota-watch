import type { ProviderQuota, QuotaWindow } from './types.js';
import type { QuotaDB } from './db.js';

export interface AlertNotifier {
  send(message: AlertMessage): Promise<void>;
}

export interface AlertMessage {
  provider: string;
  plan: string;
  window: QuotaWindow;
  thresholdPct: number;
  channel: string;
  remainingPct: number;
  resetAt: string | null;
  ratePerHour?: number;
  hoursRemaining?: number;
}

export class AlertEngine {
  constructor(
    private db: QuotaDB,
    private notifiers: Map<string, AlertNotifier>,
  ) {}

  /**
   * Channels that threw on a previous firing, keyed by rule id. Rule-wide
   * alert history starts the cooldown after the FIRST firing (even a partial
   * one) so healthy channels are never re-spammed; stashed channels are
   * retried on every poll until they succeed — a channel that never delivers
   * hasn't alerted anyone, so retrying it is free.
   */
  private failedChannels = new Map<string, Set<string>>();

  /** Rules currently mid-send — the cooldown check-then-record is not atomic,
   *  and overlapping timer/manual polls would otherwise both pass it. */
  private inFlight = new Set<string>();

  /**
   * Evaluate all alert rules against a fresh quota snapshot.
   * Fires notifications for rules that are triggered and not in cooldown.
   */
  async evaluate(providerId: string, quota: ProviderQuota): Promise<void> {
    const rules = this.db.getAlertRules(providerId);

    for (const rule of rules) {
      if (!rule.enabled) continue;

      const window = quota.windows.find((w) => w.name === rule.windowName);
      if (!window) continue;

      if (window.remainingPct >= rule.thresholdPct) continue;

      const pendingRetry = this.failedChannels.get(rule.id);
      if (!pendingRetry && !this.db.shouldFireAlert(rule.id, rule.cooldownMs)) continue;
      if (this.inFlight.has(rule.id)) continue;
      this.inFlight.add(rule.id);

      try {
        const message: AlertMessage = {
          provider: quota.provider,
          plan: quota.plan,
          window,
          thresholdPct: rule.thresholdPct,
          channel: '', // filled per-channel below
          remainingPct: window.remainingPct,
          resetAt: window.resetAt,
        };

        // Retry pass: only the channels that failed last time. First firing: all.
        const channelsToTry = pendingRetry
          ? rule.channels.filter((c) => pendingRetry.has(c))
          : rule.channels;

        const failed: string[] = [];
        for (const channel of channelsToTry) {
          const notifier = this.notifiers.get(channel);
          // A channel with no registered notifier is a CONFIG error, not a
          // transient failure — never stash it (it would retry forever).
          if (!notifier) continue;

          try {
            await notifier.send({ ...message, channel });
          } catch (err) {
            // One channel throwing (Discord down, webhook 5xx…) must not kill
            // the remaining channels.
            console.error(
              `[alerter] channel ${channel} failed for ${providerId}/${window.name}:`,
              err instanceof Error ? err.message : err,
            );
            failed.push(channel);
          }
        }

        if (failed.length > 0) {
          this.failedChannels.set(rule.id, new Set(failed));
        } else {
          this.failedChannels.delete(rule.id);
        }
        // Record only the FIRST firing of a rule (starts the cooldown);
        // retry passes don't touch history. Nothing recorded when no
        // registered channel exists at all.
        if (!pendingRetry && rule.channels.some((c) => this.notifiers.has(c))) {
          this.db.recordAlert(
            rule.id,
            providerId,
            window.name,
            window.remainingPct,
            JSON.stringify(message),
          );
        }
      } finally {
        this.inFlight.delete(rule.id);
      }
    }
  }
}
