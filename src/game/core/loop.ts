/**
 * Fixed-timestep accumulator.
 *
 * The simulation always advances in exact `step` increments regardless of the
 * render frame rate, so a 120 Hz iPad and a 60 Hz Android phone play
 * identically and a run is reproducible from its seed. Rendering interpolates
 * between the last two sim states using the returned `alpha`.
 */

import { TUNING } from '@/game/config/tuning';

export interface FixedTimestepOptions {
  /** Seconds per simulation tick. */
  step: number;
  /** A frame never contributes more than this many seconds to the accumulator. */
  maxFrameTime: number;
  /** Hard cap on ticks per frame; excess accumulated time is discarded. */
  maxStepsPerFrame: number;
}

export interface FixedTimestep {
  /**
   * Feeds one rendered frame's delta into the accumulator and runs however many
   * fixed ticks are due.
   *
   * @returns `alpha` in [0, 1) - how far the render sits between the previous
   *          and current sim state. Use it to interpolate visuals.
   */
  advance(frameDelta: number, tick: (step: number) => void): number;
  /** Drops accumulated time. Call on resume/restart so the sim never jumps. */
  reset(): void;
  /** Unconsumed accumulated seconds. Exposed for tests and debugging. */
  readonly pending: number;
  /** Fixed ticks run since creation (or since the last `reset`). */
  readonly ticks: number;
}

export const DEFAULT_TIMESTEP_OPTIONS: FixedTimestepOptions = {
  step: TUNING.sim.step,
  maxFrameTime: TUNING.sim.maxFrameTime,
  maxStepsPerFrame: TUNING.sim.maxStepsPerFrame,
};

export function createFixedTimestep(
  options: FixedTimestepOptions = DEFAULT_TIMESTEP_OPTIONS,
): FixedTimestep {
  const { step, maxFrameTime, maxStepsPerFrame } = options;

  if (step <= 0) throw new Error('createFixedTimestep: step must be > 0');
  if (maxStepsPerFrame < 1) throw new Error('createFixedTimestep: maxStepsPerFrame must be >= 1');

  let accumulator = 0;
  let ticks = 0;

  return {
    advance(frameDelta, tick) {
      // Negative or NaN deltas can come out of rAF across a tab suspend.
      if (!Number.isFinite(frameDelta) || frameDelta < 0) frameDelta = 0;

      // Clamping here is what prevents the spiral of death: after the app has
      // been backgrounded for a minute we run a few catch-up ticks, not 3600.
      accumulator += Math.min(frameDelta, maxFrameTime);

      let stepsThisFrame = 0;
      while (accumulator >= step && stepsThisFrame < maxStepsPerFrame) {
        tick(step);
        accumulator -= step;
        stepsThisFrame++;
        ticks++;
      }

      // Still behind after hitting the cap: drop the backlog rather than let it
      // grow forever. The sim runs slow for a frame; it never stalls.
      if (accumulator >= step) accumulator = 0;

      return accumulator / step;
    },

    reset() {
      accumulator = 0;
      ticks = 0;
    },

    get pending() {
      return accumulator;
    },

    get ticks() {
      return ticks;
    },
  };
}
