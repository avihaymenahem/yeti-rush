/**
 * Track solvability validation.
 *
 * This is what stops the classic endless-runner bug: a stretch of track with no
 * way through it. It is cheap to author one by accident, impossible to spot by
 * eye at 30 units/second, and it reads to the player as the game cheating.
 *
 * The model is deliberately *conservative*: it may reject a stretch a expert
 * player could scrape through, but it must never pass one that is genuinely
 * impossible. Erring the other way would defeat the point.
 *
 * Two constraints are checked:
 *  1. Steering  - reaching lane B from lane A needs `laneChangeDuration` of
 *                 travel per lane crossed.
 *  2. Actions   - a jump or a slide commits the player for a moment, so two
 *                 action-requiring obstacles cannot be stacked back to back.
 * A `dodge` obstacle is simply an impassable lane.
 */

import { LANES, TUNING, type LaneIndex } from '@/game/config/tuning';
import type { ClearAction } from '@/game/content/obstacles';

const LANE_COUNT = LANES.length;

export interface PlacedObstacle {
  lane: LaneIndex;
  /** Absolute distance along the track. */
  z: number;
  action: ClearAction;
}

/** Obstacles close enough together to be a single decision point. */
export interface ObstacleRow {
  z: number;
  /** Required action per lane; null means the lane is clear. */
  lanes: (ClearAction | null)[];
}

export interface SolvabilityOptions {
  /** World speed to validate at. The fastest speed is the hardest case. */
  speed: number;
  laneChangeDuration?: number;
  /**
   * Seconds the player is committed after a jump or slide. A jump can be cut
   * short with a dive and a slide can be cancelled by jumping, so this is much
   * shorter than a full jump arc.
   */
  minActionSeconds?: number;
  /** Obstacles within this many metres form one row. */
  rowTolerance?: number;
  /** Run-up available before the first row, for steering into position. */
  entryRunUp?: number;
}

export interface SolvabilityResult {
  solvable: boolean;
  /** Lane to be in at each row, when solvable. */
  path: LaneIndex[] | null;
  /** Index of the first unreachable row, when not solvable. */
  failedRow: number | null;
  rows: ObstacleRow[];
}

/**
 * Seconds the player is committed after a jump or slide.
 *
 * Exported so the track generator can enforce the same spacing it is going to
 * be judged against - if the two ever disagreed, the generator would happily
 * produce track the validator then rejects.
 */
export const DEFAULT_MIN_ACTION_SECONDS = 0.3;

const DEFAULTS = {
  minActionSeconds: DEFAULT_MIN_ACTION_SECONDS,
  rowTolerance: 1.5,
  entryRunUp: 20,
};

/** Groups obstacles into decision rows, ordered along the track. */
export function buildRows(
  obstacles: readonly PlacedObstacle[],
  tolerance: number = DEFAULTS.rowTolerance,
): ObstacleRow[] {
  if (obstacles.length === 0) return [];

  const sorted = [...obstacles].sort((a, b) => a.z - b.z);
  const rows: ObstacleRow[] = [];

  for (const obstacle of sorted) {
    const last = rows[rows.length - 1];
    if (last && obstacle.z - last.z <= tolerance) {
      last.lanes[obstacle.lane] = obstacle.action;
    } else {
      const lanes: (ClearAction | null)[] = new Array(LANE_COUNT).fill(null);
      lanes[obstacle.lane] = obstacle.action;
      rows.push({ z: obstacle.z, lanes });
    }
  }

  return rows;
}

/**
 * Can a player get through this stretch?
 *
 * Dynamic programming over (row, lane). The value carried forward is the
 * distance at which the last action was spent - smaller is strictly better,
 * because it leaves more room before the next action - so keeping only the
 * minimum per lane is sufficient and the search stays linear in rows.
 */
export function checkSolvable(
  obstacles: readonly PlacedObstacle[],
  options: SolvabilityOptions,
): SolvabilityResult {
  const laneChangeDuration = options.laneChangeDuration ?? TUNING.player.laneChangeDuration;
  const minActionSeconds = options.minActionSeconds ?? DEFAULTS.minActionSeconds;
  const rowTolerance = options.rowTolerance ?? DEFAULTS.rowTolerance;
  const entryRunUp = options.entryRunUp ?? DEFAULTS.entryRunUp;

  const rows = buildRows(obstacles, rowTolerance);
  if (rows.length === 0) return { solvable: true, path: [], failedRow: null, rows };

  const laneChangeDistance = laneChangeDuration * options.speed;
  const minActionGap = minActionSeconds * options.speed;
  // Floating-point slack, so a gap that exactly equals the requirement passes.
  const EPS = 1e-6;

  const UNREACHABLE = Number.POSITIVE_INFINITY;
  /** lastActionZ per lane for the current row; +Infinity means unreachable. */
  let current: number[] = new Array(LANE_COUNT).fill(UNREACHABLE);
  const parents: number[][] = [];

  // Entry: any lane the player can steer into before the first row.
  const firstRow = rows[0] as ObstacleRow;
  const entryReach = firstRow.z + entryRunUp;
  for (let lane = 0; lane < LANE_COUNT; lane++) {
    const action = firstRow.lanes[lane];
    if (action === 'dodge') continue;
    // Worst case the player enters at the far lane and must cross the track.
    if ((LANE_COUNT - 1) * laneChangeDistance > entryReach + EPS) continue;
    current[lane] = action ? firstRow.z : Number.NEGATIVE_INFINITY;
  }

  if (current.every((value) => value === UNREACHABLE)) {
    return { solvable: false, path: null, failedRow: 0, rows };
  }

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] as ObstacleRow;
    const previous = rows[i - 1] as ObstacleRow;
    const gap = row.z - previous.z;
    const maxShift = Math.floor(gap / laneChangeDistance + EPS);

    const next: number[] = new Array(LANE_COUNT).fill(UNREACHABLE);
    const parent: number[] = new Array(LANE_COUNT).fill(-1);

    for (let from = 0; from < LANE_COUNT; from++) {
      const lastActionZ = current[from] as number;
      if (lastActionZ === UNREACHABLE) continue;

      for (let to = 0; to < LANE_COUNT; to++) {
        if (Math.abs(to - from) > maxShift) continue;

        const action = row.lanes[to];
        if (action === 'dodge') continue;

        let candidate: number;
        if (!action) {
          candidate = lastActionZ;
        } else {
          // Needs a jump or slide here - is the previous one far enough back?
          if (row.z - lastActionZ < minActionGap - EPS) continue;
          candidate = row.z;
        }

        if (candidate < (next[to] as number)) {
          next[to] = candidate;
          parent[to] = from;
        }
      }
    }

    if (next.every((value) => value === UNREACHABLE)) {
      return { solvable: false, path: null, failedRow: i, rows };
    }

    parents.push(parent);
    current = next;
  }

  // Walk the parent chain back from whichever final lane is cheapest.
  let bestLane = 0;
  for (let lane = 1; lane < LANE_COUNT; lane++) {
    if ((current[lane] as number) < (current[bestLane] as number)) bestLane = lane;
  }

  const path: LaneIndex[] = new Array(rows.length);
  path[rows.length - 1] = bestLane as LaneIndex;
  for (let i = rows.length - 1; i > 0; i--) {
    const parent = parents[i - 1] as number[];
    path[i - 1] = parent[path[i] as number] as LaneIndex;
  }

  return { solvable: true, path, failedRow: null, rows };
}

/** Convenience wrapper for tests and tooling. */
export function isSolvable(
  obstacles: readonly PlacedObstacle[],
  options: SolvabilityOptions,
): boolean {
  return checkSolvable(obstacles, options).solvable;
}
