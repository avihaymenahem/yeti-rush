/**
 * The avalanche.
 *
 * Fifteen seconds where the rules change. The design constraint is what most of
 * this file is about: the *track* must not change at all. A scripted stretch
 * that also generated its own layout would need its own proof that the layout
 * is survivable, and there is no version of that proof safer than reusing the
 * one the spawner already carries.
 *
 * So the escalation lives entirely in the consequence of a mistake, and these
 * tests exist to keep it there.
 */

import { describe, expect, it } from 'vitest';
import { TUNING } from '@/game/config/tuning';
import { CHASER, chaserPressure } from '@/game/systems/chaser';
import { createTestRuntime, type RuntimeState } from '@/game/state/runtime';
import { CAUGHT_PRESSURE, tickRun } from '@/game/systems/simulation';
import { speedAt } from '@/game/systems/difficulty';

const STEP = TUNING.sim.step;

/**
 * Runs until `done` or the limit, returning seconds advanced.
 *
 * The player is held untouchable throughout. The first avalanche is seven
 * hundred metres in and nothing here is steering, so an honest run dies in the
 * first chunk and never reaches the thing being tested. Reviving the grace
 * timer each tick is the smallest lever that gets a real generated run that far
 * without touching what the generator lays.
 */
function advance(rt: RuntimeState, done: () => boolean, limitSeconds: number): number {
  let seconds = 0;
  while (!done() && rt.alive && seconds < limitSeconds) {
    rt.graceTimer = 1;
    tickRun(rt, STEP);
    seconds += STEP;
  }
  return seconds;
}

function liveRun(seed = 1): RuntimeState {
  const rt = createTestRuntime(seed);
  rt.running = true;
  return rt;
}

describe('when one arrives', () => {
  it('starts at the scheduled distance and not before', () => {
    const rt = liveRun();
    advance(rt, () => rt.distance >= TUNING.avalanche.firstAt - 40, 120);
    expect(rt.avalancheTimer).toBe(0);

    advance(rt, () => rt.avalancheTimer > 0, 20);
    expect(rt.avalancheTimer).toBeGreaterThan(0);
    expect(rt.distance).toBeGreaterThanOrEqual(TUNING.avalanche.firstAt);
  });

  it('makes any trip fatal while it lasts', () => {
    /*
     * The entire mechanic, and the only thing it actually changes. The patrol
     * is held at its closest, which is above the pressure at which a stumble
     * catches the player - so for the duration, the trip that normally costs a
     * combo ends the run.
     */
    const rt = liveRun();
    advance(rt, () => rt.avalancheTimer > 0, 120);
    expect(rt.avalancheTimer).toBeGreaterThan(0);

    expect(rt.chaser.distance).toBe(CHASER.minDistance);
    expect(chaserPressure(rt.chaser)).toBeGreaterThan(CAUGHT_PRESSURE);
  });

  it('holds the patrol there rather than nudging it once', () => {
    // `stepChaser` would otherwise start walking it back on the very next tick,
    // and the threat would evaporate a second into the fifteen.
    const rt = liveRun();
    advance(rt, () => rt.avalancheTimer > 0, 120);

    for (let i = 0; i < 120; i++) {
      rt.graceTimer = 1;
      tickRun(rt, STEP);
    }
    expect(rt.avalancheTimer).toBeGreaterThan(0);
    expect(rt.chaser.distance).toBe(CHASER.minDistance);
  });

  it('speeds the run up', () => {
    const rt = liveRun();
    advance(rt, () => rt.avalancheTimer > 0, 120);
    expect(rt.avalancheTimer).toBeGreaterThan(0);

    // Compared against the curve at the same moment, so this is the boost and
    // not simply the run having got faster on its own.
    expect(rt.speed).toBeGreaterThan(speedAt(rt.elapsed) * rt.board.speed);
  });
});

describe('when it passes', () => {
  it('lets the patrol go and pays for the nerve', () => {
    const rt = liveRun();
    advance(rt, () => rt.avalancheTimer > 0, 120);
    const scoreDuring = rt.score;

    advance(rt, () => rt.avalancheTimer === 0, TUNING.avalanche.duration + 5);

    expect(rt.avalanchesSurvived).toBe(1);
    expect(rt.chaser.distance).toBe(CHASER.restingDistance);
    expect(rt.score).toBeGreaterThan(scoreDuring);
  });

  it('does not last for ever', () => {
    // The counterweight to every "it is dangerous" assertion above, all of
    // which a permanent avalanche would satisfy while ending the game.
    const rt = liveRun();
    advance(rt, () => rt.avalancheTimer > 0, 120);
    const elapsedAtStart = rt.elapsed;

    advance(rt, () => rt.avalancheTimer === 0, TUNING.avalanche.duration + 5);
    expect(rt.elapsed - elapsedAtStart).toBeLessThan(TUNING.avalanche.duration + 1);
  });

  it('schedules the next one further down the mountain', () => {
    const rt = liveRun();
    advance(rt, () => rt.avalancheTimer > 0, 120);
    expect(rt.nextAvalancheAt).toBeGreaterThan(rt.distance);
    expect(rt.nextAvalancheAt - rt.distance).toBeGreaterThan(TUNING.avalanche.interval / 2);
  });
});

describe('the track it runs over', () => {
  it('is the same track it would have been', () => {
    /*
     * The load-bearing assertion of the whole feature. Two runs from the same
     * seed, one with avalanches scheduled and one without, must lay *identical*
     * obstacles - because the avalanche is allowed to change what a mistake
     * costs and nothing else. The moment it touches generation, every guarantee
     * in `solvability.ts` and `spawner.ts` would need re-proving under it.
     *
     * Speed differs between the two, which is why this compares the track's own
     * coordinates rather than what was on screen at a given moment.
     */
    const withOne = liveRun(7);
    const without = liveRun(7);
    without.nextAvalancheAt = Number.MAX_SAFE_INTEGER;

    const layout = (rt: RuntimeState, metres: number) => {
      const seen = new Set<string>();
      while (rt.alive && rt.distance < metres) {
        for (const obstacle of rt.track.obstacles) {
          if (obstacle.active) seen.add(`${obstacle.kind}:${obstacle.lane}:${obstacle.trackZ.toFixed(2)}`);
        }
        // Nothing may end either run early, or they stop being comparable.
        rt.graceTimer = 1;
        tickRun(rt, STEP);
      }
      return [...seen].sort();
    };

    const target = TUNING.avalanche.firstAt + TUNING.avalanche.duration * TUNING.speed.max;
    expect(layout(withOne, target)).toEqual(layout(without, target));
    expect(withOne.avalanchesSurvived + (withOne.avalancheTimer > 0 ? 1 : 0)).toBeGreaterThan(0);
  });
});
