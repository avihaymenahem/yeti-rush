/**
 * Difficulty progression.
 *
 * World speed ramps on an ease-out curve: quick early acceleration so the run
 * stops feeling sluggish within a few seconds, then a long gentle approach to
 * the ceiling so late-run speed increases stay readable.
 */

import { TUNING } from '@/game/config/tuning';
import { clamp01, easeOutQuad, lerp } from '@/game/core/math';

/** Difficulty tiers, used to weight which track chunks may spawn. */
export const TIER_COUNT = 4;
export type DifficultyTier = 0 | 1 | 2 | 3;

/** Distance (world units) at which each tier unlocks. */
const TIER_THRESHOLDS = [0, 400, 1200, 2600] as const;

/**
 * World scroll speed after `elapsedSeconds` of running.
 * Monotonically increasing, and exactly `speed.max` at and after `rampSeconds`.
 */
export function speedAt(elapsedSeconds: number): number {
  const { start, max, rampSeconds } = TUNING.speed;
  const t = clamp01(elapsedSeconds / rampSeconds);
  return lerp(start, max, easeOutQuad(t));
}

/**
 * The run's pace as a fraction of the ceiling, for anything the *screen* does
 * about speed. The one canonical normalisation.
 *
 * There were three incompatible versions of this quantity in the renderer, and
 * what they disagreed about was the anchor rather than the formula. Two of them
 * divided by `(max - start)`, which makes them identically **zero at
 * `TUNING.speed.start`** - the speed every run opens at, the speed the ramp
 * spends its first seconds near, and, because `easeOutQuad` front-loads a 115 s
 * ramp most runs never finish, the condition a player spends most of their time
 * in. Every cue keyed off that contributed exactly nothing to the frame a new
 * player judges the game on. A cue that is dead at the opening speed is a cue
 * that does not exist, however well it reads in a screenshot taken at the top.
 *
 * So this anchors at a standing start instead, and the floor is derived rather
 * than invented: `speed / max` is the *same straight line through speed* the
 * old normalisation was, mapped onto `[start / max, 1]` instead of `[0, 1]`.
 * Zero means stopped, which is a real state; `start` is already 58% of the way
 * up, which is the honest description of a run that opens at 21 of a possible
 * 36. Consumers put their escalation in their own shaping - see `speedRush` in
 * `platform/screenFlash.ts` - not in pretending the opening is a standstill.
 *
 * {@link difficulty01} is deliberately *not* this and must not be routed
 * through it. That one weights chunk spawning and has to start at zero, because
 * tier 0 is where a player who has never played begins.
 */
export function speedProgress(speed: number): number {
  return clamp01(speed / TUNING.speed.max);
}

/** The hardest tier unlocked at this distance. */
export function tierAt(distance: number): DifficultyTier {
  let tier = 0;
  for (let i = TIER_THRESHOLDS.length - 1; i >= 0; i--) {
    if (distance >= (TIER_THRESHOLDS[i] as number)) {
      tier = i;
      break;
    }
  }
  return tier as DifficultyTier;
}

/**
 * Overall difficulty in [0, 1], driving obstacle density and spawn weights.
 * Tracks the speed ramp so a single curve governs how hard the run feels.
 */
export function difficulty01(elapsedSeconds: number): number {
  return clamp01(easeOutQuad(clamp01(elapsedSeconds / TUNING.speed.rampSeconds)));
}

/**
 * Seconds of running needed to have covered `distance` world units.
 * Analytic inverse would be messy for a piecewise-clamped curve, so this
 * integrates the speed curve numerically. Used only by tooling and tests.
 */
export function timeToReachDistance(distance: number, stepSeconds = 0.1): number {
  let covered = 0;
  let t = 0;
  while (covered < distance && t < TUNING.speed.rampSeconds * 10) {
    covered += speedAt(t) * stepSeconds;
    t += stepSeconds;
  }
  return t;
}
