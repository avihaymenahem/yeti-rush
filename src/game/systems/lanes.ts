/**
 * Lane positioning and the sideways ease between lanes.
 *
 * Design note - no input buffering. An early prototype queued a second swipe
 * until the first transition finished, which reads as lag. Instead a swipe
 * immediately re-targets and the ease restarts from the player's *current* x,
 * so a fast double-swipe crosses two lanes in one continuous motion and a
 * swipe-back mid-transition reverses instantly. There is no overshoot because
 * the ease always interpolates from where the player actually is.
 */

import { CENTRE_LANE, LANES, TUNING, type LaneIndex } from '@/game/config/tuning';
import { clamp, lerp, smoothstep } from '@/game/core/math';

export type LaneDirection = -1 | 1;

export interface LaneState {
  /** Current world X. This is the value the renderer reads. */
  x: number;
  /** Lane the player is easing towards. */
  targetLane: LaneIndex;
  /** X at the moment the current transition started. */
  startX: number;
  /** Transition progress in [0, 1]. */
  t: number;
}

export function laneToX(lane: LaneIndex): number {
  return LANES[lane];
}

/** Clamps to a valid lane index - the outer lanes are walls, not wrap-around. */
export function clampLane(lane: number): LaneIndex {
  return clamp(Math.round(lane), 0, LANES.length - 1) as LaneIndex;
}

export function createLaneState(lane: LaneIndex = CENTRE_LANE): LaneState {
  const x = laneToX(lane);
  return { x, targetLane: lane, startX: x, t: 1 };
}

export function resetLaneState(state: LaneState, lane: LaneIndex = CENTRE_LANE): void {
  state.x = laneToX(lane);
  state.targetLane = lane;
  state.startX = state.x;
  state.t = 1;
}

/**
 * Handles a swipe. Returns true if it changed the target lane - callers use
 * that to fire haptics and SFX, so a swipe into a wall stays silent.
 */
export function requestLaneChange(state: LaneState, direction: LaneDirection): boolean {
  const next = clampLane(state.targetLane + direction);
  if (next === state.targetLane) return false;

  state.startX = state.x;
  state.targetLane = next;
  state.t = 0;
  return true;
}

/**
 * Advances the sideways ease by one fixed sim step.
 *
 * @param controlScale - the equipped board's control stat. Above 1 steers
 *        faster. Never below 1: a slower lane change would make stretches of
 *        track unsolvable that the generator has already validated.
 */
export function stepLane(state: LaneState, dt: number, controlScale = 1): void {
  if (state.t >= 1) {
    state.x = laneToX(state.targetLane);
    return;
  }

  const duration = TUNING.player.laneChangeDuration / Math.max(0.01, controlScale);
  state.t = Math.min(1, state.t + dt / duration);
  state.x = lerp(state.startX, laneToX(state.targetLane), smoothstep(state.t));
}

/** True while the player is between lanes. */
export function isChangingLanes(state: LaneState): boolean {
  return state.t < 1;
}
