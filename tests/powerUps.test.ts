import { describe, expect, it } from 'vitest';
import {
  allowsDoubleJump,
  clearPowerUpTimers,
  coinPickupMultiplier,
  createPowerUpTimers,
  flightHeight,
  isActive,
  isInvulnerable,
  POWER_UPS,
  POWER_UP_IDS,
  powerUpDef,
  scoreMultiplier,
  phasesThroughObstacles,
  speedMultiplier,
  stepPowerUps,
  type PowerUpId,
} from '@/game/content/powerUps';

describe('definitions', () => {
  it('gives every power-up a positive duration and weight', () => {
    for (const id of POWER_UP_IDS) {
      const def = powerUpDef(id);
      expect(def.duration).toBeGreaterThan(0);
      expect(def.weight).toBeGreaterThan(0);
    }
  });

  it('keys every entry by its own id', () => {
    for (const id of POWER_UP_IDS) {
      expect(POWER_UPS[id].id).toBe(id);
    }
  });

  it('gives every power-up a distinct colour, so pickups are distinguishable', () => {
    const colors = POWER_UP_IDS.map((id) => powerUpDef(id).color);
    expect(new Set(colors).size).toBe(colors.length);
  });

  it('gives every power-up a distinct label', () => {
    const labels = POWER_UP_IDS.map((id) => powerUpDef(id).label);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe('timers', () => {
  it('starts with everything inactive', () => {
    const timers = createPowerUpTimers();
    for (const id of POWER_UP_IDS) expect(isActive(timers, id)).toBe(false);
  });

  it('counts down and expires exactly once', () => {
    const timers = createPowerUpTimers();
    timers.magnet = 0.1;
    const expired: PowerUpId[] = [];

    stepPowerUps(timers, 0.05, expired);
    expect(expired).toEqual([]);
    expect(isActive(timers, 'magnet')).toBe(true);

    stepPowerUps(timers, 0.05, expired);
    expect(expired).toEqual(['magnet']);
    expect(isActive(timers, 'magnet')).toBe(false);

    // Expiry must not fire again on subsequent ticks.
    stepPowerUps(timers, 0.05, expired);
    expect(expired).toEqual([]);
  });

  it('never leaves a negative timer', () => {
    const timers = createPowerUpTimers();
    timers.avalanche = 0.01;
    stepPowerUps(timers, 5, []);
    expect(timers.avalanche).toBe(0);
  });

  it('runs several power-ups independently', () => {
    const timers = createPowerUpTimers();
    timers.magnet = 1;
    timers.doubleScore = 3;

    stepPowerUps(timers, 1.5, []);
    expect(isActive(timers, 'magnet')).toBe(false);
    expect(isActive(timers, 'doubleScore')).toBe(true);
  });

  it('reuses the expired array rather than allocating', () => {
    const timers = createPowerUpTimers();
    const expired: PowerUpId[] = [];
    timers.magnet = 0.01;
    stepPowerUps(timers, 1, expired);
    const identity = expired;
    stepPowerUps(timers, 1, expired);
    expect(expired).toBe(identity);
  });

  it('clears everything on reset', () => {
    const timers = createPowerUpTimers();
    for (const id of POWER_UP_IDS) timers[id] = 5;
    clearPowerUpTimers(timers);
    for (const id of POWER_UP_IDS) expect(timers[id]).toBe(0);
  });
});

describe('modifier queries', () => {
  it('are all neutral with nothing active', () => {
    const timers = createPowerUpTimers();
    expect(coinPickupMultiplier(timers)).toBe(1);
    expect(isInvulnerable(timers)).toBe(false);
    expect(phasesThroughObstacles(timers)).toBe(false);
    expect(speedMultiplier(timers)).toBe(1);
    expect(scoreMultiplier(timers)).toBe(1);
    expect(allowsDoubleJump(timers)).toBe(false);
    expect(flightHeight(timers)).toBeNull();
  });

  it('widens coin pickup under the magnet', () => {
    const timers = createPowerUpTimers();
    timers.magnet = 5;
    expect(coinPickupMultiplier(timers)).toBeGreaterThan(1);
  });

  it('stacks pickup radius when magnet and chairlift overlap', () => {
    const timers = createPowerUpTimers();
    timers.magnet = 5;
    const magnetOnly = coinPickupMultiplier(timers);
    timers.chairlift = 5;
    expect(coinPickupMultiplier(timers)).toBeGreaterThan(magnetOnly);
  });

  it('makes the ghost board invulnerable, faster, and able to phase', () => {
    const timers = createPowerUpTimers();
    timers.avalanche = 5;
    expect(isInvulnerable(timers)).toBe(true);
    expect(phasesThroughObstacles(timers)).toBe(true);
    expect(speedMultiplier(timers)).toBeGreaterThan(1);
  });

  it('makes the chairlift safe without making it a phase', () => {
    const timers = createPowerUpTimers();
    timers.chairlift = 5;
    expect(isInvulnerable(timers)).toBe(true);
    // Being carried over an obstacle is not riding through one, and must not
    // pay for it - the player was never anywhere near the thing.
    expect(phasesThroughObstacles(timers)).toBe(false);
    expect(flightHeight(timers)).toBeGreaterThan(0);
  });

  it('lifts the player above the tallest obstacle while flying', () => {
    const timers = createPowerUpTimers();
    timers.chairlift = 5;
    // Must clear a chalet (4.4 tall) with room to spare, or flight is a trap.
    expect(flightHeight(timers)!).toBeGreaterThan(4.4);
  });

  it('doubles score only for double score', () => {
    const timers = createPowerUpTimers();
    timers.doubleScore = 5;
    expect(scoreMultiplier(timers)).toBe(2);

    clearPowerUpTimers(timers);
    timers.magnet = 5;
    expect(scoreMultiplier(timers)).toBe(1);
  });

  it('grants a double jump only for snow angel', () => {
    const timers = createPowerUpTimers();
    timers.snowAngel = 5;
    expect(allowsDoubleJump(timers)).toBe(true);

    clearPowerUpTimers(timers);
    timers.avalanche = 5;
    expect(allowsDoubleJump(timers)).toBe(false);
  });

  it('returns to neutral once everything expires', () => {
    const timers = createPowerUpTimers();
    for (const id of POWER_UP_IDS) timers[id] = 0.5;
    stepPowerUps(timers, 1, []);

    expect(coinPickupMultiplier(timers)).toBe(1);
    expect(isInvulnerable(timers)).toBe(false);
    expect(speedMultiplier(timers)).toBe(1);
    expect(scoreMultiplier(timers)).toBe(1);
    expect(flightHeight(timers)).toBeNull();
  });
});
