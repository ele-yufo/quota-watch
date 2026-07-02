import type { ProviderQuota, AlertRule, QuotaWindow } from './types.js';
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

      if (!this.db.shouldFireAlert(rule.id, rule.cooldownMs)) continue;

      const message: AlertMessage = {
        provider: quota.provider,
        plan: quota.plan,
        window,
        thresholdPct: rule.thresholdPct,
        channel: '', // filled per-channel below
        remainingPct: window.remainingPct,
        resetAt: window.resetAt,
      };

      for (const channel of rule.channels) {
        const notifier = this.notifiers.get(channel);
        if (!notifier) continue;

        const msgForChannel: AlertMessage = { ...message, channel };
        await notifier.send(msgForChannel);
        this.db.recordAlert(
          rule.id,
          providerId,
          window.name,
          window.remainingPct,
          JSON.stringify(msgForChannel),
        );
      }
    }
  }
}
