/**
 * Shared track geometry constants and the scroll-wrap helper.
 *
 * Lives outside the component files so obstacles, coins and scenery can all
 * agree on where the world starts, ends and recycles.
 */

import { TUNING } from '@/game/config/tuning';
import { PALETTE } from '@/game/config/visuals';
import { createRng } from '@/game/core/rng';

export const TRACK_COLORS = {
  snow: PALETTE.snowLit,
  /** The groomed run itself, a shade cooler than the untouched field. */
  piste: PALETTE.piste,
  snowShade: PALETTE.pisteLine,
  laneGuide: PALETTE.snowShadow,
  pine: '#2f6b4f',
  trunk: '#5b4636',
} as const;

/** Z at which geometry appears - far enough out that the fog has closed in. */
export const SPAWN_Z = -TUNING.track.drawDistance;

/** Z past the camera at which geometry is recycled. */
export const RECYCLE_Z = TUNING.track.recycleBehind;

/** Total length of the recycling band. */
export const TRACK_SPAN = RECYCLE_Z - SPAWN_Z;

/** Centre of the band, for sizing static geometry that must cover all of it. */
export const TRACK_CENTRE_Z = (SPAWN_Z + RECYCLE_Z) / 2;

/**
 * Maps an object's fixed offset plus the distance travelled onto its current
 * Z within the visible band. The double modulo keeps it correct for negative
 * offsets, which is easy to get wrong and produces objects that never appear.
 */
export function wrapZ(offset: number, distance: number): number {
  return SPAWN_Z + ((((offset + distance) % TRACK_SPAN) + TRACK_SPAN) % TRACK_SPAN);
}

/* ------------------------------------------------------------------ *
 * The treeline.
 * ------------------------------------------------------------------ */

export interface PineInstance {
  x: number;
  zOffset: number;
  scale: number;
  rotation: number;
}

/** Nearest and furthest a pine may stand from the centreline, in metres. */
export const PINE_NEAR_X = 5.5;
export const PINE_FAR_X = 13;

/**
 * How large a pine standing `distance` metres out is drawn.
 *
 * The models are fitted to between 3.8 and 4.8 m, so this is a multiplier on a
 * roughly four-metre tree.
 *
 * Correlated with distance rather than rolled freely, and it is doing two jobs.
 * The far treeline is the only thing in the whole visual pass that puts
 * vertical mass in the mid-ground - at a flat roll it topped out around 6 m and
 * read as a smudge at 50 m, where the same trees at 10 m read as a wooded
 * flank rising away from the run. And it makes the *near* trees smaller than
 * they used to be, which is a straight win: a fence-adjacent pine could
 * previously roll a 1.35 scale and hang its canopy over the piste edge.
 *
 * Pines appear nowhere in `content/obstacles.ts` and have no collider, so the
 * grow-only rule that governs boulder art does not bind here.
 */
export function pineScaleFor(distance: number, roll: number): number {
  const out = (distance - PINE_NEAR_X) / (PINE_FAR_X - PINE_NEAR_X);
  // 0.9 by the fence, 2.25 out at the treeline edge, +/-15% of scatter so the
  // relation is a tendency rather than a rule anyone can see.
  return (0.9 + out * 1.35) * (0.85 + roll * 0.3);
}

/**
 * Deterministic scenery layout, shared by every pine variant.
 *
 * Each variant claims the instances whose index falls to it, so the three
 * models interleave along the treeline instead of one species filling one side.
 *
 * Sides are *clumped*, not alternated. `i % 2` gave perfect bilateral symmetry
 * at a 4.79 m pitch - the strongest procedural tell in the game, and free to
 * remove. Running one side for a few trees at a time is what a wood looks like;
 * the Z jitter had to widen with it, because consecutive same-side trees now
 * land 4.79 m apart where before they were 9.58 m apart and the pitch itself
 * would have become the new tell.
 */
export function pineLayout(count: number): PineInstance[] {
  // Fixed seed: the scenery layout is decorative and stable across runs.
  const rng = createRng(0x5eed);
  const out: PineInstance[] = [];

  let side = -1;
  let remaining = 0;

  for (let i = 0; i < count; i++) {
    if (remaining === 0) {
      remaining = 1 + rng.int(4);
      // Rolled rather than flipped: two runs on the same side in a row make a
      // stand, and a strict flip would put a hard rhythm back at a longer wave.
      side = rng.chance(0.5) ? -1 : 1;
    }
    remaining--;

    const distance = rng.range(PINE_NEAR_X, PINE_FAR_X);
    out.push({
      x: side * distance,
      zOffset: (i / count) * TRACK_SPAN + rng.range(-2.2, 2.2),
      scale: pineScaleFor(distance, rng.next()),
      rotation: rng.range(0, Math.PI * 2),
    });
  }

  return out;
}
