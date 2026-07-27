import { describe, expect, it } from 'vitest';
import { LANES, TUNING } from '@/game/config/tuning';
import {
  clampLane,
  createLaneState,
  isChangingLanes,
  laneToX,
  requestLaneChange,
  resetLaneState,
  stepLane,
} from '@/game/systems/lanes';

const STEP = TUNING.sim.step;

/** Runs the lane ease for `seconds`, exactly as the fixed-timestep loop would. */
function run(state: ReturnType<typeof createLaneState>, seconds: number): void {
  const ticks = Math.ceil(seconds / STEP);
  for (let i = 0; i < ticks; i++) stepLane(state, STEP);
}

describe('clampLane', () => {
  it('clamps outside the track rather than wrapping around', () => {
    expect(clampLane(-3)).toBe(0);
    expect(clampLane(0)).toBe(0);
    expect(clampLane(1)).toBe(1);
    expect(clampLane(2)).toBe(2);
    expect(clampLane(7)).toBe(2);
  });
});

describe('lane transitions', () => {
  it('starts settled in the centre lane', () => {
    const state = createLaneState();
    expect(state.targetLane).toBe(1);
    expect(state.x).toBe(laneToX(1));
    expect(isChangingLanes(state)).toBe(false);
  });

  it('arrives exactly on the lane centre within the configured duration', () => {
    const state = createLaneState();
    requestLaneChange(state, 1);
    run(state, TUNING.player.laneChangeDuration);
    expect(state.x).toBeCloseTo(laneToX(2), 6);
    expect(isChangingLanes(state)).toBe(false);
  });

  it('never overshoots the target lane', () => {
    const state = createLaneState();
    requestLaneChange(state, 1);
    const target = laneToX(2);
    for (let i = 0; i < 200; i++) {
      stepLane(state, STEP);
      expect(state.x).toBeLessThanOrEqual(target + 1e-9);
      expect(state.x).toBeGreaterThanOrEqual(laneToX(1) - 1e-9);
    }
  });

  it('moves monotonically towards the target', () => {
    const state = createLaneState();
    requestLaneChange(state, -1);
    let previous = state.x;
    for (let i = 0; i < 30; i++) {
      stepLane(state, STEP);
      expect(state.x).toBeLessThanOrEqual(previous + 1e-9);
      previous = state.x;
    }
  });

  it('refuses to move past the outer lanes and reports no change', () => {
    const state = createLaneState(0);
    expect(requestLaneChange(state, -1)).toBe(false);
    expect(state.targetLane).toBe(0);

    const right = createLaneState(2);
    expect(requestLaneChange(right, 1)).toBe(false);
    expect(right.targetLane).toBe(2);
  });

  it('crosses two lanes when swiped twice mid-transition', () => {
    const state = createLaneState(0);
    expect(requestLaneChange(state, 1)).toBe(true);
    run(state, TUNING.player.laneChangeDuration / 2);
    expect(requestLaneChange(state, 1)).toBe(true);
    expect(state.targetLane).toBe(2);

    run(state, TUNING.player.laneChangeDuration);
    expect(state.x).toBeCloseTo(laneToX(2), 6);
  });

  it('re-targets from the current position, so a reversal does not snap', () => {
    const state = createLaneState(1);
    requestLaneChange(state, 1);
    run(state, TUNING.player.laneChangeDuration / 2);
    const xAtReversal = state.x;

    requestLaneChange(state, -1);
    // The ease restarts from where the player actually is - no teleport.
    expect(state.startX).toBeCloseTo(xAtReversal, 9);
    expect(state.x).toBeCloseTo(xAtReversal, 9);
    expect(state.targetLane).toBe(1);

    run(state, TUNING.player.laneChangeDuration);
    expect(state.x).toBeCloseTo(laneToX(1), 6);
  });

  it('stays put when already settled and stepped further', () => {
    const state = createLaneState(2);
    run(state, 5);
    expect(state.x).toBe(laneToX(2));
  });

  it('resets back to a settled centre lane', () => {
    const state = createLaneState(0);
    requestLaneChange(state, 1);
    run(state, 0.05);
    resetLaneState(state);
    expect(state.x).toBe(laneToX(1));
    expect(state.targetLane).toBe(1);
    expect(isChangingLanes(state)).toBe(false);
  });

  it('keeps every lane centre reachable', () => {
    for (let lane = 0; lane < LANES.length; lane++) {
      expect(laneToX(lane as 0 | 1 | 2)).toBe(LANES[lane]);
    }
  });
});
