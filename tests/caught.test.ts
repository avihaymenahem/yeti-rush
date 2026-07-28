/**
 * Being caught by the ski patrol.
 *
 * This never happened. Not rarely - never, in any run anyone ever played, and
 * the suite was entirely happy about it. `tests/chaser.test.ts` proved the
 * patrol closes in and drops back correctly, and it does; the failure was in
 * how that interacted with something in another file entirely.
 *
 * Two windows cancelled out. A stumble puts the patrol at 15 m, which was over
 * the fatal line by a whisker - but every contact is ignored for the whole of
 * `stumble.duration` while the player picks themselves up, and the patrol spent
 * that entire window dropping back. By the time a second trip was possible it
 * was at 18.9 m and falling further away. The branch could not be reached.
 *
 * Then it took a third change to matter. With the threshold fixed and recovery
 * paused, thirty measured runs by a deliberately clumsy pilot produced no
 * catches at all: the patrol still shook a trip off in two seconds, so two
 * trips never overlapped. "Reachable" and "reached" are different claims and
 * this file makes both, because only the first one was ever in doubt.
 */

import { describe, expect, it } from 'vitest';
import { TUNING } from '@/game/config/tuning';
import { CHASER, chaserPressure, createChaserState, stepChaser } from '@/game/systems/chaser';
import { createTestRuntime, type RuntimeState } from '@/game/state/runtime';
import { CAUGHT_PRESSURE, tickRun } from '@/game/systems/simulation';
import { runAutopilot } from './support/autopilot';

const STEP = TUNING.sim.step;

/** Pressure at a given distance, without needing a state object. */
function pressureAt(distance: number): number {
  const chaser = createChaserState();
  chaser.distance = distance;
  return chaserPressure(chaser);
}

describe('the danger window is actually open', () => {
  it('leaves the patrol still lethal when the player can be hit again', () => {
    /*
     * The assertion the bug would have failed. After one trip the player is
     * immune for `stumble.duration`; the question is where the patrol is when
     * that immunity ends. If it has dropped below the fatal line by then, a
     * second trip can never kill and the patrol is decoration.
     */
    const chaser = createChaserState();
    chaser.distance = CHASER.restingDistance - CHASER.stumblePenalty;

    // Exactly what the simulation does while the player is down.
    const ticks = Math.ceil(TUNING.stumble.duration / STEP);
    for (let i = 0; i < ticks; i++) stepChaser(chaser, STEP, 1, false);

    expect(chaserPressure(chaser)).toBeGreaterThan(CAUGHT_PRESSURE);
  });

  it('closes again once the player is back on their feet', () => {
    // The counterweight. A patrol that never recovered would make every run
    // after the first trip a formality, which is the opposite bug and just as
    // invisible - the window has to shut as well as open.
    const chaser = createChaserState();
    chaser.distance = CHASER.restingDistance - CHASER.stumblePenalty;

    const ticks = Math.ceil(CHASER.stumblePenalty / CHASER.recoverRate / STEP);
    for (let i = 0; i < ticks; i++) stepChaser(chaser, STEP);

    expect(chaserPressure(chaser)).toBeLessThan(CAUGHT_PRESSURE);
  });

  it('gives seconds of grace, not frames', () => {
    /*
     * The bug's real signature was a window 90 ms wide - technically open, and
     * unreachable in practice because contacts were ignored for 700 ms of it.
     * A width assertion is what tells "open" apart from "open enough", and it
     * is the assertion that would still have failed after the threshold alone
     * was fixed.
     */
    let seconds = 0;
    const chaser = createChaserState();
    chaser.distance = CHASER.restingDistance - CHASER.stumblePenalty;

    while (chaserPressure(chaser) >= CAUGHT_PRESSURE && seconds < 20) {
      stepChaser(chaser, STEP, 1, seconds >= TUNING.stumble.duration);
      seconds += STEP;
    }

    expect(seconds).toBeGreaterThan(4);
    // And shuts again. A patrol that stayed lethal for half a minute would make
    // the first trip of a run decide it.
    expect(seconds).toBeLessThan(12);
  });

  it('does not make a single trip fatal on its own', () => {
    // Resting pressure is zero, so the first trip of a clean run must survive.
    expect(pressureAt(CHASER.restingDistance)).toBeLessThan(CAUGHT_PRESSURE);
  });
});

/*
 * And the same thing again through the real simulation, because the arithmetic
 * above is only as good as its assumption about what the tick actually does.
 */

/** A run with generation suppressed, so only staged obstacles exist. */
function stagedRun(): RuntimeState {
  const rt = createTestRuntime(1);
  rt.running = true;
  return rt;
}

function clearGenerated(rt: RuntimeState, keep: unknown): void {
  for (const obstacle of rt.track.obstacles) if (obstacle !== keep) obstacle.active = false;
  for (const rail of rt.track.rails) rail.active = false;
  for (const ramp of rt.track.ramps) ramp.active = false;
  for (const pickup of rt.track.pickups) pickup.active = false;
  for (const coin of rt.track.coins) coin.active = false;
}

/** Puts a drift - a trip, not a wall - directly in the player's path. */
function placeDrift(rt: RuntimeState) {
  const slot = rt.track.obstacles.find((obstacle) => !obstacle.active);
  if (!slot) throw new Error('no free obstacle slot');
  slot.active = true;
  slot.passed = false;
  slot.kind = 'drift';
  slot.lane = rt.lane.targetLane;
  slot.trackZ = rt.distance + 5;
  return slot;
}

/** Ticks until `done`, or gives up. Returns the seconds actually advanced. */
function advanceUntil(
  rt: RuntimeState,
  keep: unknown,
  done: () => boolean,
  limitSeconds: number,
): number {
  let seconds = 0;
  while (!done() && rt.alive && seconds < limitSeconds) {
    clearGenerated(rt, keep);
    tickRun(rt, STEP);
    seconds += STEP;
  }
  return seconds;
}

describe('two trips in quick succession', () => {
  it('ends the run', () => {
    const rt = stagedRun();

    let drift = placeDrift(rt);
    advanceUntil(rt, drift, () => rt.stumbles === 1, 2);
    expect(rt.stumbles).toBe(1);
    expect(rt.alive).toBe(true);

    // Wait out the immunity and no longer, then trip again.
    advanceUntil(rt, null, () => rt.stumbleTimer <= 0, 2);
    drift = placeDrift(rt);
    advanceUntil(rt, drift, () => !rt.alive, 2);

    expect(rt.alive).toBe(false);
    expect(rt.deathCause).toBe('caught');
  });
});

describe('while the player is down', () => {
  it('the patrol does not drop back', () => {
    /*
     * Pinned through a real tick rather than by calling `stepChaser` with the
     * flag, which proves only that the flag works. The mistake worth catching
     * is the simulation forgetting to pass it, and a test that calls the system
     * directly cannot see that - this one was written after a mutation run
     * showed exactly that gap.
     *
     * Ground made back during a stumble is spent before the player can act on
     * it: contacts are ignored for the whole recovery, so it comes off the
     * front of the danger window rather than the end.
     */
    const rt = stagedRun();

    const drift = placeDrift(rt);
    advanceUntil(rt, drift, () => rt.stumbles === 1, 2);
    expect(rt.stumbles).toBe(1);

    const held = rt.chaser.distance;
    expect(rt.stumbleTimer).toBeGreaterThan(0);

    for (let i = 0; i < 20 && rt.stumbleTimer > 0; i++) {
      clearGenerated(rt, null);
      tickRun(rt, STEP);
    }

    expect(rt.chaser.distance).toBe(held);
  });
});

describe('over real generated track', () => {
  /*
   * The staged tests prove the branch can be reached. This proves it *is*
   * reached, by a player playing the game the generator actually lays - which
   * is the claim that was false for the entire life of the project, and the one
   * a staged test would have gone on passing while it was.
   *
   * The pilot fluffs one jump in three, because a pilot that clears everything
   * never trips and so can say nothing about what tripping costs.
   */
  const SEEDS = 30;
  const results = Array.from({ length: SEEDS }, (_, i) =>
    runAutopilot(createTestRuntime(i + 1), 2000, { fluffEveryNthJump: 3 }),
  );

  it('trips a clumsy player often enough to be measuring something', () => {
    // Lowered from one per run when avalanches arrived: a trip inside one ends
    // the run outright, so a clumsy pilot now gets fewer trips in before its
    // last. That is the mechanic working, not the measurement weakening - the
    // point of the bound is only that the sample is not empty.
    const stumbles = results.reduce((sum, r) => sum + r.stumbles, 0);
    expect(stumbles).toBeGreaterThan(SEEDS / 2);
  });

  it('catches some of them', () => {
    const caught = results.filter((r) => r.deathCause === 'caught').length;
    expect(caught).toBeGreaterThan(0);
  });

  it('and does not catch all of them', () => {
    // The counterweight. A patrol that ends every clumsy run the moment it
    // trips twice is a different failure with the same shape - it would make
    // the mechanic reachable and worthless.
    const caught = results.filter((r) => r.deathCause === 'caught').length;
    expect(caught).toBeLessThan(results.length);
  });
});

describe('two trips well apart', () => {
  it('is survivable, so the patrol is a threat and not a timer', () => {
    // The counterweight to the test above, which a patrol that killed on every
    // second trip for the rest of the run would also pass.
    const rt = stagedRun();

    let drift = placeDrift(rt);
    advanceUntil(rt, drift, () => rt.stumbles === 1, 2);
    expect(rt.stumbles).toBe(1);

    // Long enough for the patrol to have dropped all the way back.
    advanceUntil(rt, null, () => rt.chaser.distance >= CHASER.restingDistance, 8);

    drift = placeDrift(rt);
    advanceUntil(rt, drift, () => rt.stumbles === 2, 2);

    expect(rt.stumbles).toBe(2);
    expect(rt.alive).toBe(true);
  });
});
