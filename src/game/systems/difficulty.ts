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
