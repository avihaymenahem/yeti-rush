/**
 * Camera framing maths.
 *
 * The outer lanes are the constraint. A phone in portrait has a very narrow
 * horizontal field of view (a 19.5:9 screen is about 0.46 aspect), and a fixed
 * camera distance that frames the track nicely on a desktop leaves the player
 * clipped off the edge of the screen in the outer lane on a phone.
 *
 * So the distance is derived from the aspect ratio rather than hard-coded, and
 * the derivation is pure so it can be unit-tested across the device matrix.
 */

import { LANES, TUNING } from '@/game/config/tuning';

/** Half of the visible width, in world units, at `distance` from the camera. */
export function horizontalHalfExtentAt(distance: number, fovDegrees: number, aspect: number): number {
  const halfVertical = (fovDegrees * Math.PI) / 360;
  return distance * Math.tan(halfVertical) * aspect;
}

/** The camera distance at which `halfExtent` world units are just visible. */
export function distanceForHalfExtent(
  halfExtent: number,
  fovDegrees: number,
  aspect: number,
): number {
  const halfVertical = (fovDegrees * Math.PI) / 360;
  return halfExtent / (Math.tan(halfVertical) * aspect);
}

/**
 * How much half-width the camera has to show for the player to stay fully on
 * screen in the outermost lane.
 *
 * The camera only follows `laneFollow` of the lane offset, so the player's
 * worst-case offset within the frame is the remaining fraction.
 */
export function requiredHalfExtent(): number {
  let outermost = 0;
  for (const x of LANES) outermost = Math.max(outermost, Math.abs(x));

  return (
    outermost * (1 - TUNING.camera.laneFollow) + TUNING.player.halfWidth + TUNING.camera.edgeMargin
  );
}

/**
 * Camera distance for a given viewport aspect (width / height).
 * Wide screens fall back to `minDistance` - pulling further back than needed
 * just makes the player small and the track hard to read.
 */
export function cameraDistanceFor(aspect: number): number {
  if (!Number.isFinite(aspect) || aspect <= 0) return TUNING.camera.minDistance;

  return Math.max(
    TUNING.camera.minDistance,
    distanceForHalfExtent(requiredHalfExtent(), TUNING.camera.fov, aspect),
  );
}
