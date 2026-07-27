/**
 * The authored track chunk library.
 *
 * The endless track is assembled from these 20-metre chunks, picked by weight
 * within the difficulty tier the player has reached. Authoring chunks by hand
 * rather than scattering obstacles randomly is what makes the track read as
 * designed - a random scatter produces both unfair walls and long dead stretches.
 *
 * Every chunk is checked by `systems/solvability` in a test. A chunk that
 * cannot be run through never ships.
 */

import { LANES, type LaneIndex } from '@/game/config/tuning';
import { obstacleDef, type ObstacleKind } from '@/game/content/obstacles';
import { rampArcHeight } from '@/game/systems/ramp';
import { railHeightAt } from '@/game/systems/rail';

export interface ChunkObstacle {
  kind: ObstacleKind;
  lane: LaneIndex;
  /** Metres from the start of the chunk. */
  z: number;
}

export interface ChunkCoinRun {
  lane: LaneIndex;
  /** Metres from the start of the chunk to the first coin. */
  z: number;
  count: number;
  /** Metres between coins. */
  spacing?: number;
  /**
   * Lifts the run into a jump arc, so the reward for jumping an obstacle is a
   * coin line you can only reach in the air.
   */
  arc?: boolean;
  /**
   * Traces the flight path of the ramp at this chunk-relative z instead of a
   * generic hop. The coins then sit exactly where a launched player passes,
   * which is what makes flying over a chalet feel rewarded rather than lucky.
   */
  rampFrom?: number;
  /**
   * Rides the rail whose near end is at this chunk-relative z, so the coins
   * climb with it. Same idea as `rampFrom`: the reward has to sit exactly where
   * the route puts the player, or taking the route feels unrewarded.
   */
  railFrom?: number;
}

export interface ChunkRamp {
  lane: LaneIndex;
  /** Metres from the start of the chunk. */
  z: number;
}

export interface ChunkRail {
  lane: LaneIndex;
  /** Metres from the start of the chunk to the rail's near end. */
  z: number;
}

export interface ChunkTemplate {
  id: string;
  /** Lowest difficulty tier this chunk may appear in. */
  tier: 0 | 1 | 2 | 3;
  /** Relative likelihood of being picked within its tier. */
  weight: number;
  obstacles: ChunkObstacle[];
  coins: ChunkCoinRun[];
  /** Launch pads. Optional - most chunks have none. */
  ramps?: ChunkRamp[];
  /** Grind rails. Optional, and never required to get through a chunk. */
  rails?: ChunkRail[];
}

/** Chunks are a fixed length so the spawner can lay them end to end. */
export const CHUNK_LENGTH = 20;

export const CHUNKS: ChunkTemplate[] = [
  // --- Tier 0: teach one idea at a time -------------------------------------
  // Obstacle-free chunks. As well as pacing the run, these are what the
  // spawner lays as a landing runway after a ramp - see `isRunway`.
  {
    id: 'breather',
    tier: 0,
    weight: 6,
    obstacles: [],
    coins: [{ lane: 1, z: 4, count: 8 }],
  },
  {
    id: 'breather-wide',
    tier: 0,
    weight: 4,
    obstacles: [],
    coins: [
      { lane: 0, z: 5, count: 5 },
      { lane: 2, z: 5, count: 5 },
    ],
  },
  {
    id: 'breather-weave',
    tier: 0,
    weight: 4,
    obstacles: [],
    coins: [
      { lane: 0, z: 3, count: 4 },
      { lane: 1, z: 9, count: 4 },
      { lane: 2, z: 15, count: 4 },
    ],
  },
  // The three lessons - jump, slide, steer - each taught by one obstacle in the
  // lane the player starts in, because a first obstacle off to the side teaches
  // nothing. Their weight is deliberately no higher than the rest of the
  // library: these chunks stay in the pool at every tier (`chunksForTier` is
  // cumulative), and at weight 10 they went on dominating long after they had
  // stopped teaching anything - which is most of why half of every obstacle in
  // the game was landing in the centre lane.
  {
    id: 'first-drift',
    tier: 0,
    weight: 6,
    obstacles: [{ kind: 'drift', lane: 1, z: 10 }],
    coins: [{ lane: 1, z: 8, count: 5, arc: true }],
  },
  {
    id: 'first-banner',
    tier: 0,
    weight: 6,
    obstacles: [{ kind: 'banner', lane: 1, z: 10 }],
    coins: [{ lane: 1, z: 12, count: 5 }],
  },
  {
    id: 'first-boulder',
    tier: 0,
    weight: 6,
    obstacles: [{ kind: 'boulder', lane: 1, z: 10 }],
    coins: [{ lane: 0, z: 9, count: 4 }],
  },

  // The same lessons taught out on a wing. An obstacle in an outer lane asks
  // nothing of a player sitting in the centre, so each of these baits the lane
  // first with a coin run and puts the obstacle at the end of it: the reward is
  // what makes the outer lane worth being in, and the obstacle is what makes
  // being there a decision. Authored on the left only - the spawner mirrors.
  {
    id: 'wing-boulder',
    tier: 0,
    weight: 7,
    // Coins run z=3..7.2, boulder at 14. Nearly seven metres of clear track to
    // see it and come back in, which is over a third of a second even at the
    // speed this tier tops out at.
    obstacles: [{ kind: 'boulder', lane: 0, z: 14 }],
    coins: [
      { lane: 0, z: 3, count: 4 },
      { lane: 1, z: 15, count: 3 },
    ],
  },
  {
    id: 'wing-drift',
    tier: 0,
    weight: 7,
    // Jumpable, so the greedy line is to stay out here and clear it rather than
    // duck back to the centre - the arc of coins over it is the tell.
    obstacles: [{ kind: 'drift', lane: 0, z: 12 }],
    coins: [{ lane: 0, z: 10, count: 5, arc: true }],
  },
  {
    id: 'wing-banner',
    tier: 0,
    weight: 7,
    obstacles: [{ kind: 'banner', lane: 0, z: 12 }],
    coins: [
      { lane: 0, z: 4, count: 4 },
      { lane: 0, z: 14, count: 4 },
    ],
  },
  {
    id: 'outer-gate',
    tier: 0,
    weight: 6,
    // Both wings sealed and the centre open - the exact inverse of the shape
    // this library used to lean on, and the one row that is answered by moving
    // *in* rather than out.
    obstacles: [
      { kind: 'boulder', lane: 0, z: 12 },
      { kind: 'boulder', lane: 2, z: 12 },
    ],
    coins: [{ lane: 1, z: 11, count: 5 }],
  },

  // --- Tier 1: two obstacles, one decision ----------------------------------
  {
    id: 'twin-boulders-left',
    tier: 1,
    weight: 8,
    obstacles: [
      { kind: 'boulder', lane: 0, z: 8 },
      { kind: 'boulder', lane: 1, z: 8 },
    ],
    coins: [{ lane: 2, z: 7, count: 5 }],
  },
  {
    id: 'twin-boulders-right',
    tier: 1,
    weight: 8,
    obstacles: [
      { kind: 'boulder', lane: 1, z: 8 },
      { kind: 'boulder', lane: 2, z: 8 },
    ],
    coins: [{ lane: 0, z: 7, count: 5 }],
  },
  {
    id: 'log-wall',
    tier: 1,
    weight: 9,
    // Every lane blocked by a jumpable: the answer is timing, not steering.
    obstacles: [
      { kind: 'log', lane: 0, z: 10 },
      { kind: 'log', lane: 1, z: 10 },
      { kind: 'log', lane: 2, z: 10 },
    ],
    coins: [{ lane: 1, z: 8, count: 6, arc: true }],
  },
  {
    id: 'banner-wall',
    tier: 1,
    weight: 8,
    obstacles: [
      { kind: 'banner', lane: 0, z: 10 },
      { kind: 'banner', lane: 1, z: 10 },
      { kind: 'banner', lane: 2, z: 10 },
    ],
    coins: [{ lane: 1, z: 13, count: 6 }],
  },
  {
    id: 'slalom',
    tier: 1,
    weight: 8,
    obstacles: [
      { kind: 'woodpile', lane: 0, z: 5 },
      { kind: 'woodpile', lane: 2, z: 12 },
    ],
    coins: [
      { lane: 2, z: 4, count: 3 },
      { lane: 0, z: 11, count: 3 },
    ],
  },

  // --- Tier 2: combinations -------------------------------------------------
  {
    id: 'jump-then-slide',
    tier: 2,
    weight: 9,
    // 10m apart: at top speed a jump and a slide need roughly 9m between them,
    // so this leaves real margin rather than sitting on the threshold.
    obstacles: [
      { kind: 'drift', lane: 1, z: 5 },
      { kind: 'banner', lane: 1, z: 15 },
    ],
    coins: [{ lane: 1, z: 4, count: 4, arc: true }],
  },
  {
    id: 'dodge-into-jump',
    tier: 2,
    weight: 9,
    obstacles: [
      { kind: 'boulder', lane: 1, z: 5 },
      { kind: 'boulder', lane: 2, z: 5 },
      { kind: 'log', lane: 0, z: 14 },
    ],
    coins: [{ lane: 0, z: 13, count: 4, arc: true }],
  },
  {
    id: 'staircase',
    tier: 2,
    weight: 8,
    // 7m between rows, not 6. Each row forces a one-lane shift, and the fastest
    // board covers ~6m in a lane change - at 6m spacing it would be unsolvable
    // on that board while remaining fine on the baseline.
    // Nothing starts before z=5 in any chunk. That floor is what guarantees a
    // real run-out after a ramp landing: the runway chunk ends at the boundary,
    // so the next obstacle's offset is the last part of the gap.
    obstacles: [
      { kind: 'woodpile', lane: 0, z: 5 },
      { kind: 'woodpile', lane: 1, z: 12 },
      { kind: 'woodpile', lane: 2, z: 19 },
    ],
    coins: [
      { lane: 1, z: 4, count: 3 },
      { lane: 2, z: 11, count: 3 },
      { lane: 0, z: 18, count: 3 },
    ],
  },

  // --- Ramps over chalets ---------------------------------------------------
  // The chalet lane is always escapable by steering; the ramp is the greedy
  // line, paid for in coins. Solvability never depends on hitting a ramp.
  // Each chalet sits exactly TUNING.ramp.chaletGap (11m) past its ramp - the
  // apex of the flight. `tests/ramp.test.ts` enforces that relationship.
  //
  // Ramps are spread across all three lanes, and that spread is deliberate
  // rather than incidental. Authored in centre-lane variants only, the ramp
  // stopped being a decision: it was always straight ahead, so the greedy line
  // never cost the player a lane change and the outer lanes never held the
  // reward. `tests/ramp.test.ts` asserts every lane can launch you.
  {
    id: 'chalet-hop',
    tier: 1,
    weight: 8,
    obstacles: [{ kind: 'chalet', lane: 1, z: 15 }],
    ramps: [{ lane: 1, z: 4 }],
    coins: [{ lane: 1, z: 5, count: 9, spacing: 1.8, rampFrom: 4 }],
  },
  {
    id: 'chalet-hop-left',
    tier: 1,
    weight: 8,
    obstacles: [{ kind: 'chalet', lane: 0, z: 15 }],
    ramps: [{ lane: 0, z: 4 }],
    coins: [{ lane: 0, z: 5, count: 9, spacing: 1.8, rampFrom: 4 }],
  },
  {
    id: 'chalet-hop-right',
    tier: 1,
    weight: 8,
    obstacles: [{ kind: 'chalet', lane: 2, z: 15 }],
    ramps: [{ lane: 2, z: 4 }],
    coins: [{ lane: 2, z: 5, count: 9, spacing: 1.8, rampFrom: 4 }],
  },
  {
    id: 'chalet-pair',
    tier: 2,
    weight: 7,
    obstacles: [
      { kind: 'chalet', lane: 1, z: 15 },
      { kind: 'chalet', lane: 2, z: 15 },
    ],
    ramps: [{ lane: 1, z: 4 }],
    coins: [{ lane: 1, z: 5, count: 9, spacing: 1.8, rampFrom: 4 }],
  },
  {
    id: 'chalet-pair-outer',
    tier: 2,
    weight: 7,
    // The same wall as `chalet-pair`, launched from the outer chalet instead of
    // the inner one. Steering out to lane 0 is still the safe answer, so the
    // choice is a lane change towards the reward or away from it.
    obstacles: [
      { kind: 'chalet', lane: 1, z: 15 },
      { kind: 'chalet', lane: 2, z: 15 },
    ],
    ramps: [{ lane: 2, z: 4 }],
    coins: [{ lane: 2, z: 5, count: 9, spacing: 1.8, rampFrom: 4 }],
  },
  {
    id: 'chalet-pair-left',
    tier: 2,
    weight: 7,
    // Mirror of the pair, so this tier does not quietly favour one side the way
    // the whole ramp set used to favour the centre.
    obstacles: [
      { kind: 'chalet', lane: 0, z: 15 },
      { kind: 'chalet', lane: 1, z: 15 },
    ],
    ramps: [{ lane: 0, z: 4 }],
    coins: [{ lane: 0, z: 5, count: 9, spacing: 1.8, rampFrom: 4 }],
  },
  {
    id: 'chalet-flanks',
    tier: 2,
    weight: 7,
    // The only chalet pair with the centre left open. Every other one puts a
    // chalet in the middle lane, which is what kept this tier leaning inward
    // even after the rest of the library had been spread out.
    obstacles: [
      { kind: 'chalet', lane: 0, z: 15 },
      { kind: 'chalet', lane: 2, z: 15 },
    ],
    ramps: [{ lane: 0, z: 4 }],
    coins: [
      { lane: 0, z: 5, count: 9, spacing: 1.8, rampFrom: 4 },
      { lane: 1, z: 12, count: 4 },
    ],
  },
  {
    id: 'village-street',
    tier: 3,
    weight: 7,
    obstacles: [
      { kind: 'chalet', lane: 0, z: 15 },
      { kind: 'chalet', lane: 2, z: 15 },
    ],
    // Both chalets get a launch pad, so the street reads as a street rather
    // than as one ramp and one wall - and it keeps this tier from leaning to
    // the side the single ramp happened to be on.
    ramps: [
      { lane: 0, z: 4 },
      { lane: 2, z: 4 },
    ],
    coins: [
      { lane: 0, z: 5, count: 9, spacing: 1.8, rampFrom: 4 },
      { lane: 2, z: 5, count: 9, spacing: 1.8, rampFrom: 4 },
      { lane: 1, z: 10, count: 4 },
    ],
  },

  // --- Grind rails ----------------------------------------------------------
  // The other optional route. A ramp is a commitment - hit it and you fly a
  // fixed arc. A rail is held: you mount it by *sliding* into the near end, it
  // carries you up for as long as you stay in its lane, and steering off drops
  // you. Riding past one without sliding does nothing, so like the ramp it is
  // never part of the solvability guarantee.
  //
  // The obstacles under a rail are the point of it: they are what a rider is
  // being carried over, and what someone who misses the mount has to steer
  // around instead. Every one of them leaves another lane open.
  {
    id: 'rail-run',
    tier: 1,
    weight: 8,
    // Rail from z=2 to z=20. The boulder sits under the last stretch, where the
    // bar is high enough to carry a rider clear over it - see the clearance
    // check in `tests/rail.test.ts`.
    obstacles: [{ kind: 'boulder', lane: 1, z: 18 }],
    rails: [{ lane: 1, z: 2 }],
    coins: [{ lane: 1, z: 3, count: 10, spacing: 1.7, railFrom: 2 }],
  },
  {
    id: 'rail-run-left',
    tier: 1,
    weight: 8,
    obstacles: [{ kind: 'boulder', lane: 0, z: 18 }],
    rails: [{ lane: 0, z: 2 }],
    coins: [{ lane: 0, z: 3, count: 10, spacing: 1.7, railFrom: 2 }],
  },
  {
    id: 'rail-run-right',
    tier: 1,
    weight: 8,
    obstacles: [{ kind: 'boulder', lane: 2, z: 18 }],
    rails: [{ lane: 2, z: 2 }],
    coins: [{ lane: 2, z: 3, count: 10, spacing: 1.7, railFrom: 2 }],
  },
  {
    id: 'rail-over-woodpile',
    tier: 2,
    weight: 7,
    // A taller thing to clear, and a second blocked lane, so bailing off the
    // rail leaves exactly one way through rather than two.
    obstacles: [
      { kind: 'woodpile', lane: 1, z: 19 },
      { kind: 'boulder', lane: 0, z: 19 },
    ],
    rails: [{ lane: 1, z: 2 }],
    coins: [{ lane: 1, z: 3, count: 10, spacing: 1.7, railFrom: 2 }],
  },

  // --- Tier 3: sustained pressure -------------------------------------------
  {
    id: 'gauntlet',
    tier: 3,
    weight: 8,
    // The forced jump sits at z=5 rather than z=4 so that when this chunk
    // follows one ending in a slide at z=15, the two actions are still 10m
    // apart across the chunk boundary.
    obstacles: [
      { kind: 'boulder', lane: 0, z: 5 },
      { kind: 'log', lane: 1, z: 5 },
      { kind: 'boulder', lane: 2, z: 5 },
      { kind: 'banner', lane: 1, z: 15 },
    ],
    coins: [{ lane: 1, z: 4, count: 4, arc: true }],
  },
  {
    id: 'zigzag',
    tier: 3,
    weight: 8,
    // Also 7m spacing, for the same reason as `staircase`.
    obstacles: [
      { kind: 'boulder', lane: 0, z: 5 },
      { kind: 'boulder', lane: 1, z: 12 },
      { kind: 'boulder', lane: 2, z: 19 },
      { kind: 'drift', lane: 0, z: 19 },
    ],
    coins: [
      { lane: 2, z: 4, count: 3 },
      { lane: 0, z: 11, count: 3 },
    ],
  },
  {
    id: 'double-wall',
    tier: 3,
    weight: 7,
    // Both rows seal every lane, so both force an action - the only chunk where
    // that happens twice. Spread as far apart as the chunk allows, because the
    // jump has to finish before the slide can start.
    obstacles: [
      { kind: 'log', lane: 0, z: 5 },
      { kind: 'log', lane: 1, z: 5 },
      { kind: 'log', lane: 2, z: 5 },
      { kind: 'banner', lane: 0, z: 17 },
      { kind: 'banner', lane: 1, z: 17 },
      { kind: 'banner', lane: 2, z: 17 },
    ],
    coins: [{ lane: 1, z: 4, count: 4, arc: true }],
  },
];

/** Chunks eligible at a given tier - everything unlocked so far. */
export function chunksForTier(tier: number): ChunkTemplate[] {
  return CHUNKS.filter((chunk) => chunk.tier <= tier);
}

/**
 * A chunk with nothing that can kill you. These double as the landing runway
 * the spawner lays after a ramp, so a player committed to a 22 metre flight
 * always comes down onto clear track.
 */
export function isRunway(chunk: ChunkTemplate): boolean {
  return chunk.obstacles.length === 0;
}

/** Runways are drawn from regardless of tier - a landing must always be safe. */
export function runwayChunks(): ChunkTemplate[] {
  return CHUNKS.filter(isRunway);
}

/**
 * Positions in a chunk where the player is *forced* to jump or slide.
 *
 * A row forces an action when no lane is left open - the player cannot simply
 * steer around it. Two forced rows too close together are impossible however
 * well the player reads them, since the first action has to finish before the
 * second can start, so the spawner keeps them apart across chunk boundaries.
 *
 * Rows where one lane is clear are not forced: steering is always an option.
 */
function computeForcedActionRows(chunk: ChunkTemplate): number[] {
  const byRow = new Map<number, ChunkObstacle[]>();
  for (const obstacle of chunk.obstacles) {
    // Obstacles within a metre and a half of each other are one decision.
    const key = Math.round(obstacle.z / 1.5);
    const bucket = byRow.get(key) ?? [];
    bucket.push(obstacle);
    byRow.set(key, bucket);
  }

  const forced: number[] = [];
  for (const row of byRow.values()) {
    const lanes = new Set(row.map((obstacle) => obstacle.lane));
    if (lanes.size < LANES.length) continue; // a lane is open - steer instead

    const needsAction = row.some((obstacle) => obstacleDef(obstacle.kind).action !== 'dodge');
    if (needsAction) forced.push(Math.min(...row.map((obstacle) => obstacle.z)));
  }

  return forced.sort((a, b) => a - b);
}

/** Static data, so this is computed once per chunk. */
const forcedRowCache = new Map<string, number[]>();

export function forcedActionRows(chunk: ChunkTemplate): number[] {
  let rows = forcedRowCache.get(chunk.id);
  if (!rows) {
    rows = computeForcedActionRows(chunk);
    forcedRowCache.set(chunk.id, rows);
  }
  return rows;
}

/**
 * Every position in a chunk where the player has something to react to.
 *
 * Unlike {@link forcedActionRows}, this counts *all* obstacle rows, including
 * the ones with a lane left open. Steering around a row is still a decision the
 * player has to see, make and execute, and at speed that is where the real
 * difficulty lives: a chunk whose rows sit seven metres apart gives under two
 * tenths of a second between them at top speed, which no one can play.
 */
function computeDecisionRows(chunk: ChunkTemplate): number[] {
  const byRow = new Map<number, number[]>();
  for (const obstacle of chunk.obstacles) {
    // Same 1.5 m bucketing the solvability check uses, so both agree on what
    // counts as one row.
    const key = Math.round(obstacle.z / 1.5);
    const bucket = byRow.get(key) ?? [];
    bucket.push(obstacle.z);
    byRow.set(key, bucket);
  }

  return [...byRow.values()].map((zs) => Math.min(...zs)).sort((a, b) => a - b);
}

/** Static data, so this is computed once per chunk. */
const decisionRowCache = new Map<string, number[]>();

export function decisionRows(chunk: ChunkTemplate): number[] {
  let rows = decisionRowCache.get(chunk.id);
  if (!rows) {
    rows = computeDecisionRows(chunk);
    decisionRowCache.set(chunk.id, rows);
  }
  return rows;
}

/**
 * The tightest spacing between two decision rows inside this chunk, in metres.
 *
 * Infinite for a chunk with fewer than two rows - there is nothing to crowd.
 * The spawner divides this by the current speed to decide whether a chunk is
 * still playable at the pace the run has reached.
 */
export function minRowGap(chunk: ChunkTemplate): number {
  const rows = decisionRows(chunk);
  let smallest = Number.POSITIVE_INFINITY;
  for (let i = 1; i < rows.length; i++) {
    smallest = Math.min(smallest, (rows[i] as number) - (rows[i - 1] as number));
  }
  return smallest;
}

/** Chunk-relative z of the first decision row, or null if the chunk is clear. */
export function firstRowZ(chunk: ChunkTemplate): number | null {
  const rows = decisionRows(chunk);
  return rows.length > 0 ? (rows[0] as number) : null;
}

/** Chunk-relative z of the last decision row, or null if the chunk is clear. */
export function lastRowZ(chunk: ChunkTemplate): number | null {
  const rows = decisionRows(chunk);
  return rows.length > 0 ? (rows[rows.length - 1] as number) : null;
}

/** The furthest a rail in this chunk starts, or null if it has none. */
export function furthestRailZ(chunk: ChunkTemplate): number | null {
  if (!chunk.rails || chunk.rails.length === 0) return null;
  return chunk.rails.reduce((furthest, rail) => Math.max(furthest, rail.z), -Infinity);
}

/** The furthest a ramp in this chunk reaches, or null if it has none. */
export function furthestRampZ(chunk: ChunkTemplate): number | null {
  if (!chunk.ramps || chunk.ramps.length === 0) return null;
  return chunk.ramps.reduce((furthest, ramp) => Math.max(furthest, ramp.z), -Infinity);
}

/**
 * Reflects a lane across the centre of the track: 0 <-> 2, 1 unchanged.
 *
 * This is the only symmetry a three-lane track has, and it is what makes
 * mirroring a chunk safe. Lane *adjacency* is what every guarantee in the
 * generator rests on - a lane change is one step, and crossing the track is two
 * - and a reflection preserves it exactly. Solvability, forced rows, decision
 * rows and row spacing are therefore identical for a chunk and its mirror, so
 * the spawner can flip one on a coin toss without re-checking anything.
 *
 * An arbitrary permutation would not do: swapping lanes 0 and 1 would turn a
 * one-step dodge into a two-step one and quietly break the solvability proof.
 */
export function mirrorLane(lane: LaneIndex): LaneIndex {
  return (LANES.length - 1 - lane) as LaneIndex;
}

/** Applies {@link mirrorLane} only when `mirror` is set. */
export function laneOf(lane: LaneIndex, mirror: boolean): LaneIndex {
  return mirror ? mirrorLane(lane) : lane;
}

export interface PlacedObstacleSpec {
  kind: ObstacleKind;
  lane: LaneIndex;
  /** Absolute distance along the track. */
  z: number;
}

export interface PlacedCoinSpec {
  lane: LaneIndex;
  z: number;
  /** Height above the snow. */
  y: number;
}

/** Places a chunk's obstacles at absolute track distances. */
export function expandObstacles(
  chunk: ChunkTemplate,
  startZ: number,
  mirror = false,
): PlacedObstacleSpec[] {
  return chunk.obstacles.map((obstacle) => ({
    kind: obstacle.kind,
    lane: laneOf(obstacle.lane, mirror),
    z: startZ + obstacle.z,
  }));
}

/**
 * Places a chunk's coin runs at absolute track distances.
 *
 * An arced run bows upward along a half sine, so the run traces roughly the
 * path of a jump - the coins are the reward for jumping rather than a separate
 * thing to chase.
 */
export function expandCoins(
  chunk: ChunkTemplate,
  startZ: number,
  baseHeight: number,
  arcPeak: number,
  defaultSpacing: number,
  mirror = false,
): PlacedCoinSpec[] {
  const out: PlacedCoinSpec[] = [];

  for (const run of chunk.coins) {
    const spacing = run.spacing ?? defaultSpacing;
    for (let i = 0; i < run.count; i++) {
      const localZ = run.z + i * spacing;

      let y: number;
      if (run.railFrom !== undefined) {
        // Sits a little above the bar, where the rider's feet are.
        y = baseHeight + railHeightAt(localZ - run.railFrom);
      } else if (run.rampFrom !== undefined) {
        // Follow the real ramp flight path, so the coins sit where a launched
        // player actually passes.
        y = baseHeight + rampArcHeight(localZ - run.rampFrom);
      } else if (run.arc) {
        // A single-coin run has no arc to trace, so it sits at base height.
        const t = run.count > 1 ? i / (run.count - 1) : 0;
        y = baseHeight + arcPeak * Math.sin(Math.PI * t);
      } else {
        y = baseHeight;
      }

      out.push({ lane: laneOf(run.lane, mirror), z: startZ + localZ, y });
    }
  }

  return out;
}
