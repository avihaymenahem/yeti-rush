/**
 * Grind rail geometry, as pure functions.
 *
 * The single source of truth for the shape of a rail, shared by the player
 * physics (which rides it), the coin authoring (which decorates it), the
 * renderer (which draws it) and the tests. If any of those computed the slope
 * themselves the coins would drift off the rail the first time it was retuned.
 *
 * Parameterised by *distance along the rail*, never by time - exactly like the
 * ramp arc, and for the same reason. A rail defined in seconds would carry the
 * player to a different height at 16 u/s than at 36, so a rail authored to clear
 * a boulder would stop clearing it as the run sped up.
 */

import { TUNING } from '@/game/config/tuning';

/**
 * Height of the rail `distanceAlong` metres from its near end.
 *
 * A straight line, because a rail is a straight steel bar. Clamped at both ends
 * so a caller that overshoots gets the end height rather than an extrapolation
 * off into the sky.
 */
export function railHeightAt(
  distanceAlong: number,
  length: number = TUNING.rail.length,
  baseHeight: number = TUNING.rail.baseHeight,
  rise: number = TUNING.rail.rise,
): number {
  if (distanceAlong <= 0) return baseHeight;
  if (distanceAlong >= length) return baseHeight + rise;
  return baseHeight + rise * (distanceAlong / length);
}

/** Height at the far end - where the player is released. */
export function railTopHeight(
  baseHeight: number = TUNING.rail.baseHeight,
  rise: number = TUNING.rail.rise,
): number {
  return baseHeight + rise;
}

/**
 * The height an obstacle must be under for a rider on the rail to clear it,
 * `distanceAlong` metres in.
 *
 * Exists so tests can assert what a rail actually gets you over rather than
 * asserting a number someone typed in.
 */
export function railClearanceAt(distanceAlong: number): number {
  return railHeightAt(distanceAlong);
}

/**
 * Seconds between being thrown off the end of a rail and touching down.
 *
 * The exit is a real ballistic fall from the top of the rail, and unlike the
 * ramp arc it is defined in *time*, so the ground it covers grows with speed.
 * That is exactly why the landing has to be protected by distance computed at
 * the fastest the game can go rather than by a constant someone eyeballed.
 */
export function railExitAirTime(): number {
  const { gravity, fallGravityMultiplier } = TUNING.player;
  const launch = TUNING.rail.exitVelocity;

  // Rises against normal gravity, falls against the heavier fall gravity.
  const riseTime = launch / gravity;
  const apex = railTopHeight() + (launch * launch) / (2 * gravity);
  const fallTime = Math.sqrt((2 * apex) / (gravity * fallGravityMultiplier));
  return riseTime + fallTime;
}

/**
 * Metres covered between leaving the end of a rail and landing, at a speed.
 *
 * A player in this stretch is committed: they can still steer, but they cannot
 * jump or slide, so anything needing either is unanswerable, and a row that
 * seals every lane is fatal however well they read it. The spawner keeps this
 * span clear - see `clearUntil`.
 */
export function railLandingDistance(speed: number): number {
  return railExitAirTime() * speed;
}
