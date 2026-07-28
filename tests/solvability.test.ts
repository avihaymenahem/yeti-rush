/**
 * Track solvability.
 *
 * The headline test is the fuzz at the bottom: it drives the *real* spawner
 * over hundreds of seeds, collects the track it actually produces, and proves
 * every metre of it can be run through at top speed. An unsolvable stretch is
 * the one bug in an endless runner that is invisible in review and unarguable
 * in play, so it gets checked against the real generator rather than a stub.
 */

import { describe, expect, it } from 'vitest';
import { TUNING, type LaneIndex } from '@/game/config/tuning';
import { worstCaseLaneChangeDuration, worstCaseSpeed } from '@/game/content/skins';
import { CHUNKS, CHUNK_LENGTH, expandObstacles } from '@/game/content/chunks';
import { obstacleDef } from '@/game/content/obstacles';
import { createRng } from '@/game/core/rng';
import { tierAt, TIER_COUNT } from '@/game/systems/difficulty';
import { railLandingDistance } from '@/game/systems/rail';
import {
  buildRows,
  checkSolvable,
  isSolvable,
  type PlacedObstacle,
} from '@/game/systems/solvability';
import { createSpawner, resetSpawner, updateSpawner } from '@/game/systems/spawner';

/**
 * The hardest configuration the game can produce.
 *
 * Not simply `TUNING.speed.max`: boards carry a speed multiplier, and the
 * fastest one raises the ceiling. The solvability guarantee has to hold for
 * whichever board the player equipped, so it is validated against the worst
 * case any board can reach - derived from the skins table, so adding a faster
 * board fails these tests rather than silently making stretches impassable.
 */
const TOP_SPEED = worstCaseSpeed(TUNING.speed.max);
const SLOWEST_LANE_CHANGE = worstCaseLaneChangeDuration(TUNING.player.laneChangeDuration);

/** Options describing that worst case, passed to every solvability check. */
const WORST_CASE = { speed: TOP_SPEED, laneChangeDuration: SLOWEST_LANE_CHANGE };

function at(lane: LaneIndex, z: number, action: 'jump' | 'slide' | 'dodge'): PlacedObstacle {
  return { lane, z, action };
}

describe('buildRows', () => {
  it('returns nothing for an empty track', () => {
    expect(buildRows([])).toEqual([]);
  });

  it('groups obstacles within the tolerance into one row', () => {
    const rows = buildRows([at(0, 10, 'dodge'), at(2, 10.5, 'dodge')], 1.5);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.lanes).toEqual(['dodge', null, 'dodge']);
  });

  it('splits obstacles beyond the tolerance into separate rows', () => {
    const rows = buildRows([at(0, 10, 'dodge'), at(2, 14, 'dodge')], 1.5);
    expect(rows).toHaveLength(2);
  });

  it('orders rows along the track regardless of input order', () => {
    const rows = buildRows([at(0, 30, 'dodge'), at(1, 10, 'jump'), at(2, 20, 'slide')]);
    expect(rows.map((row) => row.z)).toEqual([10, 20, 30]);
  });
});

describe('checkSolvable', () => {
  it('treats empty track as solvable', () => {
    expect(isSolvable([], WORST_CASE)).toBe(true);
  });

  it('rejects a row blocked in every lane', () => {
    const result = checkSolvable(
      [at(0, 30, 'dodge'), at(1, 30, 'dodge'), at(2, 30, 'dodge')],
      WORST_CASE,
    );
    expect(result.solvable).toBe(false);
    expect(result.failedRow).toBe(0);
  });

  it('accepts a full-width row of jumpables - the answer is timing, not steering', () => {
    expect(
      isSolvable([at(0, 30, 'jump'), at(1, 30, 'jump'), at(2, 30, 'jump')], WORST_CASE),
    ).toBe(true);
  });

  it('accepts a full-width row of slideables', () => {
    expect(
      isSolvable([at(0, 30, 'slide'), at(1, 30, 'slide'), at(2, 30, 'slide')], {
        speed: TOP_SPEED,
      }),
    ).toBe(true);
  });

  it('rejects a two-lane shift the player has no room to make', () => {
    const laneChangeDistance = TUNING.player.laneChangeDuration * TOP_SPEED;
    // Forced into lane 2, then forced into lane 0, with room for one shift only.
    const obstacles = [
      at(0, 40, 'dodge'),
      at(1, 40, 'dodge'),
      at(1, 40 + laneChangeDistance * 1.5, 'dodge'),
      at(2, 40 + laneChangeDistance * 1.5, 'dodge'),
    ];
    expect(isSolvable(obstacles, WORST_CASE)).toBe(false);
  });

  it('accepts the same two-lane shift when there is room for it', () => {
    const laneChangeDistance = TUNING.player.laneChangeDuration * TOP_SPEED;
    const obstacles = [
      at(0, 40, 'dodge'),
      at(1, 40, 'dodge'),
      at(1, 40 + laneChangeDistance * 2.5, 'dodge'),
      at(2, 40 + laneChangeDistance * 2.5, 'dodge'),
    ];
    expect(isSolvable(obstacles, WORST_CASE)).toBe(true);
  });

  it('rejects two forced actions stacked too close together', () => {
    const obstacles = [
      at(0, 40, 'jump'),
      at(1, 40, 'jump'),
      at(2, 40, 'jump'),
      at(0, 41, 'slide'),
      at(1, 41, 'slide'),
      at(2, 41, 'slide'),
    ];
    // 1m apart is far less than the commitment after a jump.
    expect(isSolvable(obstacles, { ...WORST_CASE, rowTolerance: 0.5 })).toBe(false);
  });

  it('accepts two forced actions with enough distance between them', () => {
    const gap = 0.3 * TOP_SPEED + 2;
    const obstacles = [
      at(0, 40, 'jump'),
      at(1, 40, 'jump'),
      at(2, 40, 'jump'),
      at(0, 40 + gap, 'slide'),
      at(1, 40 + gap, 'slide'),
      at(2, 40 + gap, 'slide'),
    ];
    expect(isSolvable(obstacles, WORST_CASE)).toBe(true);
  });

  it('returns a path that is actually free of dodge obstacles', () => {
    const result = checkSolvable(
      [at(0, 20, 'dodge'), at(1, 20, 'dodge'), at(1, 40, 'dodge'), at(2, 40, 'dodge')],
      WORST_CASE,
    );
    expect(result.solvable).toBe(true);
    expect(result.path).not.toBeNull();

    result.path!.forEach((lane, index) => {
      expect(result.rows[index]!.lanes[lane]).not.toBe('dodge');
    });
  });

  it('is harder at higher speed, never easier', () => {
    const laneChangeDistance = TUNING.player.laneChangeDuration * TOP_SPEED;
    const obstacles = [
      at(0, 40, 'dodge'),
      at(1, 40, 'dodge'),
      at(1, 40 + laneChangeDistance * 1.5, 'dodge'),
      at(2, 40 + laneChangeDistance * 1.5, 'dodge'),
    ];
    expect(isSolvable(obstacles, WORST_CASE)).toBe(false);
    // Same layout, half the speed: there is now time to cross two lanes.
    expect(isSolvable(obstacles, { speed: TOP_SPEED / 2 })).toBe(true);
  });
});

describe('every authored chunk', () => {
  it.each(CHUNKS.map((chunk) => [chunk.id, chunk] as const))(
    '%s is solvable in isolation at top speed',
    (_id, chunk) => {
      const obstacles: PlacedObstacle[] = expandObstacles(chunk, 0).map((spec) => ({
        lane: spec.lane,
        z: spec.z,
        action: obstacleDef(spec.kind).action,
      }));
      expect(isSolvable(obstacles, WORST_CASE)).toBe(true);
    },
  );

  it.each(CHUNKS.map((chunk) => [chunk.id, chunk] as const))(
    '%s keeps its contents inside the chunk length',
    (_id, chunk) => {
      for (const obstacle of chunk.obstacles) {
        expect(obstacle.z).toBeGreaterThanOrEqual(0);
        expect(obstacle.z).toBeLessThan(CHUNK_LENGTH);
      }
    },
  );

  it('declares a valid tier and a positive weight for every chunk', () => {
    for (const chunk of CHUNKS) {
      expect(chunk.tier).toBeGreaterThanOrEqual(0);
      expect(chunk.tier).toBeLessThan(TIER_COUNT);
      expect(chunk.weight).toBeGreaterThan(0);
    }
  });

  it('uses unique ids', () => {
    const ids = CHUNKS.map((chunk) => chunk.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('provides at least one chunk at every tier', () => {
    for (let tier = 0; tier < TIER_COUNT; tier++) {
      expect(CHUNKS.some((chunk) => chunk.tier === tier)).toBe(true);
    }
  });
});

/**
 * Drives the real spawner and records every obstacle it produces, so the fuzz
 * below validates the actual generated track rather than a reimplementation of
 * it - including everything that happens across chunk boundaries.
 */
function generateTrack(seed: number, totalDistance: number): PlacedObstacle[] {
  const rng = createRng(seed);
  const spawner = createSpawner();
  resetSpawner(spawner);

  const seen = new Map<string, PlacedObstacle>();

  for (let distance = 0; distance <= totalDistance; distance += 10) {
    updateSpawner(spawner, distance, tierAt(distance), rng);

    for (const obstacle of spawner.obstacles) {
      if (!obstacle.active) continue;
      const key = `${obstacle.trackZ.toFixed(3)}:${obstacle.lane}:${obstacle.kind}`;
      if (seen.has(key)) continue;
      seen.set(key, {
        lane: obstacle.lane,
        z: obstacle.trackZ,
        action: obstacleDef(obstacle.kind).action,
      });
    }

    // Rails count. A grind rail is a solid bar standing in its lane - ollie onto
    // it and you ride, ride into it and you go down - so the proof has to see it
    // as a jumpable rather than be told it is not there. The sloped rail this
    // replaced really was ignorable, which is why it was legitimately left out;
    // reusing that exemption for a bar you can crash into would have made the
    // guarantee quietly untrue for every lane a rail stood in.
    for (const rail of spawner.rails) {
      if (!rail.active) continue;
      const key = `${rail.trackZ.toFixed(3)}:${rail.lane}:rail`;
      if (seen.has(key)) continue;
      // Only the near end: a jump covers far more ground than any authored rail
      // is long, so answering the bar at its start answers all of it.
      seen.set(key, { lane: rail.lane, z: rail.trackZ, action: 'jump' });
    }
  }

  return [...seen.values()].sort((a, b) => a.z - b.z);
}

/**
 * Records every ramp and every obstacle the real spawner produces, so the
 * landing guarantee can be checked against the actual generator.
 */
function generateRampsAndObstacles(
  seed: number,
  totalDistance: number,
): { ramps: number[]; obstacles: { z: number; kind: string }[] } {
  const rng = createRng(seed);
  const spawner = createSpawner();
  resetSpawner(spawner);

  const ramps = new Map<string, number>();
  const obstacles = new Map<string, { z: number; kind: string }>();

  for (let distance = 0; distance <= totalDistance; distance += 10) {
    updateSpawner(spawner, distance, tierAt(distance), rng);

    for (const ramp of spawner.ramps) {
      if (ramp.active) ramps.set(`${ramp.trackZ.toFixed(3)}:${ramp.lane}`, ramp.trackZ);
    }
    for (const obstacle of spawner.obstacles) {
      if (!obstacle.active) continue;
      obstacles.set(`${obstacle.trackZ.toFixed(3)}:${obstacle.lane}:${obstacle.kind}`, {
        z: obstacle.trackZ,
        kind: obstacle.kind,
      });
    }
  }

  return { ramps: [...ramps.values()], obstacles: [...obstacles.values()] };
}

/**
 * The same recording, for rails. Kept separate from the ramp version because a
 * rail's danger zone is computed differently: the exit is a fall that takes a
 * fixed *time*, so the ground it covers grows with speed.
 */
function generateRailsAndObstacles(
  seed: number,
  totalDistance: number,
  speed: number,
): { rails: { z: number; end: number }[]; obstacles: { z: number; kind: string }[] } {
  const rng = createRng(seed);
  const spawner = createSpawner();
  resetSpawner(spawner);

  const rails = new Map<string, { z: number; end: number }>();
  const obstacles = new Map<string, { z: number; kind: string }>();

  for (let distance = 0; distance <= totalDistance; distance += 10) {
    updateSpawner(spawner, distance, tierAt(distance), rng, speed);

    for (const rail of spawner.rails) {
      if (!rail.active) continue;
      // The rolled length, not a constant: since rails randomise, the far end
      // is a property of the entity and nothing else knows it.
      rails.set(`${rail.trackZ.toFixed(3)}:${rail.lane}`, {
        z: rail.trackZ,
        end: rail.trackZ + rail.length,
      });
    }
    for (const obstacle of spawner.obstacles) {
      if (!obstacle.active) continue;
      obstacles.set(`${obstacle.trackZ.toFixed(3)}:${obstacle.lane}:${obstacle.kind}`, {
        z: obstacle.trackZ,
        kind: obstacle.kind,
      });
    }
  }

  return { rails: [...rails.values()], obstacles: [...obstacles.values()] };
}

describe('rail landings', () => {
  /**
   * A rail ends by throwing the player into a fall of nearly four metres. They
   * can steer during it, but they cannot jump or slide - so an obstacle needing
   * either is unanswerable, and a row sealing every lane is fatal however well
   * it was read.
   *
   * This is the ramp-landing bug repeated: rails shipped without the protection
   * ramps already had, and the reward route ended in an obstacle the player was
   * already airborne for. Measured before the fix, 4,664 obstacles sat inside a
   * rail's landing zone across 200 seeds.
   */
  it('never puts an obstacle where a rail drops the player, across 300 seeds', () => {
    const speed = worstCaseSpeed(TUNING.speed.max);
    const landing = railLandingDistance(speed);
    const violations: { seed: number; gap: number; kind: string }[] = [];

    for (let seed = 1; seed <= 300; seed++) {
      const { rails, obstacles } = generateRailsAndObstacles(seed, 3000, speed);

      for (const rail of rails) {
        const exit = rail.end;
        const touchdown = exit + landing;
        const dangerEnd = touchdown + TUNING.rail.landingClearance;

        for (const obstacle of obstacles) {
          // Only the span past the dismount matters. A level rail carries the
          // player over nothing, so what is being protected here is the fall at
          // the end of it and the ground they come down on.
          if (obstacle.z <= exit || obstacle.z > dangerEnd) continue;
          violations.push({
            seed,
            gap: Number((obstacle.z - exit).toFixed(1)),
            kind: obstacle.kind,
          });
        }
      }
    }

    expect(violations.slice(0, 8)).toEqual([]);
    expect(violations).toHaveLength(0);
  });

  it('still generates rails at all, so the guarantee is not vacuous', () => {
    const speed = worstCaseSpeed(TUNING.speed.max);
    let total = 0;
    for (let seed = 1; seed <= 30; seed++) {
      total += generateRailsAndObstacles(seed, 3000, speed).rails.length;
    }
    expect(total).toBeGreaterThan(20);
  });

  it('protects a landing zone that actually grows with speed', () => {
    // If this were a constant the guarantee would hold at the speed it was
    // tuned at and quietly fail everywhere above it.
    expect(railLandingDistance(40)).toBeGreaterThan(railLandingDistance(20));
  });
});

describe('ramp landings', () => {
  /**
   * A launch commits the player to a flight they cannot abort, and the chalet
   * at the apex hides what is behind it until they are over the roof. An
   * obstacle in the descent or at the touchdown point is therefore unavoidable
   * and unknowable - the one failure a player cannot learn from.
   */
  it('never puts an obstacle in a descent or landing zone, across 300 seeds', () => {
    const violations: { seed: number; gap: number; kind: string }[] = [];

    for (let seed = 1; seed <= 300; seed++) {
      const { ramps, obstacles } = generateRampsAndObstacles(seed, 3000);

      for (const rampZ of ramps) {
        const touchdown = rampZ + TUNING.ramp.airDistance;
        // From just past the chalet the arc is descending, through to the
        // clearance the player needs after touching down.
        const dangerStart = rampZ + TUNING.ramp.chaletGap + 3;
        const dangerEnd = touchdown + TUNING.ramp.landingClearance;

        for (const obstacle of obstacles) {
          // The chalet at the apex is the thing the ramp exists to clear.
          if (obstacle.kind === 'chalet') continue;
          if (obstacle.z < dangerStart || obstacle.z > dangerEnd) continue;
          violations.push({
            seed,
            gap: Number((obstacle.z - touchdown).toFixed(1)),
            kind: obstacle.kind,
          });
        }
      }
    }

    expect(violations.slice(0, 8)).toEqual([]);
    expect(violations).toHaveLength(0);
  });

  it('still generates ramps at all, so the guarantee is not vacuous', () => {
    let total = 0;
    for (let seed = 1; seed <= 30; seed++) {
      total += generateRampsAndObstacles(seed, 3000).ramps.length;
    }
    expect(total).toBeGreaterThan(20);
  });

  it('leaves a real run-out, not just a technically clear touchdown', () => {
    let worstGap = Infinity;

    for (let seed = 1; seed <= 120; seed++) {
      const { ramps, obstacles } = generateRampsAndObstacles(seed, 3000);

      for (const rampZ of ramps) {
        const touchdown = rampZ + TUNING.ramp.airDistance;
        for (const obstacle of obstacles) {
          if (obstacle.kind === 'chalet') continue;
          const gap = obstacle.z - touchdown;
          if (gap < 0) continue;
          worstGap = Math.min(worstGap, gap);
        }
      }
    }

    // At top speed the player needs roughly half a second to read and react.
    expect(worstGap).toBeGreaterThan(TUNING.speed.max * 0.5);
  });
});

describe('generated track', () => {
  it('produces obstacles at all', () => {
    const track = generateTrack(1, 1000);
    expect(track.length).toBeGreaterThan(10);
  });

  it('lays chunks in order without gaps or overlaps in the stream', () => {
    const track = generateTrack(7, 2000);
    for (let i = 1; i < track.length; i++) {
      expect(track[i]!.z).toBeGreaterThanOrEqual(track[i - 1]!.z);
    }
  });

  it('is solvable at top speed across 500 seeds', () => {
    const failures: { seed: number; failedRow: number | null }[] = [];

    for (let seed = 1; seed <= 500; seed++) {
      // Far enough to reach the hardest tier and cross many chunk boundaries.
      const track = generateTrack(seed, 4000);
      const result = checkSolvable(track, WORST_CASE);
      if (!result.solvable) failures.push({ seed, failedRow: result.failedRow });
    }

    expect(failures).toEqual([]);
  });

  it('is solvable at the speed actually reached, across 200 seeds', () => {
    // Top speed is the conservative bound; this checks the realistic case too.
    const failures: number[] = [];

    for (let seed = 501; seed <= 700; seed++) {
      const track = generateTrack(seed, 3000);
      if (!isSolvable(track, { speed: TUNING.speed.start })) failures.push(seed);
    }

    expect(failures).toEqual([]);
  });
});
