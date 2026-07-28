/**
 * Power-up definitions.
 *
 * Pure data plus small pure-ish effect hooks. Adding a sixth power-up should be
 * an entry in this table and nothing else - no engine changes, no new branches
 * in the simulation. Everything the simulation needs to know is expressed as
 * one of the modifier queries at the bottom of this file.
 */

export type PowerUpId = 'magnet' | 'avalanche' | 'chairlift' | 'snowAngel' | 'doubleScore';

export interface PowerUpDef {
  id: PowerUpId;
  label: string;
  /** Base duration in seconds, before shop upgrades. */
  duration: number;
  color: string;
  /** Relative likelihood of this one being the pickup that spawns. */
  weight: number;
}

export const POWER_UPS = {
  /** Hot cocoa: coins are drawn in from much further away. */
  magnet: {
    id: 'magnet',
    label: 'Hot Cocoa',
    duration: 8,
    color: '#8b5a2b',
    weight: 10,
  },

  /**
   * Avalanche board: invincible, faster, and obstacles are smashed through
   * rather than dodged. The power fantasy one.
   */
  avalanche: {
    id: 'avalanche',
    label: 'Avalanche Board',
    duration: 6,
    color: '#5ec8f2',
    weight: 6,
  },

  /** Chairlift: lifted clear above the track, hoovering up a coin line. */
  chairlift: {
    id: 'chairlift',
    label: 'Chairlift',
    duration: 6,
    color: '#f0b429',
    weight: 5,
  },

  /** Snow angel: a second jump while already airborne. */
  snowAngel: {
    id: 'snowAngel',
    label: 'Snow Angel',
    duration: 12,
    color: '#d7b3ff',
    weight: 8,
  },

  /** Doubles the score multiplier for its duration. */
  doubleScore: {
    id: 'doubleScore',
    label: 'Double Score',
    duration: 10,
    color: '#5be584',
    weight: 8,
  },
} as const satisfies Record<PowerUpId, PowerUpDef>;

export const POWER_UP_IDS = Object.keys(POWER_UPS) as PowerUpId[];

export function powerUpDef(id: PowerUpId): PowerUpDef {
  return POWER_UPS[id];
}

// --- Shop upgrades ----------------------------------------------------------

export const UPGRADE_MAX_LEVEL = 3;

/** Coin cost to go from `level` to `level + 1`. */
export function upgradePrice(level: number): number {
  const prices = [800, 2200, 5000];
  return prices[Math.max(0, Math.min(prices.length - 1, level))] as number;
}

/** Effective duration of a power-up at an upgrade level. */
export function upgradedDuration(id: PowerUpId, level: number): number {
  const clamped = Math.max(0, Math.min(UPGRADE_MAX_LEVEL, Math.floor(level)));
  // +30% per level: noticeable without making the top level trivialise the run.
  return powerUpDef(id).duration * (1 + 0.3 * clamped);
}

/** Every power-up's duration at the player's current upgrade levels. */
export function durationsFor(upgrades: Readonly<Record<string, number>>): Record<PowerUpId, number> {
  const durations = {} as Record<PowerUpId, number>;
  for (const id of POWER_UP_IDS) durations[id] = upgradedDuration(id, upgrades[id] ?? 0);
  return durations;
}

/** Remaining seconds per power-up. Zero means inactive. */
export type PowerUpTimers = Record<PowerUpId, number>;

export function createPowerUpTimers(): PowerUpTimers {
  return { magnet: 0, avalanche: 0, chairlift: 0, snowAngel: 0, doubleScore: 0 };
}

export function clearPowerUpTimers(timers: PowerUpTimers): void {
  for (const id of POWER_UP_IDS) timers[id] = 0;
}

export function isActive(timers: PowerUpTimers, id: PowerUpId): boolean {
  return timers[id] > 0;
}

/** Ticks every timer down. Returns the ids that expired on this tick. */
export function stepPowerUps(timers: PowerUpTimers, dt: number, expired: PowerUpId[]): void {
  expired.length = 0;
  for (const id of POWER_UP_IDS) {
    if (timers[id] <= 0) continue;
    timers[id] -= dt;
    if (timers[id] <= 0) {
      timers[id] = 0;
      expired.push(id);
    }
  }
}

// --- Modifier queries -------------------------------------------------------
// The simulation asks these rather than testing for specific power-ups, so a
// new power-up that shares an effect needs no change at the call site.

/** How much the coin pickup radius is multiplied by. */
export function coinPickupMultiplier(timers: PowerUpTimers): number {
  let multiplier = 1;
  if (isActive(timers, 'magnet')) multiplier *= 6;
  // Riding the lift, coins are swept in along the whole line.
  if (isActive(timers, 'chairlift')) multiplier *= 4;
  return multiplier;
}

/** True when obstacles cannot kill the player. */
export function isInvulnerable(timers: PowerUpTimers): boolean {
  return isActive(timers, 'avalanche') || isActive(timers, 'chairlift');
}

/** True when the player smashes obstacles instead of passing through them. */
export function smashesObstacles(timers: PowerUpTimers): boolean {
  return isActive(timers, 'avalanche');
}

/** World speed multiplier. */
export function speedMultiplier(timers: PowerUpTimers): number {
  return isActive(timers, 'avalanche') ? 1.35 : 1;
}

/** Extra score multiplier stacked on top of the combo multiplier. */
export function scoreMultiplier(timers: PowerUpTimers): number {
  return isActive(timers, 'doubleScore') ? 2 : 1;
}

/** True when the player may jump again in mid-air. */
export function allowsDoubleJump(timers: PowerUpTimers): boolean {
  return isActive(timers, 'snowAngel');
}

/** Height the player is held at while flying, or null when not flying. */
export function flightHeight(timers: PowerUpTimers): number | null {
  return isActive(timers, 'chairlift') ? 5 : null;
}
