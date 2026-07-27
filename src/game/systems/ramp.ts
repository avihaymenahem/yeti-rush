/**
 * Ramp arc mathematics.
 *
 * The single source of truth for the shape of a ramp flight, shared by the
 * player physics (which flies it), the coin authoring (which decorates it) and
 * the tests (which check a chalet is actually clearable).
 *
 * The arc is parameterised by *distance*, not time. Solving it that way makes
 * it speed-invariant: the flight traces the same curve through the world at
 * 12 u/s and at 30 u/s, so a chalet placed to be clearable stays clearable for
 * the entire run. A time-based arc would shrink as the speed ramps up and
 * quietly turn every chalet into a wall.
 */

import { TUNING } from '@/game/config/tuning';

/**
 * Height of the arc `distanceFromRamp` metres past the launch point.
 *
 * Derived from the ballistic arc with `v0 = 4H/T` and `g = 8H/T²`: substituting
 * `t = d / speed` and `T = airDistance / speed` cancels speed entirely, leaving
 *     y(d) = 4H * u * (1 - u),  u = d / airDistance
 * which peaks at exactly `H` halfway along.
 */
export function rampArcHeight(
  distanceFromRamp: number,
  airDistance: number = TUNING.ramp.airDistance,
  peakHeight: number = TUNING.ramp.peakHeight,
): number {
  if (distanceFromRamp <= 0 || distanceFromRamp >= airDistance) return 0;
  const u = distanceFromRamp / airDistance;
  return 4 * peakHeight * u * (1 - u);
}

/** Flight duration at a given speed. */
export function rampAirTime(speed: number, airDistance: number = TUNING.ramp.airDistance): number {
  return airDistance / speed;
}

/** Launch velocity that produces the arc at a given speed. */
export function rampLaunchVelocity(
  speed: number,
  airDistance: number = TUNING.ramp.airDistance,
  peakHeight: number = TUNING.ramp.peakHeight,
): number {
  return (4 * peakHeight) / rampAirTime(speed, airDistance);
}

/** Gravity that produces the arc at a given speed. */
export function rampGravity(
  speed: number,
  airDistance: number = TUNING.ramp.airDistance,
  peakHeight: number = TUNING.ramp.peakHeight,
): number {
  const airTime = rampAirTime(speed, airDistance);
  return (8 * peakHeight) / (airTime * airTime);
}
