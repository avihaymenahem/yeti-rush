/**
 * Reaction pacing.
 *
 * `solvability.test.ts` proves a track *can* be got through. This proves a human
 * can get through it, which is a different and much stricter claim: the
 * solvability check models a player who already knows what is coming and inputs
 * it frame-perfectly, with no allowance for seeing the obstacle, choosing a lane
 * and moving a thumb.
 *
 * Before this existed, half of all required actions at top speed arrived within
 * 0.35 s of the previous one, median 0.33 s - faster than simple visual reaction
 * time, let alone a choice between three lanes. The track was provably solvable
 * and completely unplayable, and nothing in the suite could tell the difference.
 */

import { describe, expect, it } from 'vitest';
import { TUNING } from '@/game/config/tuning';
import { CHUNKS, decisionRows, minRowGap } from '@/game/content/chunks';
import { obstacleDef } from '@/game/content/obstacles';
import { worstCaseSpeed } from '@/game/content/skins';
import { createRng } from '@/game/core/rng';
import { createTestRuntime } from '@/game/state/runtime';
import { tickRun } from '@/game/systems/simulation';
import { buildRows, checkSolvable } from '@/game/systems/solvability';
import {
  createSpawner,
  REACTION_SECONDS,
  resetSpawner,
  updateSpawner,
} from '@/game/systems/spawner';

/** Lays a long stretch of track and returns everything still active. */
function generate(seed: number, speed: number, tier = 3) {
  const rng = createRng(seed);
  const state = createSpawner();
  resetSpawner(state);
  for (let distance = 0; distance < 3000; distance += 20) {
    updateSpawner(state, distance, tier, rng, speed);
  }

  return state.obstacles
    .filter((obstacle) => obstacle.active)
    .map((obstacle) => ({
      lane: obstacle.lane,
      z: obstacle.trackZ,
      action: obstacleDef(obstacle.kind).action,
    }));
}

/** Seconds between consecutive decision rows, at the given speed. */
function rowGapSeconds(seed: number, speed: number): number[] {
  const rows = buildRows(generate(seed, speed)).sort((a, b) => a.z - b.z);
  const gaps: number[] = [];
  for (let i = 1; i < rows.length; i++) {
    gaps.push(((rows[i] as { z: number }).z - (rows[i - 1] as { z: number }).z) / speed);
  }
  return gaps;
}

describe('reaction budget', () => {
  it('allows more time than a human needs to simply see something', () => {
    // Simple visual reaction is around 0.25 s, and choosing between three lanes
    // is slower still. Anything at or under that is a coin flip, not difficulty.
    expect(REACTION_SECONDS).toBeGreaterThan(0.25);
  });

  it('is a real constraint at top speed, not a formality', () => {
    // If the budget were smaller than the tightest chunk in the library it
    // would never reject anything and this whole file would pass vacuously.
    const tightest = Math.min(
      ...CHUNKS.filter((chunk) => decisionRows(chunk).length > 1).map(minRowGap),
    );
    expect(tightest).toBeLessThan(REACTION_SECONDS * worstCaseSpeed(TUNING.speed.max));
  });
});

describe('generated track pacing', () => {
  const speeds = [
    ['start', worstCaseSpeed(TUNING.speed.start)],
    ['mid', worstCaseSpeed((TUNING.speed.start + TUNING.speed.max) / 2)],
    ['top', worstCaseSpeed(TUNING.speed.max)],
  ] as const;

  describe.each(speeds)('at %s speed', (_label, speed) => {
    it('never puts two decision rows closer than one reaction apart', () => {
      // Every seed, not a sample: one bad seed in three hundred is a run the
      // player loses to something they could not have reacted to.
      for (let seed = 0; seed < 300; seed++) {
        const tightest = Math.min(...rowGapSeconds(seed, speed));
        expect(tightest).toBeGreaterThanOrEqual(REACTION_SECONDS - 1e-6);
      }
    });

    it('still lays real obstacles rather than an empty slope', () => {
      // The pacing rule is satisfiable by generating nothing at all, so this is
      // what stops a future tightening from quietly emptying the track.
      for (let seed = 0; seed < 40; seed++) {
        expect(generate(seed, speed).length).toBeGreaterThan(3);
      }
    });

    it('stays solvable, so pacing never comes at the cost of the guarantee', () => {
      for (let seed = 0; seed < 60; seed++) {
        expect(checkSolvable(generate(seed, speed), { speed }).solvable).toBe(true);
      }
    });
  });

  it('stays lethal to a player who never touches the screen', () => {
    // The counterweight to everything above. Spacing obstacles further apart is
    // the fix for an unplayable track, and taken too far it produces an empty
    // slope you can win by putting the phone down. A do-nothing run has to end
    // quickly, or the pacing rule has been loosened past the point of a game.
    const distances: number[] = [];
    for (let seed = 0; seed < 60; seed++) {
      const rt = createTestRuntime(seed);
      rt.running = true;
      let ticks = 0;
      while (rt.alive && ticks < 60 * 60) {
        tickRun(rt, TUNING.sim.step);
        ticks++;
      }
      distances.push(rt.distance);
    }

    distances.sort((a, b) => a - b);
    const median = distances[Math.floor(distances.length / 2)] as number;
    expect(median).toBeLessThan(250);
    // And nothing should be able to coast indefinitely.
    expect(distances[distances.length - 1]).toBeLessThan(600);
  });

  it('thins the track out as the run speeds up rather than compressing it', () => {
    // The whole design: a faster run stays playable by spreading obstacles out.
    // If density held constant, speed alone would make the game impossible.
    const rowsAt = (speed: number) => {
      let total = 0;
      for (let seed = 0; seed < 60; seed++) total += buildRows(generate(seed, speed)).length;
      return total / 60;
    };

    expect(rowsAt(worstCaseSpeed(TUNING.speed.max))).toBeLessThan(
      rowsAt(worstCaseSpeed(TUNING.speed.start)),
    );
  });
});
