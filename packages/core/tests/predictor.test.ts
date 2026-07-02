import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { predictConsumption } from "../src/predictor.js";
import type { UsageSnapshot } from "../src/types.js";

function makeSnapshot(overrides: Partial<UsageSnapshot> = {}): UsageSnapshot {
  return {
    timestamp: new Date().toISOString(),
    provider: "test",
    account: "main",
    windowName: "daily",
    used: 0,
    total: 100,
    unit: "requests",
    ...overrides,
  };
}

function iso(hoursFromNow: number): string {
  return new Date(Date.now() + hoursFromNow * 3_600_000).toISOString();
}

describe("predictConsumption", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-30T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── Edge cases ────────────────────────────────────────────────────

  it("returns zeros for empty snapshots", () => {
    const result = predictConsumption([], 50, 100, null);
    expect(result.ratePerHour).toBe(0);
    expect(result.exhaustionAt).toBeNull();
    expect(result.hoursRemaining).toBe(0);
    expect(result.willExhaustBeforeReset).toBe(false);
    expect(result.pace).toBe(0);
  });

  it("returns zeros for single snapshot", () => {
    const snaps = [makeSnapshot({ timestamp: "2026-06-30T10:00:00.000Z", used: 30 })];
    const result = predictConsumption(snaps, 30, 100, null);
    expect(result.ratePerHour).toBe(0);
    expect(result.hoursRemaining).toBe(0);
  });

  it("returns zeros when currentTotal is 0", () => {
    const snaps = [
      makeSnapshot({ timestamp: "2026-06-30T10:00:00.000Z", used: 10 }),
      makeSnapshot({ timestamp: "2026-06-30T11:00:00.000Z", used: 20 }),
    ];
    const result = predictConsumption(snaps, 20, 0, null);
    expect(result.ratePerHour).toBe(0);
    expect(result.hoursRemaining).toBe(0);
  });

  // ── Rate calculation ──────────────────────────────────────────────

  it("calculates rate from two snapshots 1 hour apart", () => {
    const snaps = [
      makeSnapshot({ timestamp: "2026-06-30T10:00:00.000Z", used: 30 }),
      makeSnapshot({ timestamp: "2026-06-30T11:00:00.000Z", used: 50 }),
    ];
    const result = predictConsumption(snaps, 50, 100, null);
    expect(result.ratePerHour).toBe(20); // (50-30)/1 hour
  });

  it("calculates rate from snapshots spanning multiple hours", () => {
    const snaps = [
      makeSnapshot({ timestamp: "2026-06-30T08:00:00.000Z", used: 10 }),
      makeSnapshot({ timestamp: "2026-06-30T12:00:00.000Z", used: 50 }),
    ];
    const result = predictConsumption(snaps, 50, 200, null);
    expect(result.ratePerHour).toBe(10); // (50-10)/4 hours
  });

  it("returns zero rate when all snapshots have same used value", () => {
    const snaps = [
      makeSnapshot({ timestamp: "2026-06-30T10:00:00.000Z", used: 40 }),
      makeSnapshot({ timestamp: "2026-06-30T11:00:00.000Z", used: 40 }),
      makeSnapshot({ timestamp: "2026-06-30T12:00:00.000Z", used: 40 }),
    ];
    const result = predictConsumption(snaps, 40, 100, null);
    expect(result.ratePerHour).toBe(0);
    expect(result.exhaustionAt).toBeNull();
    expect(result.hoursRemaining).toBe(Infinity);
  });

  it("treats negative rate as zero (usage decreased)", () => {
    const snaps = [
      makeSnapshot({ timestamp: "2026-06-30T10:00:00.000Z", used: 60 }),
      makeSnapshot({ timestamp: "2026-06-30T11:00:00.000Z", used: 40 }),
    ];
    const result = predictConsumption(snaps, 40, 100, null);
    expect(result.ratePerHour).toBe(0);
    expect(result.exhaustionAt).toBeNull();
    expect(result.hoursRemaining).toBe(Infinity);
  });

  // ── Exhaustion prediction ─────────────────────────────────────────

  it("predicts exhaustion time based on rate", () => {
    // Rate = 10/hour, remaining = 50, so 5 hours until exhaustion
    const snaps = [
      makeSnapshot({ timestamp: "2026-06-30T10:00:00.000Z", used: 30 }),
      makeSnapshot({ timestamp: "2026-06-30T11:00:00.000Z", used: 40 }),
    ];
    const result = predictConsumption(snaps, 50, 100, null);
    expect(result.ratePerHour).toBe(10);
    expect(result.hoursRemaining).toBe(5); // (100-50)/10

    // exhaustionAt should be ~5 hours from now (2026-06-30T12:00:00Z + 5h = 17:00)
    const expectedExhaustion = new Date("2026-06-30T17:00:00.000Z").toISOString();
    expect(result.exhaustionAt).toBe(expectedExhaustion);
  });

  it("hoursRemaining is Infinity when rate is zero", () => {
    const snaps = [
      makeSnapshot({ timestamp: "2026-06-30T10:00:00.000Z", used: 50 }),
      makeSnapshot({ timestamp: "2026-06-30T11:00:00.000Z", used: 50 }),
    ];
    const result = predictConsumption(snaps, 50, 100, null);
    expect(result.hoursRemaining).toBe(Infinity);
    expect(result.exhaustionAt).toBeNull();
  });

  // ── willExhaustBeforeReset ────────────────────────────────────────

  it("willExhaustBeforeReset = true when exhaustion is before reset", () => {
    // Rate = 20/hour, remaining = 40 → 2 hours until exhaustion
    const snaps = [
      makeSnapshot({ timestamp: "2026-06-30T10:00:00.000Z", used: 30 }),
      makeSnapshot({ timestamp: "2026-06-30T11:00:00.000Z", used: 50 }),
    ];
    // Reset is 10 hours from now — exhaustion is ~2 hours from now
    const resetAt = iso(10);
    const result = predictConsumption(snaps, 60, 100, resetAt);
    expect(result.willExhaustBeforeReset).toBe(true);
  });

  it("willExhaustBeforeReset = false when exhaustion is after reset", () => {
    // Rate = 5/hour, remaining = 80 → 16 hours until exhaustion
    const snaps = [
      makeSnapshot({ timestamp: "2026-06-30T10:00:00.000Z", used: 10 }),
      makeSnapshot({ timestamp: "2026-06-30T11:00:00.000Z", used: 15 }),
    ];
    // Reset is 2 hours from now — exhaustion is ~16 hours
    const resetAt = iso(2);
    const result = predictConsumption(snaps, 20, 100, resetAt);
    expect(result.willExhaustBeforeReset).toBe(false);
  });

  it("willExhaustBeforeReset = false when rate is zero", () => {
    const snaps = [
      makeSnapshot({ timestamp: "2026-06-30T10:00:00.000Z", used: 50 }),
      makeSnapshot({ timestamp: "2026-06-30T11:00:00.000Z", used: 50 }),
    ];
    const result = predictConsumption(snaps, 50, 100, iso(5));
    expect(result.willExhaustBeforeReset).toBe(false);
  });

  it("willExhaustBeforeReset = false when no resetAt", () => {
    const snaps = [
      makeSnapshot({ timestamp: "2026-06-30T10:00:00.000Z", used: 30 }),
      makeSnapshot({ timestamp: "2026-06-30T11:00:00.000Z", used: 50 }),
    ];
    const result = predictConsumption(snaps, 80, 100, null);
    expect(result.willExhaustBeforeReset).toBe(false);
  });

  // ── Pace ──────────────────────────────────────────────────────────

  it("pace > 1 when overusing (consuming faster than elapsed fraction)", () => {
    // Window started at 08:00, resets at 20:00 (12h window)
    // Current time is 12:00 → 4h elapsed out of 12h → 33% elapsed
    // But 70% consumed → pace = 0.70 / 0.33 ≈ 2.1
    const snaps = [
      makeSnapshot({ timestamp: "2026-06-30T08:00:00.000Z", used: 0 }),
      makeSnapshot({ timestamp: "2026-06-30T11:00:00.000Z", used: 60 }),
    ];
    const resetAt = "2026-06-30T20:00:00.000Z"; // 8 hours from now
    const result = predictConsumption(snaps, 70, 100, resetAt);
    expect(result.pace).toBeGreaterThan(1);
  });

  it("pace < 1 when underusing", () => {
    // Window started at 08:00, resets at 20:00 (12h window)
    // Current time is 12:00 → 4h elapsed → 33% elapsed
    // Only 10% consumed → pace = 0.10 / 0.33 ≈ 0.3
    const snaps = [
      makeSnapshot({ timestamp: "2026-06-30T08:00:00.000Z", used: 0 }),
      makeSnapshot({ timestamp: "2026-06-30T11:00:00.000Z", used: 5 }),
    ];
    const resetAt = "2026-06-30T20:00:00.000Z";
    const result = predictConsumption(snaps, 10, 100, resetAt);
    expect(result.pace).toBeLessThan(1);
  });

  it("pace is 0 when no resetAt", () => {
    const snaps = [
      makeSnapshot({ timestamp: "2026-06-30T10:00:00.000Z", used: 10 }),
      makeSnapshot({ timestamp: "2026-06-30T11:00:00.000Z", used: 50 }),
    ];
    const result = predictConsumption(snaps, 50, 100, null);
    expect(result.pace).toBe(0);
  });

  // ── Multiple snapshots ────────────────────────────────────────────

  it("uses earliest and latest snapshots for rate (ignores middle)", () => {
    const snaps = [
      makeSnapshot({ timestamp: "2026-06-30T08:00:00.000Z", used: 10 }),
      makeSnapshot({ timestamp: "2026-06-30T10:00:00.000Z", used: 40 }), // spike
      makeSnapshot({ timestamp: "2026-06-30T12:00:00.000Z", used: 50 }),
    ];
    const result = predictConsumption(snaps, 50, 200, null);
    // Rate = (50 - 10) / 4h = 10/hour
    expect(result.ratePerHour).toBe(10);
  });

  // ── Realistic scenario ────────────────────────────────────────────

  it("realistic daily quota scenario", () => {
    // API provider: 1000 requests/day quota
    // Window started ~6h ago, usage at 600, reset in 18h
    const snaps = [
      makeSnapshot({ timestamp: "2026-06-30T06:00:00.000Z", used: 100, total: 1000 }),
      makeSnapshot({ timestamp: "2026-06-30T09:00:00.000Z", used: 300, total: 1000 }),
      makeSnapshot({ timestamp: "2026-06-30T12:00:00.000Z", used: 600, total: 1000 }),
    ];
    const resetAt = "2026-07-01T06:00:00.000Z"; // 18 hours from now
    const result = predictConsumption(snaps, 600, 1000, resetAt);

    // Rate = (600 - 100) / 6h ≈ 83.33/hr
    expect(result.ratePerHour).toBeCloseTo(83.33, 1);
    // Hours remaining = 400 / 83.33 ≈ 4.8h
    expect(result.hoursRemaining).toBeCloseTo(4.8, 0);
    // Will exhaust before reset (4.8h < 18h)
    expect(result.willExhaustBeforeReset).toBe(true);
    // pace: 60% consumed / (6h/24h window) = 60% / 25% = 2.4
    expect(result.pace).toBeGreaterThan(1);
  });
});
