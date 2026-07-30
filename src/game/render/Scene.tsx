/**
 * Scene assembly and the camera rig.
 *
 * Deliberately cheap: exactly one shadow-casting light, no environment map, no
 * render-target post-processing. A shadow pass is affordable here only because
 * the player never moves, so the shadow camera is a small fixed box rather than
 * a frustum chasing a character - see `SHADOW`. The grade is a DOM overlay
 * rather than a fullscreen pass (see `.grade` in index.css) so it costs the 3D
 * pipeline nothing at all.
 *
 * What does the visual work instead is hue: a warm key against cool ambient and
 * a cool fill, a graded sky with a sun in it, and layered mountains for depth.
 *
 * The rig below is the other half of the look, and the part that is easiest to
 * get wrong: what the camera is *allowed* to do is written down in
 * `CAMERA_FEEL`, and the short version is that framing may change and position
 * may not. Read that block before adding anything to `CameraRig`.
 */

import { useFrame } from '@react-three/fiber';
import { lazy, Suspense, useRef } from 'react';
import type * as THREE from 'three';
import { TUNING } from '@/game/config/tuning';
import { ATMOSPHERE, CAMERA_FEEL, PALETTE } from '@/game/config/visuals';
import { damp } from '@/game/core/math';
import { CarveTrail } from '@/game/render/CarveTrail';
import { Chaser } from '@/game/render/Chaser';
import { CoinField } from '@/game/render/CoinField';
import { Fences } from '@/game/render/Fences';
import { GameLoop } from '@/game/render/GameLoop';
import { LandingMark } from '@/game/render/LandingMark';
import { Lighting } from '@/game/render/Lighting';
import { Markers } from '@/game/render/Markers';
import { Mountains } from '@/game/render/Mountains';
import { carve01, lateralSpeed } from '@/game/render/nearField';
import { Obstacles } from '@/game/render/Obstacles';
import { Pickups } from '@/game/render/Pickups';
import { PlatformBridge } from '@/game/render/PlatformBridge';
import { Player } from '@/game/render/Player';
import { Rails } from '@/game/render/Rails';
import { Ramps } from '@/game/render/Ramps';
import { Sky } from '@/game/render/Sky';
import { Snow } from '@/game/render/Snow';
import { SnowSpray } from '@/game/render/SnowSpray';
import { Track } from '@/game/render/Track';
import { Village } from '@/game/render/Village';
import { runtime } from '@/game/state/runtime';
import { cameraDistanceFor, speedFovFor } from '@/game/systems/camera';
import { feedback } from '@/game/systems/feedback';

/**
 * The perf overlay is reached only through this dynamic import, inside a branch
 * `import.meta.env.DEV` folds to `false` in production. That is what keeps
 * `r3f-perf` (~220 kB) out of the shipped bundle - a static import would ship
 * it to every player for a tool none of them can open.
 */
const PerfOverlay = import.meta.env.DEV ? lazy(() => import('@/game/render/PerfOverlay')) : null;

const DEGREES = Math.PI / 180;

/**
 * Chase camera. It follows the player's lane only partially - a camera locked
 * to the player makes the lane change invisible, because nothing moves
 * relative to the frame - and it pulls back far enough that the outer lanes
 * stay on screen at the current aspect ratio and the current lens.
 *
 * **It does not translate for anything that happens *to* the player.** There
 * used to be a rumble that built as the patrol closed in and a punch on every
 * crash and landing; both are gone because they were hated, and a camera that
 * moves on its own is the one thing this rig must not do. What is allowed is
 * *framing* - the field of view may change, because the edges of the frame
 * stretch while nothing the player is aiming at moves. See `CAMERA_FEEL`.
 *
 * The lens is now driven from two independent channels that must not be
 * confused with each other:
 *
 * - the **speed lens**, a slow widening across the run, which the dolly tracks;
 * - the **punch**, a sharp additive impulse off `feedback.rush`, which the dolly
 *   must never see. Wiring the punch into the distance turns a five degree
 *   framing kick into a camera lurch of over a metre, which is exactly the
 *   banned shake arriving through the back door.
 */
function CameraRig() {
  /**
   * The damped speed lens, held apart from `camera.fov` because `camera.fov`
   * also carries the punch. Damping the sum towards a target that does not
   * include the punch would drag every impulse straight back out again, and the
   * two channels would fight over the same number sixty times a second.
   */
  const speedFovRef = useRef<number>(TUNING.camera.fov);

  // The camera comes from the frame state rather than `useThree` - this rig
  // only ever mutates it imperatively, so there is nothing to subscribe to.
  useFrame(({ camera, size }, delta) => {
    const aspect = size.width / size.height;
    const perspective = camera as THREE.PerspectiveCamera;

    /*
     * Lens first, distance second, and that order is the fix rather than a
     * tidy-up. The old rig derived the pull-back from `TUNING.camera.fov` - the
     * *base* lens - while widening the live one, so it framed for a lens it was
     * not rendering with and did it from the previous frame's value. Two
     * dampers at different rates (position lambda 1e-4, tau ~0.11 s; fov 2e-2,
     * tau ~0.25 s) were left disagreeing about the same visual quantity.
     */
    let speedFov = speedFovRef.current;
    if (perspective.isPerspectiveCamera) {
      speedFov = damp(speedFov, speedFovFor(runtime.speed), 0.02, delta);
      speedFovRef.current = speedFov;

      // Additive, and additive is what makes it safe: `horizontalHalfExtentAt`
      // increases with fov, so a widening impulse can only ever show *more* of
      // the track than the outer-lane guarantee was proved against.
      const nextFov = speedFov + feedback.rush * CAMERA_FEEL.punchDegrees;
      if (Math.abs(nextFov - perspective.fov) > 0.001) {
        perspective.fov = nextFov;
        perspective.updateProjectionMatrix();
      }
    }

    const targetX = runtime.lane.x * TUNING.camera.laneFollow;
    camera.position.x = damp(camera.position.x, targetX, 0.0001, delta);

    // Rise a little with the player so a jump does not leave the frame.
    const targetY = TUNING.camera.height + runtime.player.y * TUNING.camera.jumpFollow;
    camera.position.y = damp(camera.position.y, targetY, 0.0001, delta);

    /*
     * Recomputed per frame so a rotation or split-screen resize reframes
     * immediately; it is a handful of arithmetic ops.
     *
     * The target reads the **speed lens only** - see the note above - so the
     * dolly glides in across a run and ignores every punch.
     *
     * The clamp underneath it reads the **live** lens, and it is the framing
     * guarantee stated directly: the frame being rendered must show
     * `requiredHalfExtent()` of track, and that is exactly
     * `z >= cameraDistanceFor(aspect, renderedFov)`. It can only ever push the
     * camera *back*, so it cannot produce a lurch towards the player - and
     * because the punch only widens, it goes slack during one rather than
     * fighting it. What it does catch is the transient the old code let
     * through: a lens still damping down while the dolly has already arrived,
     * and an aspect that changed on this frame rather than over a quarter of a
     * second, both of which used to leave the outer lane briefly off screen.
     */
    const targetZ = cameraDistanceFor(aspect, speedFov);
    const dampedZ = damp(camera.position.z, targetZ, 0.0001, delta);
    camera.position.z = Math.max(dampedZ, cameraDistanceFor(aspect, perspective.fov));

    /*
     * Lane-change roll, and the only camera *movement* in the game.
     *
     * The recorded objection is narrower than "the camera must not move": shake
     * was tried on crashes, landings, near misses and patrol pressure, all
     * things that happen *to* the player. This is driven by the swipe, so the
     * player caused every degree of it, and it ends when the lane change does.
     * It is still the camera moving, so it ships behind `rollDegrees` and that
     * constant ships at zero - at which point the expression below is exactly
     * the identity `(0, 1, 0)` and costs a sine and a cosine.
     *
     * Driven from `carve01`, the same signed lateral speed `Player.tsx` leans
     * off, so the rider and the frame are guaranteed in phase. Not the
     * remaining lane travel the proposal suggested: that is maximal on the
     * frame the swipe lands, so the roll would arrive as a step, and a step in
     * camera roll is precisely the "the camera moved on its own" read this
     * project has already been burnt by. `6t(1-t)` starts at zero, peaks
     * mid-travel and returns to zero as the ease completes.
     *
     * `camera.up` is set *before* `lookAt`, which is the whole mechanism.
     * `lookAt` rebuilds the rotation from scratch out of position, target and
     * up, so any roll written afterwards is silently discarded - which is why
     * this rig has never rolled, and it was a side effect rather than a
     * decision.
     */
    const control = runtime.board.control;
    const roll =
      Math.sign(lateralSpeed(runtime.lane, control)) *
      carve01(runtime.lane, control) *
      CAMERA_FEEL.rollDegrees *
      DEGREES;
    camera.up.set(-Math.sin(roll), Math.cos(roll), 0);

    camera.lookAt(
      runtime.lane.x * TUNING.camera.laneFollow * 0.5,
      TUNING.camera.lookAtHeight,
      TUNING.camera.lookAheadZ,
    );
  });

  return null;
}

/*
 * The contact blob that used to live here has gone, and `LandingMark` is what
 * replaced it. Recorded because it looks like something was simply deleted.
 *
 * It was a translucent disc under the player that *faded out* as they rose -
 * exactly the wrong end of the height range, since a grounded player already has
 * a real cast shadow directly beneath them and an airborne one has nothing. It
 * was also, measurably, doing almost nothing where it did draw: it composited
 * `PALETTE.snowShadow` at 0.32, and that hex is an *albedo*, so through an unlit
 * basic material and ACES it reaches the screen at luminance 149 - **brighter
 * than the lit piste at 144.5**. Over the piste it lightened the snow by 1.4
 * levels and over the untouched field it was worth 5.1, against the 70 the key
 * light's own contact shadow delivers. Retiring it is what pays for the mark.
 */

export function Scene() {
  return (
    <>
      {/* Insurance behind the sky dome. Without an explicit background the
          renderer clears to black, which is what shows through if the dome is
          ever clipped or fails to compile. */}
      <color attach="background" args={[PALETTE.fog]} />

      {/* Exponential-squared, so the falloff is gentle nearby and closes in
          hard at distance - linear fog puts a visible band across the slope. */}
      <fogExp2 attach="fog" args={[PALETTE.fog, ATMOSPHERE.fogDensity]} />

      <Lighting />
      <Sky />
      <Mountains />

      <CameraRig />
      <GameLoop />
      <PlatformBridge />

      <Track />
      <Fences />
      {/* Beside the run rather than on it. The only thing in the scene that
          passes the camera, and the only continuous rate cue that works at the
          speed a run opens at. */}
      <Markers />
      <Village />
      <Ramps />
      <Rails />
      <Obstacles />
      <CoinField />
      <Pickups />
      <Chaser />
      <Player />
      {/* Marks in the snow, under everything that stands on it. All are
          `depthWrite: false`, so three.js draws them after the opaque pass
          whatever order they appear in here - the mark carries a negative
          `renderOrder` because it multiplies the framebuffer and so has to go
          first, before anything airborne is composited into it. */}
      <LandingMark />
      <CarveTrail />
      <SnowSpray />
      <Snow />

      {PerfOverlay && (
        <Suspense fallback={null}>
          <PerfOverlay />
        </Suspense>
      )}
    </>
  );
}
