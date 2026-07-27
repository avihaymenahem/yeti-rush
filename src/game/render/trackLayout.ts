/**
 * Shared track geometry constants and the scroll-wrap helper.
 *
 * Lives outside the component files so obstacles, coins and scenery can all
 * agree on where the world starts, ends and recycles.
 */

import { TUNING } from '@/game/config/tuning';
import { PALETTE } from '@/game/config/visuals';

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
