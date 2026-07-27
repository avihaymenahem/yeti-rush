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
 */

import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import type * as THREE from 'three';
import { LANES, TUNING } from '@/game/config/tuning';
import { clamp, clamp01, damp } from '@/game/core/math';
import { skinDef } from '@/game/content/skins';
import { buildYeti, SCARF_LINK_LENGTH, YETI_JOINTS } from '@/game/render/yetiGeometry';
import { useMetaStore } from '@/game/state/metaStore';
import { runtime } from '@/game/state/runtime';
import { laneToX } from '@/game/systems/lanes';

/** Radians of body lean per world unit still to travel sideways. */
const LEAN_PER_UNIT = 0.36;
const MAX_LEAN = 0.5;

/** Full lane spacing, used to normalise the carve into -1..1. */
const LANE_SPACING = Math.abs(LANES[1] - LANES[0]);

/** Metres of travel per full bob cycle. */
const BOB_WAVELENGTH = 7;

/** Overall size of the figure above the board. Tuned against the collider. */
const FIGURE_SCALE = 0.92;

export function Player() {
  // The equipped skin is baked into the vertex colours, so changing it rebuilds
  // the geometry - once, on change, never per frame.
  const skin = useMetaStore((state) => skinDef(state.save.equippedSkin));
  const parts = useMemo(() => buildYeti(skin), [skin]);

  const rootRef = useRef<THREE.Group>(null);
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

    const airborne = player.motion === 'airborne';
    const sliding = player.motion === 'sliding';
    const flying = player.motion === 'flying';
    const stumbling = runtime.stumbleTimer > 0;
    const speed01 = clamp01(
      (runtime.speed - TUNING.speed.start) / (TUNING.speed.max - TUNING.speed.start),
    );

    // How hard the rider is carving, as -1 (hard left) to 1 (hard right).
    const remaining = laneToX(lane.targetLane) - lane.x;
    const carve = clamp(remaining / (LANE_SPACING * 0.6), -1, 1);

    // --- Root ------------------------------------------------------------
    root.position.x = lane.x;
    root.position.y = player.y;
    root.position.z = TUNING.player.z;

    const lean = clamp(remaining * LEAN_PER_UNIT, -MAX_LEAN, MAX_LEAN);
    // Positive rotation.z tilts the top towards -x, so moving right needs -lean.
    root.rotation.z = damp(root.rotation.z, -lean, 0.0001, delta);

    // A ramp flight is worth selling: spin the whole rider as they sail.
    const spinTarget = player.ramping
      ? clamp01(player.y / TUNING.ramp.peakHeight) * Math.PI * 0.75
      : 0;
    root.rotation.y = damp(root.rotation.y, spinTarget, 1e-4, delta);

    // --- Board -----------------------------------------------------------
    // Nose lifts on the way up and drops on the way down.
    const boardPitch = airborne ? clamp(-player.vy * 0.028, -0.45, 0.45) : 0;
    board.rotation.x = damp(board.rotation.x, boardPitch, 1e-5, delta);
    // Rolled onto its edge through a carve, which is where the grip comes from.
    board.rotation.z = damp(board.rotation.z, carve * 0.32, 1e-5, delta);

    // --- Torso -----------------------------------------------------------
    // Crouch is driven off the collider height, so the silhouette always
    // matches what the collision system believes the player's shape is.
    const crouch = sliding ? TUNING.player.slideHalfHeight / TUNING.player.halfHeight : 1;
    torso.scale.y = damp(torso.scale.y, crouch, 1e-8, delta);

    // Tuck forward into a slide; ride progressively lower as speed builds.
    const torsoPitch = sliding ? 0.95 : airborne ? 0.26 : 0.1 + speed01 * 0.14;
    torso.rotation.x = damp(torso.rotation.x, torsoPitch, 1e-7, delta);
    // Counter-rotate the shoulders against the carve - a rider's upper body
    // stays pointed down the hill while the board swings across it.
    torso.rotation.y = damp(torso.rotation.y, carve * 0.3, 1e-5, delta);

    // Subtle bob, keyed to distance rather than time so it speeds up with the
    // run automatically and never drifts out of step with the ground.
    const bob = airborne || flying ? 0 : Math.sin((runtime.distance / BOB_WAVELENGTH) * Math.PI * 2);
    torso.position.y = YETI_JOINTS.hips[1] + bob * 0.022;

    // --- Head ------------------------------------------------------------
    // Keep the head roughly level however far the torso folds over, and look
    // into the turn.
    head.rotation.x = damp(head.rotation.x, -torsoPitch * 0.75, 1e-7, delta);
    head.rotation.y = damp(head.rotation.y, -carve * 0.4, 1e-5, delta);

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
    } else if (airborne || flying) {
      // Reach down for the board with the trailing hand and throw the other
      // arm up to counterbalance - the classic grab.
      armLeftX = 1.15;
      armRightX = -0.55;
      armLeftZ = -0.35;
      armRightZ = 1.0;
    } else if (sliding) {
      // Arms swept back along the body.
      armLeftX = -0.85;
      armRightX = -0.85;
      armLeftZ = -0.45;
      armRightZ = 0.45;
    } else {
      // Braced riding stance: wide, low, with a slight sway. Both arms shift
      // together into the carve rather than swinging in opposition.
      const sway = Math.sin((runtime.distance / BOB_WAVELENGTH) * Math.PI * 2) * 0.1;
      armLeftX = sway - 0.1;
      armRightX = -sway - 0.1;
      armLeftZ = -(0.42 + Math.abs(carve) * 0.3) + carve * 0.45;
      armRightZ = 0.42 + Math.abs(carve) * 0.3 + carve * 0.45;
    }

    armLeft.rotation.x = damp(armLeft.rotation.x, armLeftX, 1e-6, delta);
    armRight.rotation.x = damp(armRight.rotation.x, armRightX, 1e-6, delta);
    armLeft.rotation.z = damp(armLeft.rotation.z, armLeftZ, 1e-6, delta);
    armRight.rotation.z = damp(armRight.rotation.z, armRightZ, 1e-6, delta);

    // --- Legs ------------------------------------------------------------
    // Knees tuck up in the air, extend into a slide, and stay bent when riding.
    const legPitch = airborne || flying ? -0.7 : sliding ? -0.45 : 0.16 + speed01 * 0.12;
    const legSplay = airborne || flying ? 0.12 : 0.05;
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

      <group ref={torsoRef} position={[...YETI_JOINTS.hips]} scale={FIGURE_SCALE}>
        <mesh geometry={parts.torso} material={material} />

        <group ref={headRef} position={[...YETI_JOINTS.neck]}>
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
