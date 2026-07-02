import type { UsageSnapshot, Prediction } from './types.js';

const MILLISECONDS_PER_HOUR = 3_600_000;

/**
 * Given historical snapshots for ONE provider+window, predict exhaustion.
 * @param snapshots - sorted by timestamp ascending, all same provider+window
 * @param currentUsed - current used value
 * @param currentTotal - current total value
 * @param resetAt - ISO string of next reset, or null
 */
export function predictConsumption(
  snapshots: UsageSnapshot[],
  currentUsed: number,
  currentTotal: number,
  resetAt: string | null
): Prediction {
  const zero: Prediction = {
    ratePerHour: 0,
    exhaustionAt: null,
    hoursRemaining: 0,
    willExhaustBeforeReset: false,
    pace: 0,
  };

  // Edge: not enough data or zero total
  if (snapshots.length < 2 || currentTotal === 0) {
    return zero;
  }

  const earliest = snapshots[0];
  const latest = snapshots[snapshots.length - 1];

  const earliestTime = new Date(earliest.timestamp).getTime();
  const latestTime = new Date(latest.timestamp).getTime();
  const hoursBetween = (latestTime - earliestTime) / MILLISECONDS_PER_HOUR;

  // Guard against zero-duration span
  if (hoursBetween <= 0) {
    return zero;
  }

  let ratePerHour = (latest.used - earliest.used) / hoursBetween;

  // Negative rate (usage decreased) — treat as zero
  if (ratePerHour < 0) {
    ratePerHour = 0;
  }

  const remaining = currentTotal - currentUsed;

  let hoursRemaining: number;
  let exhaustionAt: string | null;

  if (ratePerHour <= 0) {
    hoursRemaining = Number.POSITIVE_INFINITY;
    exhaustionAt = null;
  } else {
    hoursRemaining = remaining / ratePerHour;
    exhaustionAt = new Date(Date.now() + hoursRemaining * MILLISECONDS_PER_HOUR).toISOString();
  }

  // willExhaustBeforeReset
  let willExhaustBeforeReset = false;
  if (resetAt && exhaustionAt) {
    willExhaustBeforeReset = new Date(exhaustionAt).getTime() < new Date(resetAt).getTime();
  }

  // pace: (% consumed) / (% elapsed since window start)
  // Window start estimated from earliest snapshot
  let pace = 0;
  if (resetAt) {
    const resetTime = new Date(resetAt).getTime();
    const now = Date.now();
    const windowDuration = resetTime - earliestTime;
    if (windowDuration > 0) {
      const fractionElapsed = (now - earliestTime) / windowDuration;
      const fractionConsumed = currentUsed / currentTotal;
      if (fractionElapsed > 0) {
        pace = fractionConsumed / fractionElapsed;
      }
    }
  }

  return {
    ratePerHour,
    exhaustionAt,
    hoursRemaining,
    willExhaustBeforeReset,
    pace,
  };
}
