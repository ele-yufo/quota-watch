import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AlertEngine } from '../src/alerter.js';
import type { AlertMessage, AlertNotifier } from '../src/alerter.js';
import type { QuotaDB } from '../src/db.js';
import type { ProviderQuota, AlertRule, QuotaWindow } from '../src/types.js';

function mockDb(overrides: Partial<QuotaDB> = {}): QuotaDB {
  return {
    getAlertRules: vi.fn().mockReturnValue([]),
    shouldFireAlert: vi.fn().mockReturnValue(true),
    recordAlert: vi.fn(),
    ...overrides,
  } as unknown as QuotaDB;
}

function makeWindow(overrides: Partial<QuotaWindow> = {}): QuotaWindow {
  return {
    name: 'session (5h)',
    used: 800,
    total: 1000,
    unit: 'tokens',
    remaining: 200,
    remainingPct: 20,
    resetAt: null,
    unlimited: false,
    ...overrides,
  };
}

function makeQuota(overrides: Partial<ProviderQuota> = {}): ProviderQuota {
  return {
    provider: 'openai',
    account: 'default',
    plan: 'pro',
    status: 'ok',
    windows: [makeWindow()],
    fetchedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeRule(overrides: Partial<AlertRule> = {}): AlertRule {
  return {
    id: 'rule-1',
    provider: 'openai',
    windowName: 'session (5h)',
    thresholdPct: 30,
    channels: ['discord_webhook'],
    cooldownMs: 3_600_000,
    enabled: true,
    ...overrides,
  };
}

describe('AlertEngine', () => {
  let notifier: AlertNotifier;
  let sendSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sendSpy = vi.fn().mockResolvedValue(undefined);
    notifier = { send: sendSpy };
  });

  it('fires notification when remaining% < threshold and not in cooldown', async () => {
    const rule = makeRule({ thresholdPct: 30 });
    // remainingPct=20 < thresholdPct=30 → should fire
    const db = mockDb({
      getAlertRules: vi.fn().mockReturnValue([rule]),
      shouldFireAlert: vi.fn().mockReturnValue(true),
    });
    const engine = new AlertEngine(db, new Map([['discord_webhook', notifier]]));
    const quota = makeQuota({ windows: [makeWindow({ remainingPct: 20 })] });

    await engine.evaluate('openai', quota);

    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(sendSpy).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'openai',
      plan: 'pro',
      remainingPct: 20,
      thresholdPct: 30,
      channel: 'discord_webhook',
    }));
    expect(db.recordAlert).toHaveBeenCalledOnce();
  });

  it('skips when remaining% >= threshold', async () => {
    const rule = makeRule({ thresholdPct: 10 });
    const db = mockDb({
      getAlertRules: vi.fn().mockReturnValue([rule]),
    });
    const engine = new AlertEngine(db, new Map([['discord_webhook', notifier]]));
    const quota = makeQuota({ windows: [makeWindow({ remainingPct: 20 })] });

    await engine.evaluate('openai', quota);

    expect(sendSpy).not.toHaveBeenCalled();
    expect(db.recordAlert).not.toHaveBeenCalled();
  });

  it('skips when in cooldown', async () => {
    const rule = makeRule({ thresholdPct: 30 });
    const db = mockDb({
      getAlertRules: vi.fn().mockReturnValue([rule]),
      shouldFireAlert: vi.fn().mockReturnValue(false),
    });
    const engine = new AlertEngine(db, new Map([['discord_webhook', notifier]]));
    const quota = makeQuota({ windows: [makeWindow({ remainingPct: 20 })] });

    await engine.evaluate('openai', quota);

    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('skips disabled rules', async () => {
    const rule = makeRule({ enabled: false, thresholdPct: 30 });
    const db = mockDb({
      getAlertRules: vi.fn().mockReturnValue([rule]),
    });
    const engine = new AlertEngine(db, new Map([['discord_webhook', notifier]]));
    const quota = makeQuota({ windows: [makeWindow({ remainingPct: 20 })] });

    await engine.evaluate('openai', quota);

    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('skips when no matching window found', async () => {
    const rule = makeRule({ windowName: 'weekly (7d)' });
    const db = mockDb({
      getAlertRules: vi.fn().mockReturnValue([rule]),
    });
    const engine = new AlertEngine(db, new Map([['discord_webhook', notifier]]));
    const quota = makeQuota({ windows: [makeWindow({ name: 'session (5h)' })] });

    await engine.evaluate('openai', quota);

    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('fires to multiple channels', async () => {
    const notifier2Send = vi.fn().mockResolvedValue(undefined);
    const notifier2: AlertNotifier = { send: notifier2Send };
    const rule = makeRule({ channels: ['discord_webhook', 'macos_notification'] });
    const db = mockDb({
      getAlertRules: vi.fn().mockReturnValue([rule]),
    });
    const engine = new AlertEngine(
      db,
      new Map<string, AlertNotifier>([
        ['discord_webhook', notifier],
        ['macos_notification', notifier2],
      ]),
    );
    const quota = makeQuota({ windows: [makeWindow({ remainingPct: 10 })] });

    await engine.evaluate('openai', quota);

    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(notifier2Send).toHaveBeenCalledTimes(1);
    expect(db.recordAlert).toHaveBeenCalledTimes(2);
  });

  it('skips unknown notifier channels gracefully', async () => {
    const rule = makeRule({ channels: ['unknown_channel'] as unknown as typeof rule.channels });
    const db = mockDb({
      getAlertRules: vi.fn().mockReturnValue([rule]),
    });
    const engine = new AlertEngine(db, new Map([['discord_webhook', notifier]]));
    const quota = makeQuota({ windows: [makeWindow({ remainingPct: 10 })] });

    await engine.evaluate('openai', quota);

    expect(sendSpy).not.toHaveBeenCalled();
    expect(db.recordAlert).not.toHaveBeenCalled();
  });
});
