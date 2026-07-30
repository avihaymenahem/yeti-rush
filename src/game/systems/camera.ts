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
 *
 * The lens is the second half of the same sum and was missing from it for a
 * long time: the rig widens the field of view with speed, and a wider lens
 * needs *less* distance to show the same half-width. Everything here takes the
 * fov it is framing for rather than assuming the base one, so the rig can hold
 * the framing guarantee at every instant of the sweep rather than only at rest.
 */

import { LANES, TUNING } from '@/game/config/tuning';
import { speedProgress } from '@/game/systems/difficulty';

/** Half of the visible width, in world units, at `distance` from the camera. */
export function horizontalHalfExtentAt(
  distance: number,
  fovDegrees: number,
  aspect: number,
): number {
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
 * The lens the rig damps towards at a given world speed.
 *
 * Pure and here rather than inline in `CameraRig` for one reason: the framing
 * guarantee is a property of the `(fov, distance)` *pair*, and a test that has
 * to re-derive one half of it from a copy of the rig's arithmetic is not
 * testing the rig. Everything a frame is actually rendered with now comes out
 * of this file.
 *
 * `speedProgress` rather than the old `(speed - start) / (max - start)`: that
 * one is identically zero at `TUNING.speed.start`, so the cheapest speed cue in
 * the renderer contributed exactly nothing to the opening of every run. The
 * consequence is worth stating plainly, because it is surprising - the base
 * `TUNING.camera.fov` is now the lens at a *standstill* and is never rendered
 * during play. A run opens at about 65 degrees and tops out at 70.
 */
export function speedFovFor(speed: number): number {
  return TUNING.camera.fov + speedProgress(speed) * TUNING.camera.speedFovKick;
}

/**
 * Camera distance for a given viewport aspect (width / height) at a given lens.
 * Wide screens fall back to `minDistance` - pulling further back than needed
 * just makes the player small and the track hard to read.
 *
 * **The lens is a parameter, and that is the whole point.** This used to pass
 * `TUNING.camera.fov` unconditionally while the rig widened the *live* lens by
 * up to `speedFovKick` degrees on top of it. The distance therefore stayed put
 * while the frame stretched, which shows more world at the same range and so
 * makes the player **smaller** the faster the run gets - the wrong sign for the
 * one cue whose whole job is to say "faster". Passing the live lens dollies the
 * camera in as it widens, which holds the subject and spends the widening on
 * perspective instead: the near ground sweeps harder and the track converges
 * faster, which is what a wider lens is actually good for.
 *
 * A degenerate lens falls back to the base fov rather than to `minDistance`.
 * The aspect fallback can safely return the minimum because a degenerate aspect
 * has no framing to preserve, but a bad fov still has one - and `minDistance`
 * is *nearer* than the outer lanes need on a phone, so returning it would put
 * the player off the edge of the screen rather than merely mis-framed.
 */
export function cameraDistanceFor(aspect: number, fovDegrees: number = TUNING.camera.fov): number {
  if (!Number.isFinite(aspect) || aspect <= 0) return TUNING.camera.minDistance;

  const fov =
    Number.isFinite(fovDegrees) && fovDegrees > 0 && fovDegrees < 180
      ? fovDegrees
      : TUNING.camera.fov;

  return Math.max(
    TUNING.camera.minDistance,
    distanceForHalfExtent(requiredHalfExtent(), fov, aspect),
  );
}
