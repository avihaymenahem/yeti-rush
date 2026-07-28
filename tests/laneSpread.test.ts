/**
 * Where obstacles land across the three lanes.
 *
 * The player sits in one lane at a time, so a library that leans on the centre
 * does not read as "slightly uneven" - it reads as every obstacle being in the
 * middle, because the ones in the middle are the only ones the player has to
 * answer. Measured against the real generator, the centre lane once held 51.6%
 * of everything laid, and tier 0 held 100%.
 *
 * Two things fix that and both are checked here: the authored library is spread
 * across the lanes, and the spawner mirrors chunks left-to-right on a coin toss.
 * The mirror is only safe because a reflection is the one symmetry a three-lane
 * track has - it preserves lane adjacency, so every guarantee already proved for
 * a chunk holds for its mirror unchanged. That is asserted rather than assumed.
 */

import { describe, expect, it } from 'vitest';
import { LANES, TUNING, type LaneIndex } from '@/game/config/tuning';
import {
  CHUNKS,
  decisionRows,
  expandObstacles,
  forcedActionRows,
  minRowGap,
  mirrorLane,
  mirrorObstacle,
  type ChunkTemplate,
} from '@/game/content/chunks';
import { obstacleDef } from '@/game/content/obstacles';
import { worstCaseSpeed } from '@/game/content/skins';
import { createRng } from '@/game/core/rng';
import { speedAt, tierAt, type DifficultyTier } from '@/game/systems/difficulty';
import { isSolvable, type PlacedObstacle } from '@/game/systems/solvability';
import { createSpawner, updateSpawner } from '@/game/systems/spawner';

const STEP = TUNING.sim.step;
const CENTRE = 1;

/**
 * Every distinct obstacle laid over one run, counted per lane.
 *
 * Entities come from a recycled pool, so the same slot is reused many times over
 * a run; keying on position and kind is what stops one obstacle being counted
 * once per frame it is alive for.
 */
function layObstacles(seed: number, seconds: number): { lanes: number[]; byTier: Map<number, number[]> } {
  const state = createSpawner();
  const rng = createRng(seed);
  const lanes = [0, 0, 0];
  const byTier = new Map<number, number[]>();
  const seen = new Set<string>();

  let distance = 0;
  let elapsed = 0;

  while (elapsed < seconds) {
    elapsed += STEP;
    const speed = speedAt(elapsed);
    distance += speed * STEP;
    updateSpawner(state, distance, tierAt(distance), rng, speed);

    for (const obstacle of state.obstacles) {
      if (!obstacle.active) continue;
      const key = `${obstacle.trackZ.toFixed(2)}:${obstacle.lane}:${obstacle.kind}`;
      if (seen.has(key)) continue;
      seen.add(key);

      lanes[obstacle.lane] = (lanes[obstacle.lane] as number) + 1;
      const tier = tierAt(obstacle.trackZ);
      const row = byTier.get(tier) ?? [0, 0, 0];
      row[obstacle.lane] = (row[obstacle.lane] as number) + 1;
      byTier.set(tier, row);
    }
  }

  return { lanes, byTier };
}

/** Totals across many seeds, so one unlucky run cannot decide the verdict. */
function layAcrossSeeds(seeds: number, seconds: number) {
  const lanes = [0, 0, 0];
  const byTier = new Map<number, number[]>();

  for (let seed = 0; seed < seeds; seed++) {
    const run = layObstacles(seed, seconds);
    for (let lane = 0; lane < LANES.length; lane++) {
      lanes[lane] = (lanes[lane] as number) + (run.lanes[lane] as number);
    }
    for (const [tier, row] of run.byTier) {
      const total = byTier.get(tier) ?? [0, 0, 0];
      for (let lane = 0; lane < LANES.length; lane++) {
        total[lane] = (total[lane] as number) + (row[lane] as number);
      }
      byTier.set(tier, total);
    }
  }

  return { lanes, byTier };
}

const share = (lanes: readonly number[], lane: number): number =>
  (lanes[lane] as number) / lanes.reduce((sum, n) => sum + n, 0);

/**
 * How far from an even third any lane is allowed to sit.
 *
 * An even split is 33.3%. Exact evenness is neither achievable nor desirable -
 * the centre is genuinely where a run starts, and walls that seal all three
 * lanes contribute equally to each - so this allows a real lean while ruling out
 * the kind of imbalance a player notices.
 */
const MAX_SHARE = 0.42;
const MIN_SHARE = 0.26;

describe('mirroring is a safe transformation', () => {
  it('reflects the outer lanes and fixes the centre', () => {
    expect(mirrorLane(0)).toBe(2);
    expect(mirrorLane(2)).toBe(0);
    expect(mirrorLane(1)).toBe(1);
  });

  it('is its own inverse', () => {
    for (const lane of [0, 1, 2] as LaneIndex[]) {
      expect(mirrorLane(mirrorLane(lane))).toBe(lane);
    }
  });

  it('leaves every pacing property of a chunk unchanged', () => {
    // Rows, forced rows and the gaps between them are what the spawner's pacing
    // and spacing rules are computed from. A reflection moves obstacles sideways
    // and never along z, so all three must come out identical - if they did not,
    // mirroring would be laying track the generator had never checked.
    for (const chunk of CHUNKS) {
      const mirrored: ChunkTemplate = {
        ...chunk,
        // `mirrorObstacle` rather than flipping the lane: an obstacle spanning
        // several lanes has to re-anchor to the far end of its reflected span,
        // or it comes back shorter and the chunk being compared is not the
        // mirror of the one it claims to be.
        obstacles: chunk.obstacles.map(mirrorObstacle),
      };

      expect(decisionRows(mirrored)).toEqual(decisionRows(chunk));
      expect(forcedActionRows(mirrored)).toEqual(forcedActionRows(chunk));
      expect(minRowGap(mirrored)).toBe(minRowGap(chunk));
    }
  });

  it('leaves every chunk solvable at the worst case any board can produce', () => {
    // The real guarantee. Adjacency is preserved by a reflection, so a route
    // through a chunk maps to a route through its mirror - but this asserts it
    // against the actual DP rather than trusting the argument.
    const speed = worstCaseSpeed(TUNING.speed.max);

    for (const chunk of CHUNKS) {
      for (const mirror of [false, true]) {
        const placed: PlacedObstacle[] = expandObstacles(chunk, 0, mirror).map((spec) => ({
          lane: spec.lane,
          z: spec.z,
          action: obstacleDef(spec.kind).action,
        }));

        expect(isSolvable(placed, { speed })).toBe(true);
      }
    }
  });
});

describe('obstacles are spread across the lanes', () => {
  const { lanes, byTier } = layAcrossSeeds(60, 180);

  it('lays enough obstacles for the measurement to mean anything', () => {
    // The counterweight. Every share assertion below is trivially satisfiable by
    // generating nothing at all, so the sample size is checked first.
    const total = lanes.reduce((sum, n) => sum + n, 0);
    expect(total).toBeGreaterThan(5000);
  });

  it('does not lean on the centre lane', () => {
    expect(share(lanes, CENTRE)).toBeLessThan(MAX_SHARE);
  });

  it('gives every lane a real share of the work', () => {
    for (const lane of [0, 1, 2]) {
      expect(share(lanes, lane)).toBeGreaterThan(MIN_SHARE);
    }
  });

  it('is balanced left to right, which mirroring makes structural', () => {
    // Not a coincidence to be re-tuned when content is added: mirroring is a
    // coin toss per chunk, so any authored bias towards one side is averaged
    // out by construction. A wide tolerance here is sampling noise, not slack.
    expect(Math.abs(share(lanes, 0) - share(lanes, 2))).toBeLessThan(0.03);
  });

  it('is spread at every tier, not just averaged out across the run', () => {
    // Tier 0 used to be 100% centre, and because `chunksForTier` is cumulative
    // its chunks stay in the pool for the whole run - so an imbalance in the
    // teaching tier leaked into every tier after it. Checking the aggregate
    // alone would have missed exactly that.
    for (const tier of [0, 1, 2, 3] as DifficultyTier[]) {
      const row = byTier.get(tier);
      expect(row, `tier ${tier} laid nothing`).toBeDefined();
      const total = (row as number[]).reduce((sum, n) => sum + n, 0);
      expect(total, `tier ${tier} sample too small`).toBeGreaterThan(500);

      expect(share(row as number[], CENTRE), `tier ${tier} centre share`).toBeLessThan(MAX_SHARE);
      for (const lane of [0, 2]) {
        expect(share(row as number[], lane), `tier ${tier} lane ${lane} share`).toBeGreaterThan(
          MIN_SHARE,
        );
      }
    }
  });
});

describe('the authored library itself is spread', () => {
  it('has outer-lane obstacles in every tier', () => {
    // Mirroring can only redistribute what is authored. A tier whose obstacles
    // all sit in lane 1 stays 100% centre however many times it is reflected,
    // which is precisely how the original imbalance survived unnoticed.
    for (const tier of [0, 1, 2, 3]) {
      const obstacles = CHUNKS.filter((chunk) => chunk.tier === tier).flatMap(
        (chunk) => chunk.obstacles,
      );
      expect(obstacles.length, `tier ${tier} has no obstacles`).toBeGreaterThan(0);

      const outer = obstacles.filter((obstacle) => obstacle.lane !== CENTRE);
      expect(outer.length, `tier ${tier} is centre-only`).toBeGreaterThan(0);
    }
  });
});
