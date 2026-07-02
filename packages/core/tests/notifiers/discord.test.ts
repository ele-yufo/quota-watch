import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DiscordNotifier, buildDiscordPayload } from '../../src/notifiers/discord.js';
import type { AlertMessage } from '../../src/alerter.js';
import type { QuotaWindow } from '../../src/types.js';

function makeWindow(overrides: Partial<QuotaWindow> = {}): QuotaWindow {
  return {
    name: 'session (5h)',
    used: 880,
    total: 1000,
    unit: 'tokens',
    remaining: 120,
    remainingPct: 12,
    resetAt: new Date(Date.now() + 8_100_000).toISOString(), // +2h15m
    unlimited: false,
    ...overrides,
  };
}

function makeMessage(overrides: Partial<AlertMessage> = {}): AlertMessage {
  return {
    provider: 'openai',
    plan: 'pro',
    window: makeWindow(),
    thresholdPct: 30,
    channel: 'discord_webhook',
    remainingPct: 12,
    resetAt: new Date(Date.now() + 8_100_000).toISOString(),
    ...overrides,
  };
}

describe('buildDiscordPayload', () => {
  it('builds correct embed structure', () => {
    const msg = makeMessage();
    const payload = buildDiscordPayload(msg) as { embeds: Array<Record<string, unknown>> };

    expect(payload.embeds).toHaveLength(1);
    const embed = payload.embeds[0];
    expect(embed.title).toBe('⚠️ Quota Alert: openai pro');
    expect(embed.description).toContain('session (5h)');
    expect(embed.description).toContain('12% remaining');
    expect(embed.footer).toEqual({ text: 'quota-watch' });
    expect(embed.timestamp).toBeTruthy();
  });

  it('uses orange color when remainingPct < 15', () => {
    const msg = makeMessage({ remainingPct: 12 });
    const payload = buildDiscordPayload(msg) as { embeds: Array<{ color: number }> };
    expect(payload.embeds[0].color).toBe(0xff8c00); // orange
  });

  it('uses red color when remainingPct < 5', () => {
    const msg = makeMessage({ remainingPct: 3 });
    const payload = buildDiscordPayload(msg) as { embeds: Array<{ color: number }> };
    expect(payload.embeds[0].color).toBe(0xff0000); // red
  });

  it('uses yellow color when remainingPct >= 15', () => {
    const msg = makeMessage({ remainingPct: 20 });
    const payload = buildDiscordPayload(msg) as { embeds: Array<{ color: number }> };
    expect(payload.embeds[0].color).toBe(0xffd700); // yellow
  });

  it('includes rate and ETA fields when provided', () => {
    const msg = makeMessage({ ratePerHour: 18, hoursRemaining: 0.7 });
    const payload = buildDiscordPayload(msg) as { embeds: Array<{ fields: Array<{ name: string }> }> };
    const fieldNames = payload.embeds[0].fields.map((f) => f.name);
    expect(fieldNames).toContain('Rate');
    expect(fieldNames).toContain('ETA');
  });

  it('omits rate and ETA fields when not provided', () => {
    const msg = makeMessage();
    const payload = buildDiscordPayload(msg) as { embeds: Array<{ fields: Array<{ name: string }> }> };
    const fieldNames = payload.embeds[0].fields.map((f) => f.name);
    expect(fieldNames).not.toContain('Rate');
    expect(fieldNames).not.toContain('ETA');
  });

  it('shows "unknown" for resets when resetAt is null', () => {
    const msg = makeMessage({ resetAt: null });
    const payload = buildDiscordPayload(msg) as { embeds: Array<{ fields: Array<{ name: string; value: string }> }> };
    const resetsField = payload.embeds[0].fields.find((f) => f.name === 'Resets in');
    expect(resetsField?.value).toBe('unknown');
  });
});

describe('DiscordNotifier', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }));
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('POSTs payload to webhook URL', async () => {
    const notifier = new DiscordNotifier('https://discord.com/api/webhooks/123/abc');
    const msg = makeMessage();
    await notifier.send(msg);

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, opts] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://discord.com/api/webhooks/123/abc');
    expect(opts.method).toBe('POST');
    expect((opts.headers as Record<string, string>)['Content-Type']).toBe('application/json');

    const body = JSON.parse(opts.body as string);
    expect(body.embeds).toHaveLength(1);
    expect(body.embeds[0].title).toContain('openai pro');
  });

  it('throws on non-OK response', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('rate limited', { status: 429 }));
    const notifier = new DiscordNotifier('https://discord.com/api/webhooks/123/abc');
    await expect(notifier.send(makeMessage())).rejects.toThrow('Discord webhook failed: 429');
  });
});
