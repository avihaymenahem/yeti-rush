/**
 * Daily reward and mission-rotation rules.
 *
 * These are date-arithmetic rules, and date arithmetic is where daily rewards
 * go wrong: timezone rollovers, clock changes and leap days. Everything here is
 * a pure function over date strings so all of that is testable directly.
 */

import { describe, expect, it } from 'vitest';
import {
  canClaimDaily,
  dailyRewardFor,
  daysBetween,
  isValidDateKey,
  localDateKey,
  nextStreak,
  seedForDate,
  shouldRollMissions,
} from '@/game/systems/dailyCycle';

describe('localDateKey', () => {
  it('formats as YYYY-MM-DD', () => {
    expect(localDateKey(new Date(2026, 6, 27))).toBe('2026-07-27');
  });

  it('zero-pads single-digit months and days', () => {
    expect(localDateKey(new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  it('uses the local date, not UTC', () => {
    // Late evening local time must not roll over to tomorrow's key.
    const lateEvening = new Date(2026, 6, 27, 23, 30);
    expect(localDateKey(lateEvening)).toBe('2026-07-27');
  });

  it('handles a leap day', () => {
    expect(localDateKey(new Date(2028, 1, 29))).toBe('2028-02-29');
  });
});

describe('isValidDateKey', () => {
  it('accepts a well-formed key', () => {
    expect(isValidDateKey('2026-07-27')).toBe(true);
  });

  it('rejects anything else', () => {
    for (const bad of [null, '', 'yesterday', '2026-7-27', '26-07-27', '2026/07/27']) {
      expect(isValidDateKey(bad as string | null)).toBe(false);
    }
  });
});

describe('daysBetween', () => {
  it('counts consecutive days', () => {
    expect(daysBetween('2026-07-27', '2026-07-28')).toBe(1);
  });

  it('is zero for the same day', () => {
    expect(daysBetween('2026-07-27', '2026-07-27')).toBe(0);
  });

  it('is negative going backwards', () => {
    expect(daysBetween('2026-07-28', '2026-07-27')).toBe(-1);
  });

  it('crosses month and year boundaries', () => {
    expect(daysBetween('2026-07-31', '2026-08-01')).toBe(1);
    expect(daysBetween('2026-12-31', '2027-01-01')).toBe(1);
  });

  it('crosses a leap day correctly', () => {
    expect(daysBetween('2028-02-28', '2028-03-01')).toBe(2);
    expect(daysBetween('2027-02-28', '2027-03-01')).toBe(1);
  });

  it('returns zero rather than NaN for malformed input', () => {
    expect(daysBetween('nonsense', '2026-07-27')).toBe(0);
  });
});

describe('canClaimDaily', () => {
  it('allows the very first claim', () => {
    expect(canClaimDaily(null, '2026-07-27')).toBe(true);
  });

  it('refuses a second claim on the same day', () => {
    expect(canClaimDaily('2026-07-27', '2026-07-27')).toBe(false);
  });

  it('allows a claim the next day', () => {
    expect(canClaimDaily('2026-07-27', '2026-07-28')).toBe(true);
  });

  it('allows a claim after a gap', () => {
    expect(canClaimDaily('2026-07-20', '2026-07-27')).toBe(true);
  });

  it('refuses when the clock has been wound back', () => {
    // Stored claim is in the "future": the device clock moved backwards.
    // Re-granting here would make the reward farmable by changing the clock.
    expect(canClaimDaily('2026-07-28', '2026-07-27')).toBe(false);
    expect(canClaimDaily('2027-01-01', '2026-07-27')).toBe(false);
  });

  it('treats a corrupt stored date as never claimed', () => {
    expect(canClaimDaily('garbage', '2026-07-27')).toBe(true);
  });
});

describe('nextStreak', () => {
  it('starts at one', () => {
    expect(nextStreak(null, '2026-07-27', 0)).toBe(1);
  });

  it('increments on consecutive days', () => {
    expect(nextStreak('2026-07-26', '2026-07-27', 3)).toBe(4);
  });

  it('resets after a missed day', () => {
    expect(nextStreak('2026-07-24', '2026-07-27', 9)).toBe(1);
  });

  it('resets if the clock went backwards', () => {
    expect(nextStreak('2026-07-28', '2026-07-27', 5)).toBe(1);
  });

  it('recovers from a corrupt streak counter', () => {
    expect(nextStreak('2026-07-26', '2026-07-27', 0)).toBe(2);
    expect(nextStreak('2026-07-26', '2026-07-27', -5)).toBe(2);
  });
});

describe('dailyRewardFor', () => {
  it('grows with the streak', () => {
    expect(dailyRewardFor(2)).toBeGreaterThan(dailyRewardFor(1));
  });

  it('caps rather than growing forever', () => {
    expect(dailyRewardFor(100)).toBe(dailyRewardFor(7));
  });

  it('never returns zero or negative, whatever it is handed', () => {
    for (const streak of [0, -3, 1, 7, 1000]) {
      expect(dailyRewardFor(streak)).toBeGreaterThan(0);
    }
  });
});

describe('shouldRollMissions', () => {
  it('rolls when there is nothing stored', () => {
    expect(shouldRollMissions(null, '2026-07-27')).toBe(true);
  });

  it('does not roll twice in a day', () => {
    expect(shouldRollMissions('2026-07-27', '2026-07-27')).toBe(false);
  });

  it('rolls on a new day', () => {
    expect(shouldRollMissions('2026-07-26', '2026-07-27')).toBe(true);
  });

  it('rolls when the stored date is corrupt', () => {
    expect(shouldRollMissions('not-a-date', '2026-07-27')).toBe(true);
  });
});

describe('seedForDate', () => {
  it('is stable for the same date', () => {
    expect(seedForDate('2026-07-27')).toBe(seedForDate('2026-07-27'));
  });

  it('differs between days', () => {
    expect(seedForDate('2026-07-27')).not.toBe(seedForDate('2026-07-28'));
  });
});
