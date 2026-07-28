/**
 * Local-day bookkeeping for daily missions and the login reward.
 *
 * Pure functions over date strings so every rule is testable without mocking
 * clocks. The caller supplies "today"; nothing here reads the system time.
 *
 * Days are keyed on the player's *local* date, not UTC. A daily reward that
 * flips at 3am local time because the server thinks in UTC is a support ticket.
 */

/** `YYYY-MM-DD` in the given date's local timezone. */
export function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isValidDateKey(key: string | null): key is string {
  return typeof key === 'string' && DATE_PATTERN.test(key);
}

/** Whole days from `from` to `to`; negative if `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  if (!isValidDateKey(from) || !isValidDateKey(to)) return 0;
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

/**
 * Whether the daily reward is available.
 *
 * Guards against a clock set backwards: a stored claim date in the future means
 * the device clock moved, and re-granting on every rollback would make the
 * reward farmable. Waiting it out is the conservative choice.
 */
export function canClaimDaily(lastClaim: string | null, today: string): boolean {
  if (!isValidDateKey(lastClaim)) return true;
  return daysBetween(lastClaim, today) > 0;
}

/**
 * The streak after claiming today. Consecutive days build it up; any gap
 * restarts at one.
 */
export function nextStreak(lastClaim: string | null, today: string, currentStreak: number): number {
  if (!isValidDateKey(lastClaim)) return 1;
  return daysBetween(lastClaim, today) === 1 ? Math.max(1, currentStreak) + 1 : 1;
}

/** Coins awarded for a login streak, escalating then flattening out. */
export function dailyRewardFor(streak: number): number {
  const clamped = Math.max(1, Math.min(7, Math.floor(streak)));
  return clamped * 90;
}

/** Whether the mission set needs re-rolling for a new day. */
export function shouldRollMissions(rolledOn: string | null, today: string): boolean {
  return !isValidDateKey(rolledOn) || rolledOn !== today;
}

/** A stable numeric seed for a date, so a day's missions are reproducible. */
export function seedForDate(key: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash | 0;
}
