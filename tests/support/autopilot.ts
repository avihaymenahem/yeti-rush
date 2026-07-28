/**
 * A headless player, for assertions that need a run actually played.
 *
 * Some questions cannot be answered by inspecting generated track. "How often
 * does a near miss happen" depends on where the player *is* when an obstacle
 * goes past, which depends on when they steered, which depends on the track.
 * The only honest way to measure it is to play, so this plays.
 *
 * Deliberately a competent-but-plain player, not an optimal one: it reads one
 * lookahead window, takes the calmest lane and jumps or slides when it must.
 * That is roughly what a real player does and, importantly, it is what the
 * generator's reaction-pacing floor is built to accommodate. An optimal solver
 * would report rates no human could reproduce, which would make every threshold
 * derived from it wrong in the same direction.
 *
 * No randomness of its own - the run's seed is the only variable, so a
 * surprising measurement can always be replayed.
 */

import { LANES, TUNING, type LaneIndex } from '@/game/config/tuning';
import { obstacleDef } from '@/game/content/obstacles';
import type { RuntimeState } from '@/game/state/runtime';
import { requestLaneChange } from '@/game/systems/lanes';
import { isGrounded, requestJump, requestSlide } from '@/game/systems/player';
import { tickRun } from '@/game/systems/simulation';
import { worldZOf } from '@/game/systems/spawner';

/** Seconds of track the pilot considers when choosing a lane. */
const PLAN_SECONDS = 1.1;
/** Seconds before contact that a jump or slide is committed. */
const ACT_SECONDS = 0.32;

type Action = 'dodge' | 'jump' | 'slide';

interface Hazard {
  lane: LaneIndex;
  /** Distance ahead of the player, in world units. Always positive. */
  ahead: number;
  action: Action;
  /** Stable identity, so a decision is taken once per obstacle, not per tick. */
  key: string;
}

export interface AutopilotOptions {
  /**
   * Fluff one jump in every N, so the pilot trips over low obstacles.
   *
   * A deliberately clumsy player, and the only way to measure anything about
   * stumbles over real track: a pilot that jumps everything never trips, so it
   * can say nothing at all about what happens when you do. Counted rather than
   * randomised, because the run's seed has to remain the only variable.
   */
  fluffEveryNthJump?: number;
}

export interface AutopilotResult {
  /** Distance reached, in world units. */
  distance: number;
  /** Whether the pilot was still alive when the target distance arrived. */
  survived: boolean;
  nearMisses: number;
  /** Obstacles passed, near or not. The denominator for a near-miss rate. */
  passed: number;
  stumbles: number;
  /** How the run ended, or null if it did not. */
  deathCause: string | null;
}

/** Everything the pilot has to answer for, ahead of the player, nearest first. */
function hazardsAhead(rt: RuntimeState, horizon: number): Hazard[] {
  const found: Hazard[] = [];

  for (const obstacle of rt.track.obstacles) {
    if (!obstacle.active) continue;
    const ahead = -worldZOf(obstacle.trackZ, rt.distance);
    if (ahead <= 0 || ahead > horizon) continue;
    found.push({
      lane: obstacle.lane,
      ahead,
      action: obstacleDef(obstacle.kind).action,
      key: `o${obstacle.lane}:${obstacle.trackZ.toFixed(2)}`,
    });
  }

  for (const rail of rt.track.rails) {
    if (!rail.active) continue;
    // The near end is what has to be cleared; the bar runs back from there.
    const ahead = -worldZOf(rail.trackZ, rt.distance);
    if (ahead <= 0 || ahead > horizon) continue;
    // Riding into a rail on the ground ends the run, and the only answer is to
    // jump - so to a pilot it is a jump hazard like any low obstacle.
    found.push({
      lane: rail.lane,
      ahead,
      action: 'jump',
      key: `r${rail.lane}:${rail.trackZ.toFixed(2)}`,
    });
  }

  found.sort((a, b) => a.ahead - b.ahead);
  return found;
}

/** How far ahead each lane is clear, capped at the horizon. */
function laneClearance(hazards: readonly Hazard[], horizon: number): number[] {
  const clearance = LANES.map(() => horizon);
  for (const hazard of hazards) {
    // Only impassable things make a lane worth leaving. A low barrier is
    // answered by jumping, and treating it as a wall would have the pilot
    // swerving across the track for something it could have hopped.
    if (hazard.action !== 'dodge') continue;
    if (hazard.ahead < (clearance[hazard.lane] as number)) clearance[hazard.lane] = hazard.ahead;
  }
  return clearance;
}

/**
 * Plays until `metres` or death, whichever comes first.
 *
 * The runtime is driven directly rather than through the run controller, so
 * nothing here touches the store, the save or any platform module.
 */
export function runAutopilot(
  rt: RuntimeState,
  metres: number,
  options: AutopilotOptions = {},
): AutopilotResult {
  const step = TUNING.sim.step;
  const fluff = options.fluffEveryNthJump ?? 0;
  /*
   * One verdict per obstacle, remembered.
   *
   * Deciding per tick does not work and looks like it does: an obstacle sits in
   * the action window for a dozen ticks, so "skip this one" only skipped a
   * frame and the jump fired on the next. The pilot cleared everything, the
   * measurement showed zero stumbles at every clumsiness setting, and the
   * numbers were identical across all of them - which is what gave it away.
   */
  const verdicts = new Map<string, boolean>();
  let jumpsSeen = 0;
  rt.running = true;

  // Guard on both: `tickRun` returns immediately once the run is over, so a
  // distance-only loop spins for ever the moment the pilot makes a mistake.
  while (rt.alive && rt.distance < metres) {
    const horizon = rt.speed * PLAN_SECONDS;
    const hazards = hazardsAhead(rt, horizon);
    const clearance = laneClearance(hazards, horizon);

    // Steering. Prefer where we are; move one lane at a time towards whichever
    // neighbour is calmer, and only when the current lane is genuinely blocked
    // sooner than it can be crossed.
    const lane = rt.lane.targetLane;
    const crossing = rt.speed * TUNING.player.laneChangeDuration;
    if ((clearance[lane] as number) < crossing * 2) {
      let best = lane;
      for (const candidate of [lane - 1, lane + 1]) {
        if (candidate < 0 || candidate >= LANES.length) continue;
        if ((clearance[candidate] as number) > (clearance[best] as number)) {
          best = candidate as LaneIndex;
        }
      }
      if (best !== lane) requestLaneChange(rt.lane, best > lane ? 1 : -1);
    }

    // Jumping and sliding. Only for the lane being ridden into, and only once
    // it is close enough that the action still covers the obstacle when it
    // arrives - committing a jump a second early lands the player straight back
    // on top of it.
    const act = rt.speed * ACT_SECONDS;
    for (const hazard of hazards) {
      if (hazard.lane !== rt.lane.targetLane || hazard.ahead > act) continue;
      if (hazard.action === 'jump') {
        let jumpIt = verdicts.get(hazard.key);
        if (jumpIt === undefined) {
          jumpsSeen++;
          jumpIt = !(fluff > 0 && jumpsSeen % fluff === 0);
          verdicts.set(hazard.key, jumpIt);
        }
        if (jumpIt && isGrounded(rt.player)) requestJump(rt.player, false);
      }
      if (hazard.action === 'slide') requestSlide(rt.player);
      break;
    }

    tickRun(rt, step);
  }

  let passed = 0;
  for (const obstacle of rt.track.obstacles) if (obstacle.passed) passed++;

  return {
    distance: rt.distance,
    survived: rt.alive,
    nearMisses: rt.nearMisses,
    // Entities are pooled and recycled, so this counts what is still in the
    // pool rather than everything ever laid. Fine as a denominator for a rate
    // measured over the same window, and never used as an absolute.
    passed,
    stumbles: rt.stumbles,
    deathCause: rt.deathCause,
  };
}
