/**
 * The yeti.
 *
 * Animated procedurally: every joint angle is a function of simulation state -
 * lane offset, vertical velocity, motion, speed - so the pose is always exactly
 * consistent with the physics rather than a clip playing alongside it. Nothing
 * here reads or writes React state; the component renders once when the skin
 * changes and is mutated through refs thereafter.
 *
 * Geometry comes from `yetiGeometry.ts`, which merges each animated part into a
 * single vertex-coloured mesh so the whole character costs ten draw calls.
 *
 * The poses are snowboarding poses, not running ones. A runner's arm swing on a
 * board looks wrong immediately: a rider holds a wide, low, braced stance,
 * counter-rotates into a carve, and reaches for the board in the air.
 *
 * **Every base pose here has to be good with `speed01` at zero.** That term is
 * `(speed - start) / (max - start)`, and `TUNING.speed.start` *is* the speed a
 * run opens at - so it is identically zero for the first frame of every run and
 * still under 0.45 for the opening half-minute, which is the part every new
 * player judges the game on. Anything added on top of it is a bonus that most
 * of the play time never sees, never a pose that only arrives at 36 u/s.
 */

import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import type * as THREE from 'three';
import { TUNING } from '@/game/config/tuning';
import { RIDER } from '@/game/config/visuals';
import { clamp, clamp01, damp, lerp } from '@/game/core/math';
import { phasesThroughObstacles } from '@/game/content/powerUps';
import { characterDef } from '@/game/content/characters';
import { skinDef } from '@/game/content/skins';
import {
  buildYeti,
  FIGURE_SCALE,
  hipHeightFor,
  RIDING_LEG_PITCH,
  SCARF_LINK_LENGTH,
  YETI_JOINTS,
} from '@/game/render/yetiGeometry';
import { useCastShadows } from '@/game/render/useCastShadows';
import { useMetaStore } from '@/game/state/metaStore';
import { runtime } from '@/game/state/runtime';
import { laneToX } from '@/game/systems/lanes';

/** Metres of travel per full bob cycle. */
const BOB_WAVELENGTH = 7;

/**
 * Smoothing on the body roll, as the fraction of the gap left after a second.
 *
 * `1e-7` is a time constant of about 62 ms, quick enough that the roll is
 * essentially fully arrived by the end of a 0.15 s lane change and essentially
 * gone 0.15 s after it. It replaces `1e-4`, which is 109 ms - so the old lean
 * peaked as the lane change *ended* and was still bleeding off a fifth of a
 * second later, arriving after the moment it was meant to sell.
 */
const LEAN_DAMP = 1e-7;

/** Smoothing on the landing fold. ~87 ms, so a squash reads and then recovers. */
const IMPACT_DAMP = 1e-5;

/**
 * Fraction of the stance yaw the head cancels.
 *
 * The yaw lives on the torso group, so the head inherits all of it and would
 * spend the run looking across the piste. Cancelling most but not all of it
 * leaves the rider looking down the hill with the head slightly open, which is
 * what a boarder actually does - cancelling it exactly reads as a mannequin.
 */
const HEAD_COUNTER_STANCE = 0.7;

/** Resting angle of the arms off vertical, in radians, while riding. */
const ARM_SPREAD = 0.9;

/**
 * Fall speed treated as the hardest landing there is, in units per second.
 *
 * Deliberately not `jumpVelocity`. An ordinary hop launches at 13.3 u/s and
 * lands at about 15.5 - the fall gravity multiplier sees to that - so
 * normalising the landing fold by the launch would saturate it on every single
 * jump, and a ramp descent, which is where the fold is actually worth having,
 * would look identical to a hop.
 *
 * Taken from the ramp arc at top speed instead: the flight covers
 * `airDistance` metres, so it lasts `airDistance / speed` seconds, and a
 * symmetric arc peaking at `peakHeight` comes down at `4 * peakHeight` over
 * that. About 30 u/s, against 15.5 for a hop and 17.6 for a ramp taken at the
 * opening pace - which is the spread the fold is meant to show.
 */
const HARDEST_LANDING = (4 * TUNING.ramp.peakHeight * TUNING.speed.max) / TUNING.ramp.airDistance;

/**
 * How far the rider fades on the ghost board.
 *
 * Not to nothing. The player still has to be read at speed - which lane, how
 * high, mid-carve or not - and a rider you cannot see is a worse power-up than
 * no power-up. This is enough to say "solid things are going through me".
 */
const GHOST_OPACITY = 0.34;
/** Spectral tint multiplied over the skin's own colours while phasing. */
const GHOST_TINT = { r: 0.6, g: 0.85, b: 1 };
/** Seconds-ish smoothing on the fade, so the power-up arrives and leaves. */
const GHOST_DAMP = 4e-4;

/**
 * Fades and tints the rider, and stops them casting a shadow.
 *
 * The shadow matters more than it sounds. A translucent rider throwing a hard
 * black shadow across the snow reads as a rendering bug rather than a ghost -
 * the shadow is the one thing on screen still insisting they are solid.
 *
 * `transparent` and `castShadow` are only touched when they actually change.
 * The first rebuilds the shader program and the second walks the hierarchy, so
 * both are fine twice per pickup and wasteful sixty times a second.
 */
function applyGhost(root: THREE.Object3D, material: THREE.MeshPhongMaterial, amount: number): void {
  const wantsGhost = amount > 0.001;
  if (material.transparent !== wantsGhost) {
    material.transparent = wantsGhost;
    material.needsUpdate = true;
    root.traverse((node) => {
      if ((node as THREE.Mesh).isMesh) node.castShadow = !wantsGhost;
    });
  }

  material.opacity = 1 - amount * (1 - GHOST_OPACITY);
  material.color.setRGB(
    1 + (GHOST_TINT.r - 1) * amount,
    1 + (GHOST_TINT.g - 1) * amount,
    1 + (GHOST_TINT.b - 1) * amount,
  );
}

export function Player() {
  // Both are baked into the vertex colours, so changing either rebuilds the
  // geometry - once, on change, never per frame. Two subscriptions rather than
  // one on the whole save, so equipping a board does not rebuild the rider.
  const character = useMetaStore((state) => characterDef(state.save.equippedCharacter));
  const skin = useMetaStore((state) => skinDef(state.save.equippedSkin));
  const parts = useMemo(() => buildYeti(character, skin), [character, skin]);

  /*
   * One of the few genuine uses for an effect under this project's React rules:
   * external-system cleanup, not state synchronisation. `useMemo` builds a new
   * rig on every equip and simply drops the old one, and three frees nothing on
   * garbage collection - so without this the shop leaks a complete set of
   * geometries and a shader program per browse.
   *
   * React runs the cleanup for the previous `parts` before the effect for the
   * new one, which is exactly the order needed. StrictMode double-invokes it in
   * development, so the first mount disposes and immediately re-uses the same
   * rig; three re-uploads the buffers and recompiles the program on the next
   * frame, which costs a development-only hitch and nothing in a build.
   */
  useEffect(() => () => parts.dispose(), [parts]);

  const rootRef = useRef<THREE.Group>(null);
  useCastShadows(rootRef);
  const boardRef = useRef<THREE.Group>(null);
  const torsoRef = useRef<THREE.Group>(null);
  const headRef = useRef<THREE.Group>(null);
  const armLeftRef = useRef<THREE.Group>(null);
  const armRightRef = useRef<THREE.Group>(null);
  const legLeftRef = useRef<THREE.Group>(null);
  const legRightRef = useRef<THREE.Group>(null);
  // Named rather than an array: a ref array is read during render to be
  // attached, which is exactly what refs are not for.
  const scarf0Ref = useRef<THREE.Group>(null);
  const scarf1Ref = useRef<THREE.Group>(null);
  const scarf2Ref = useRef<THREE.Group>(null);
  const clockRef = useRef(0);
  /** 0 solid, 1 fully phased. Eased, so the board fades in and out. */
  const ghostRef = useRef(0);
  /** Downward speed carried from the last airborne frame, for the landing fold. */
  const fallSpeedRef = useRef(0);
  /** 0-1 landing impact, latched on touchdown and decaying out of the pose. */
  const impactRef = useRef(0);

  useFrame((_, delta) => {
    const root = rootRef.current;
    const board = boardRef.current;
    const torso = torsoRef.current;
    const head = headRef.current;
    const armLeft = armLeftRef.current;
    const armRight = armRightRef.current;
    const legLeft = legLeftRef.current;
    const legRight = legRightRef.current;
    if (!root || !board || !torso || !head || !armLeft || !armRight || !legLeft || !legRight) {
      return;
    }

    clockRef.current += delta;
    const { lane, player } = runtime;

    // Eased rather than switched, so the board arriving and expiring are both
    // moments the player sees rather than a single frame they miss.
    const ghostTarget = phasesThroughObstacles(runtime.powerUps) ? 1 : 0;
    const ghost = damp(ghostRef.current, ghostTarget, GHOST_DAMP, delta);
    // Snapped at the ends, so a settled material stops being written to.
    ghostRef.current = Math.abs(ghost - ghostTarget) < 0.004 ? ghostTarget : ghost;
    applyGhost(root, parts.material, ghostRef.current);

    const airborne = player.motion === 'airborne';
    const sliding = player.motion === 'sliding';
    const flying = player.motion === 'flying';
    const grinding = player.motion === 'grinding';
    const grounded = player.motion === 'running' || sliding;
    const inFlight = airborne || flying;
    const stumbling = runtime.stumbleTimer > 0;
    const speed01 = clamp01(
      (runtime.speed - TUNING.speed.start) / (TUNING.speed.max - TUNING.speed.start),
    );

    // --- Take-off and landing --------------------------------------------
    // 1 the instant the player leaves the ground, 0 at the apex and below. The
    // whole air pose keys off this rather than off `motion`, which is what
    // turns a snap into an anticipation: the old tuck was assigned the frame
    // `airborne` began and damped in at 1e-6, so it arrived roughly 0.14 s into
    // a 0.36 s rise - lag, dressed as easing.
    const rise = clamp01(player.vy / TUNING.player.jumpVelocity);

    // The other half. `stepPlayer` zeroes `vy` on the same tick it puts the
    // player back on the snow, so the speed they hit at has to be carried over
    // from the frame before - and it is worth carrying, because a ramp apex
    // arrives at roughly twice the speed of a hop and should not fold the same.
    if (inFlight) {
      fallSpeedRef.current = Math.max(0, -player.vy);
      impactRef.current = damp(impactRef.current, 0, IMPACT_DAMP, delta);
    } else {
      // Catching a rail is not a landing: the fall is interrupted, not
      // absorbed, so the stored speed is discarded rather than spent.
      if (grounded && fallSpeedRef.current > 0) {
        impactRef.current = clamp01(fallSpeedRef.current / HARDEST_LANDING);
      } else {
        impactRef.current = damp(impactRef.current, 0, IMPACT_DAMP, delta);
      }
      fallSpeedRef.current = 0;
    }

    // --- Carve -----------------------------------------------------------
    /*
     * Lateral speed in metres per second, from the analytic derivative of the
     * lane ease. `stepLane` interpolates with `smoothstep`, whose derivative is
     * 6t(1-t); dividing by the transition's duration turns progress-per-t into
     * metres per second, and `board.control` is in there because it is what
     * sets that duration in the simulation.
     *
     * A finite difference on `lane.x` between frames is the obvious version and
     * it is broken here: the simulation runs on a fixed-step accumulator that
     * is decoupled from rendered frames, so a frame with no tick due reports
     * zero lateral speed and a catch-up frame reports two or three ticks' worth
     * - a stutter on any device not locked to exactly 60 Hz. This form is
     * frame-rate independent, and it stays correct through a mid-transition
     * re-target because `requestLaneChange` rewrites `startX` and `t` together.
     */
    const laneDuration = TUNING.player.laneChangeDuration / Math.max(0.01, runtime.board.control);
    const lateral =
      lane.t >= 1
        ? 0
        : (6 * lane.t * (1 - lane.t) * (laneToX(lane.targetLane) - lane.startX)) / laneDuration;

    /*
     * The clamp does nearly all the work here, and that is intended. A single
     * lane change crosses 2.2 m in 0.15 s and 6t(1-t) peaks at 1.5, so it tops
     * out near 22 m/s sideways, against the 0.9 m/s at which `leanPerLateral`
     * already reaches `maxLean`. So the raw target is a square pulse lasting
     * exactly as long as the lane change, and the shape the player reads is
     * `LEAN_DAMP`'s attack and release around it - which is why that constant,
     * and not this one, is where the feel of a carve is tuned.
     */
    const lean = clamp(lateral * RIDER.leanPerLateral, -RIDER.maxLean, RIDER.maxLean);

    // --- Root ------------------------------------------------------------
    root.position.x = lane.x;
    root.position.y = player.y;
    root.position.z = TUNING.player.z;

    // Positive rotation.z tilts the top towards -x, so moving right needs -lean.
    root.rotation.z = damp(root.rotation.z, -lean, LEAN_DAMP, delta);

    // Everything else that answers a carve reads the *rolled* body rather than
    // recomputing from `lateral`, so the board yaw, the shoulders, the head and
    // the scarf are all in phase with the visible lean by construction instead
    // of by four separately tuned dampers happening to agree.
    const carve = clamp(-root.rotation.z / RIDER.maxLean, -1, 1);

    // A ramp flight is worth selling: spin the whole rider as they sail. A
    // grind twists the body the other way against the board thrown across the
    // rail below. The two cannot collide - a rail is only ever caught out of an
    // ordinary jump, never mid-ramp.
    const rootYaw = grinding
      ? RIDER.grindRootYaw
      : player.ramping
        ? clamp01(player.y / TUNING.ramp.peakHeight) * Math.PI * 0.75
        : 0;
    root.rotation.y = damp(root.rotation.y, rootYaw, 1e-4, delta);

    /*
     * Tricks. Assigned, never damped.
     *
     * `trickSpin` is an unwrapped accumulator that `stepTrick` already
     * integrates smoothly at 60 Hz, and `settleTricks` zeroes it in one tick on
     * touchdown. Damping towards it meant the renderer then had to unwind from
     * a multiple of 2*pi at a per-frame retention of 0.845: about 0.64 s to
     * rewind a single 360 and 1.2 s for a five-chain, played out as a visible
     * backwards somersault along the snow - on the payoff frame of the most
     * rewarding thing in the game, where the landing sound and the haptic both
     * fire. Assigned, the reset goes from k*2*pi to 0, which is the same
     * orientation and therefore invisible.
     */
    root.rotation.x = player.trickSpin;

    // --- Board -----------------------------------------------------------
    // Nose lifts on the way up and drops on the way down.
    const boardPitch = airborne ? clamp(-player.vy * 0.028, -0.45, 0.45) : 0;
    board.rotation.x = damp(board.rotation.x, boardPitch, 1e-5, delta);
    // Rolled onto its edge through a carve, which is where the grip comes from.
    // Flat on a rail: a boardslide is balanced on the base, not an edge.
    board.rotation.z = damp(board.rotation.z, grinding ? 0 : carve * 0.32, 1e-5, delta);
    /*
     * Swung across the direction of travel. Negative, because a positive yaw
     * about +Y takes the nose (which is -Z) towards -X - so carving right has
     * to point the nose right.
     *
     * On a rail it goes all the way across into a boardslide. `grinding` and
     * `isGrinding` returned zero hits anywhere under `render/` before this, so
     * fourteen to thirty metres of committed track - the mechanic with three
     * documented rounds of iteration behind it - drew the ordinary riding pose.
     */
    board.rotation.y = damp(
      board.rotation.y,
      grinding ? RIDER.grindBoardYaw : -carve * RIDER.boardYaw,
      1e-5,
      delta,
    );

    // --- Torso -----------------------------------------------------------
    // Crouch is driven off the collider height, so the silhouette always
    // matches what the collision system believes the player's shape is.
    const crouch = sliding ? TUNING.player.slideHalfHeight / TUNING.player.halfHeight : 1;
    // Extension off the lip and compression on touchdown, the two halves of a
    // landing that the pose never had.
    const stretch = 1 + RIDER.takeoffExtend * rise - RIDER.landingCompress * impactRef.current;
    // `FIGURE_SCALE` is in the target because the JSX sets it on all three axes
    // and this line used to overwrite Y with a bare `crouch` - literally 1 when
    // not sliding - so within ten frames of every run the figure was permanently
    // (0.92, 1, 0.92) and had been for the life of the project.
    torso.scale.y = damp(torso.scale.y, crouch * stretch * FIGURE_SCALE, 1e-8, delta);

    // Riding base is a real crouch on its own rather than a value that only
    // arrives at top speed; the speed term on top is a bonus. Standing tall off
    // the lip and folding at the apex is the same two-phase shape as the legs.
    const torsoPitch = sliding
      ? 0.95
      : inFlight
        ? lerp(0.26, 0.08, rise)
        : grinding
          ? 0.18
          : 0.3 + speed01 * 0.1;
    torso.rotation.x = damp(torso.rotation.x, torsoPitch, 1e-7, delta);
    // The resting stance across the board, plus the counter-rotation into a
    // carve - a rider's shoulders stay pointed down the hill while the board
    // swings across it, which is why this has the opposite sign to the board.
    torso.rotation.y = damp(torso.rotation.y, RIDER.stanceYaw + carve * 0.3, 1e-5, delta);

    // Subtle bob, keyed to distance rather than time so it speeds up with the
    // run automatically and never drifts out of step with the ground.
    const bob =
      inFlight || grinding ? 0 : Math.sin((runtime.distance / BOB_WAVELENGTH) * Math.PI * 2);
    // Hips follow the squash so the boots stay bolted to a board that has not
    // moved - see `FOOT_REACH` in `yetiGeometry`.
    torso.position.y = hipHeightFor(torso.scale.y) + bob * 0.022;

    // --- Head ------------------------------------------------------------
    // Keep the head roughly level however far the torso folds over, and look
    // into the turn - with most of the stance yaw cancelled, so the rider is
    // watching the track ahead rather than the trees to one side of it.
    head.rotation.x = damp(head.rotation.x, -torsoPitch * 0.75, 1e-7, delta);
    head.rotation.y = damp(
      head.rotation.y,
      -RIDER.stanceYaw * HEAD_COUNTER_STANCE - carve * 0.4,
      1e-5,
      delta,
    );

    // --- Arms ------------------------------------------------------------
    let armLeftX: number;
    let armRightX: number;
    let armLeftZ: number;
    let armRightZ: number;

    if (stumbling) {
      // Flailing, out of control, and deliberately unlike any other pose so a
      // trip is unmistakable.
      const flail = Math.sin(clockRef.current * 26);
      armLeftX = -1.5 + flail * 0.7;
      armRightX = -1.5 - flail * 0.7;
      armLeftZ = -1.1;
      armRightZ = 1.1;
    } else if (inFlight) {
      // Two phases of one movement. Off the lip the arms drive down and out
      // with the extension; the grab arrives as the rise bleeds away, which is
      // when a rider actually reaches for the board rather than at the instant
      // their feet leave the snow.
      armLeftX = lerp(1.15, -0.2, rise);
      armRightX = lerp(-0.55, -0.2, rise);
      armLeftZ = lerp(-0.35, -1.05, rise);
      armRightZ = lerp(1.0, 1.05, rise);
    } else if (grinding) {
      // Thrown out level. The widest thing the rider ever does, and the pose
      // that says "balanced on something narrow" without any sparks to help.
      armLeftX = -0.25;
      armRightX = -0.25;
      armLeftZ = -1.25;
      armRightZ = 1.25;
    } else if (sliding) {
      // Arms swept back along the body.
      armLeftX = -0.85;
      armRightX = -0.85;
      armLeftZ = -0.45;
      armRightZ = 0.45;
    } else {
      /*
       * Braced riding stance: wide, low, with a slight sway. Both arms shift
       * together into the carve rather than swinging in opposition.
       *
       * `ARM_SPREAD` is 0.9 rad, up from 0.42 - about 24 degrees off vertical,
       * which is not a stance, it is arms hanging. Width is the whole reason
       * this matters: at the ~150 px the rider occupies, a vertical blob and a
       * snowdrift are the same shape, and held-wide arms are what make the
       * outline a person.
       *
       * The ceiling on it is the neighbouring lane. Lanes are 2.2 apart and the
       * widest obstacle reaches 1.1 either side of its centre, so a hand past
       * about 1.1 from the player's own centre would visually touch something
       * in the next lane. At full spread and full carve the hand sits near 0.92
       * before the stance yaw foreshortens it, and under 0.7 after.
       */
      const sway = Math.sin((runtime.distance / BOB_WAVELENGTH) * Math.PI * 2) * 0.1;
      armLeftX = sway - 0.1;
      armRightX = -sway - 0.1;
      armLeftZ = -(ARM_SPREAD + Math.abs(carve) * 0.15) + carve * 0.3;
      armRightZ = ARM_SPREAD + Math.abs(carve) * 0.15 + carve * 0.3;
    }

    armLeft.rotation.x = damp(armLeft.rotation.x, armLeftX, 1e-6, delta);
    armRight.rotation.x = damp(armRight.rotation.x, armRightX, 1e-6, delta);
    armLeft.rotation.z = damp(armLeft.rotation.z, armLeftZ, 1e-6, delta);
    armRight.rotation.z = damp(armRight.rotation.z, armRightZ, 1e-6, delta);

    // --- Legs ------------------------------------------------------------
    // Extend off the lip, tuck at the apex, extend into a slide, stay bent
    // riding and stay bent on a rail.
    const legPitch = inFlight
      ? lerp(-0.7, 0.12, rise)
      : sliding
        ? -0.45
        : grinding
          ? 0.22
          : RIDING_LEG_PITCH + speed01 * 0.08;
    const legSplay = inFlight ? 0.12 : 0.05;
    legLeft.rotation.x = damp(legLeft.rotation.x, legPitch, 1e-6, delta);
    legRight.rotation.x = damp(legRight.rotation.x, legPitch, 1e-6, delta);
    legLeft.rotation.z = damp(legLeft.rotation.z, -legSplay, 1e-6, delta);
    legRight.rotation.z = damp(legRight.rotation.z, legSplay, 1e-6, delta);

    // --- Scarf -----------------------------------------------------------
    // A chain, each link lagging the one before it. Lag is the whole trick:
    // driving every link from the same target gives a rigid plank.
    const animateScarfLink = (link: THREE.Group | null, index: number) => {
      if (!link) return;

      const flutter = Math.sin(clockRef.current * 9 - index * 1.1) * (0.09 + speed01 * 0.12);

      // The scarf trails straight down the +Z axis - directly at the camera -
      // so left flat it foreshortens into a stub. Lifting it and swinging it
      // out to one side is what puts it across the frame where it can be seen.
      // Rotations compound down the chain, so each link only adds its share.
      // Kept shallow on purpose. Rotations compound down the chain, so a lift
      // that looks reasonable per link sends the tail arcing up over the head
      // and across the face by the third one.
      const lift = index === 0 ? -(0.2 + speed01 * 0.22) : -(0.11 + speed01 * 0.1);
      const bias = index === 0 ? 0.34 : 0.2;
      const sway = bias - carve * (index === 0 ? 0.6 : 0.35);

      // Later links respond more slowly, which is what produces the wave.
      const smoothing = index === 0 ? 1e-5 : 3e-3;
      link.rotation.x = damp(link.rotation.x, lift + flutter, smoothing, delta);
      link.rotation.y = damp(link.rotation.y, sway + flutter * 0.6, smoothing, delta);
    };

    animateScarfLink(scarf0Ref.current, 0);
    animateScarfLink(scarf1Ref.current, 1);
    animateScarfLink(scarf2Ref.current, 2);
  });

  const { material } = parts;

  return (
    <group ref={rootRef}>
      <group ref={boardRef} position={[...YETI_JOINTS.board]}>
        <mesh geometry={parts.board} material={material} />
      </group>

      {/* The stance yaw is set here as well as damped towards in the frame, so
          the very first frame of a run is already standing on the board rather
          than swinging into it over the opening fifth of a second. */}
      <group
        ref={torsoRef}
        position={[...YETI_JOINTS.hips]}
        rotation-y={RIDER.stanceYaw}
        scale={FIGURE_SCALE}
      >
        <mesh geometry={parts.torso} material={material} />

        <group
          ref={headRef}
          position={[...YETI_JOINTS.neck]}
          rotation-y={-RIDER.stanceYaw * HEAD_COUNTER_STANCE}
        >
          <mesh geometry={parts.head} material={material} />
        </group>

        <group ref={armLeftRef} position={[...YETI_JOINTS.shoulderLeft]}>
          <mesh geometry={parts.arm} material={material} />
        </group>
        <group ref={armRightRef} position={[...YETI_JOINTS.shoulderRight]}>
          <mesh geometry={parts.arm} material={material} />
        </group>

        <group ref={legLeftRef} position={[...YETI_JOINTS.hipLeft]}>
          <mesh geometry={parts.leg} material={material} />
        </group>
        <group ref={legRightRef} position={[...YETI_JOINTS.hipRight]}>
          <mesh geometry={parts.leg} material={material} />
        </group>

        {/* Nested, so each link inherits the swing of the one before it. */}
        <group ref={scarf0Ref} position={[...YETI_JOINTS.scarf]}>
          <mesh geometry={parts.scarf} material={material} />
          <group ref={scarf1Ref} position={[0, 0, SCARF_LINK_LENGTH]}>
            <mesh geometry={parts.scarf} material={material} />
            <group ref={scarf2Ref} position={[0, 0, SCARF_LINK_LENGTH]} scale={0.85}>
              <mesh geometry={parts.scarf} material={material} />
            </group>
          </group>
        </group>
      </group>
    </group>
  );
}
