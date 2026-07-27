/**
 * Game modes.
 *
 * Modes are rules layered on one simulation, so what matters is that each rule
 * actually reaches the sim, and that no mode's settings put it outside what the
 * track generator has been validated against.
 */

import { describe, expect, it } from 'vitest';
import { TUNING, type LaneIndex } from '@/game/config/tuning';
import {
  DEFAULT_MODE,
  GAME_MODES,
  GAME_MODE_IDS,
  gameModeDef,
  seedForMode,
  type GameModeId,
} from '@/game/content/modes';
import type { ObstacleKind } from '@/game/content/obstacles';
import { createTestRuntime, type RuntimeState } from '@/game/state/runtime';
import { speedAt } from '@/game/systems/difficulty';
import { tickRun } from '@/game/systems/simulation';

const STEP = TUNING.sim.step;

function controlledRuntime(modeId: GameModeId): RuntimeState {
  const rt = createTestRuntime(1);
  const mode = gameModeDef(modeId);

  rt.mode = mode;
  rt.timeRemaining = mode.timeLimit;
  rt.elapsed = mode.startElapsed;
  rt.running = true;

  for (const obstacle of rt.track.obstacles) obstacle.active = false;
  for (const coin of rt.track.coins) coin.active = false;
  rt.track.nextChunkStart = Number.MAX_SAFE_INTEGER;
  return rt;
}

function placeObstacle(rt: RuntimeState, kind: ObstacleKind, lane: LaneIndex, trackZ: number) {
  const entity = rt.track.obstacles.find((o) => !o.active)!;
  entity.active = true;
  entity.kind = kind;
  entity.lane = lane;
  entity.trackZ = trackZ;
  entity.passed = false;
  return entity;
}

function run(rt: RuntimeState, seconds: number): void {
  const ticks = Math.round(seconds / STEP);
  for (let i = 0; i < ticks; i++) tickRun(rt, STEP);
}

describe('definitions', () => {
  it('keys every entry by its own id', () => {
    for (const id of GAME_MODE_IDS) expect(GAME_MODES[id].id).toBe(id);
  });

  it('includes the default', () => {
    expect(GAME_MODE_IDS).toContain(DEFAULT_MODE);
  });

  it('gives every mode a name and an explanation', () => {
    for (const id of GAME_MODE_IDS) {
      const def = gameModeDef(id);
      expect(def.name.length).toBeGreaterThan(2);
      expect(def.description.length).toBeGreaterThan(15);
    }
  });

  it('never scores a mode below the default', () => {
    for (const id of GAME_MODE_IDS) {
      expect(gameModeDef(id).scoreMultiplier).toBeGreaterThanOrEqual(1);
    }
  });

  it('rewards the harder modes more', () => {
    // Blizzard removes the stumble safety net entirely; it has to be worth it.
    expect(GAME_MODES.blizzard.scoreMultiplier).toBeGreaterThan(
      GAME_MODES.endless.scoreMultiplier,
    );
  });

  it('never starts a mode past the top of the speed curve', () => {
    // Beyond the ramp the curve is flat, so a larger value would be a lie
    // about how the mode behaves rather than an actual difficulty increase.
    for (const id of GAME_MODE_IDS) {
      const def = gameModeDef(id);
      expect(def.startElapsed).toBeGreaterThanOrEqual(0);
      expect(speedAt(def.startElapsed)).toBeLessThanOrEqual(TUNING.speed.max + 1e-9);
    }
  });

  it('falls back to the default for an unknown id', () => {
    expect(gameModeDef('nonsense').id).toBe(DEFAULT_MODE);
  });
});

describe('seeding', () => {
  it('gives a date-seeded mode the same track all day', () => {
    const daily = gameModeDef('daily');
    const a = seedForMode(daily, '2026-07-27', () => 1);
    const b = seedForMode(daily, '2026-07-27', () => 2);
    expect(a).toBe(b);
  });

  it('gives a date-seeded mode a different track the next day', () => {
    const daily = gameModeDef('daily');
    expect(seedForMode(daily, '2026-07-27', () => 1)).not.toBe(
      seedForMode(daily, '2026-07-28', () => 1),
    );
  });

  it('gives different date-seeded modes different tracks on the same day', () => {
    // Keyed by mode as well as date, or two daily modes would share a slope.
    const a = seedForMode({ ...gameModeDef('daily'), id: 'daily' }, '2026-07-27', () => 1);
    const b = seedForMode(
      { ...gameModeDef('daily'), id: 'endless' as GameModeId },
      '2026-07-27',
      () => 1,
    );
    expect(a).not.toBe(b);
  });

  it('uses the random seed for every other mode', () => {
    expect(seedForMode(gameModeDef('endless'), '2026-07-27', () => 4242)).toBe(4242);
  });
});

describe('rules in play', () => {
  it('starts a high-startElapsed mode near top speed immediately', () => {
    const blizzard = controlledRuntime('blizzard');
    run(blizzard, STEP);
    expect(blizzard.speed).toBeGreaterThan(TUNING.speed.max * 0.95);

    const endless = controlledRuntime('endless');
    run(endless, STEP);
    expect(endless.speed).toBeLessThan(blizzard.speed);
  });

  it('ends a timed run when the clock runs out', () => {
    const rt = controlledRuntime('timeAttack');
    expect(rt.timeRemaining).toBe(gameModeDef('timeAttack').timeLimit);

    run(rt, gameModeDef('timeAttack').timeLimit! + 0.2);

    expect(rt.alive).toBe(false);
    expect(rt.deathCause).toBe('timeUp');
    expect(rt.timeRemaining).toBe(0);
  });

  it('keeps a timed run going right up to the limit', () => {
    const rt = controlledRuntime('timeAttack');
    run(rt, gameModeDef('timeAttack').timeLimit! - 1);
    expect(rt.alive).toBe(true);
  });

  it('never ends an untimed run on the clock', () => {
    const rt = controlledRuntime('endless');
    expect(rt.timeRemaining).toBeNull();
    run(rt, 200);
    expect(rt.alive).toBe(true);
  });

  it('makes a trip fatal where the mode says so', () => {
    const rt = controlledRuntime('blizzard');
    placeObstacle(rt, 'drift', 1, rt.distance + 40);

    for (let i = 0; i < 4000 && rt.alive; i++) tickRun(rt, STEP);

    expect(rt.alive).toBe(false);
    expect(rt.deathCause).toBe('obstacle');
    expect(rt.stumbles).toBe(0);
  });

  it('lets the same trip be survived where it does not', () => {
    const rt = controlledRuntime('endless');
    placeObstacle(rt, 'drift', 1, rt.distance + 40);

    for (let i = 0; i < 4000 && rt.alive && rt.stumbles === 0; i++) tickRun(rt, STEP);

    expect(rt.alive).toBe(true);
    expect(rt.stumbles).toBe(1);
  });

  it('applies the mode multiplier to the score', () => {
    const endless = controlledRuntime('endless');
    const daily = controlledRuntime('daily');
    // Same starting point on the curve, so only the multiplier differs.
    daily.elapsed = endless.elapsed;

    run(endless, 2);
    run(daily, 2);

    expect(daily.score).toBeGreaterThan(endless.score);
  });
});
