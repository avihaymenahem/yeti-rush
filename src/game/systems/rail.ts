/**
 * Grind rail geometry, as pure functions.
 *
 * The single source of truth for the shape of a rail, shared by the player
 * physics (which rides it), the coin authoring (which decorates it), the
 * renderer (which draws it) and the tests.
 *
 * A rail is a **level** steel bar running down the track, at a fixed height off
 * the snow, and it is mounted by *jumping onto it* - a skate rail, not a ramp.
 * The first version rose from ankle height to nearly four metres and was ridden
 * onto at the low end, which made it a lift dressed up as a rail: it carried the
 * player over things rather than asking anything of them, and the one input
 * everybody tries at a rail - ollie onto it - was not how you got on.
 *
 * Because it is level, height is a constant rather than a function of distance,
 * and the speed-invariance the sloped version needed so carefully is free.
 */

import { TUNING } from '@/game/config/tuning';

/**
 * Height of the bar above the snow.
 *
 * Takes an argument only so callers read the same way they did when this varied
 * along the rail's length, and so a test can ask about a hypothetical rail.
 */
export function railHeight(height: number = TUNING.rail.height): number {
  return height;
}

/**
 * The height an obstacle must be under for a grinding player to clear it.
 *
 * Exists so tests assert what a rail actually gets you over rather than a number
 * someone typed in. A level rail clears very little - which is the point. It is
 * a route worth taking for what it pays, not for what it rescues you from.
 */
export function railClearance(): number {
  return railHeight();
}

/**
 * Seconds between leaving the end of a rail and touching down.
 *
 * A plain fall from the bar: no pop, because the exit is a dismount rather than
 * a launch. Defined in *time*, so the ground it covers grows with speed - which
 * is why the landing has to be protected by a distance computed at the fastest
 * the game can go rather than by a constant someone eyeballed.
 */
export function railExitAirTime(): number {
  const { gravity, fallGravityMultiplier } = TUNING.player;
  return Math.sqrt((2 * railHeight()) / (gravity * fallGravityMultiplier));
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
