/**
 * The ski patrol snowmobile.
 *
 * Shown only while the patrol is actually pressing, which is the point of the
 * mechanic - a permanently visible pursuer stops registering, whereas one that
 * arrives when you make a mistake and slides away when you run clean is read
 * instantly. What was broken was never that rule; it was that the machine was
 * drawn where nobody could see it. `chaserWorldZ` puts it at `player.z + 26`
 * against a camera at about `z = 8.96`, seventeen units *behind the eye*, and
 * `chaser.visible` is true from the first tick of every run because
 * `visibleWithin` (30) is above `restingDistance` (26). So the flag said "shown"
 * for the whole run while the object sat outside the frustum, and the only time
 * it ever appeared was an avalanche - where `stepAvalanche` pins the distance to
 * 5 on a single tick and the old renderer assigned `position.z` from it with no
 * damping. It did not close in, it materialised.
 *
 * Everything below is presentation. `ChaserState` carries a distance and a
 * visibility flag, `systems/collision.ts` never looks at the machine, and it
 * must never be given a collider - `systems/chaser.ts` is explicit that the
 * patrol never kills. So the simulation is untouched and the drawn pose is:
 *
 * - **Framed**, from the live camera and the live lens, not from the simulated
 *   distance. See `patrolDrawnZ`.
 * - **Over a shoulder**, never behind the head. See `patrolSideFor`.
 * - **Eased in**, over `PATROL.approachSeconds`, with the simulation's snap left
 *   exactly as it is underneath. See `stepApproach`.
 *
 * It does not cast. The machine is drawn somewhere around `z = 2.5` to `4`, low
 * in the frame and outboard, and the key at `[-46, 52, -20]` throws its shadow
 * further out and
 * further back still - two shadow-pass draws to put a dark shape in the corner
 * of the frame that is least read. There is a stronger reason than the budget,
 * though: a cast shadow is the single most convincing statement that a thing is
 * solid and standing where it appears to be, and this machine has no collider
 * and visibly drives through whatever the player just jumped. The shadow would
 * be the renderer insisting on something the simulation flatly denies.
 */

import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import type * as THREE from 'three';
import { CENTRE_LANE, TUNING } from '@/game/config/tuning';
import { GLOSS, PATROL } from '@/game/config/visuals';
import { clamp01, damp, lerp } from '@/game/core/math';
import { vertexColorMaterial } from '@/game/render/mergeParts';
import { patrolSpray } from '@/game/render/nearField';
import {
  createApproach,
  MACHINE_LENGTH,
  patrolDrawnZ,
  patrolMachineGeometry,
  patrolRiderGeometry,
  patrolShoulderX,
  patrolSideFor,
  RIDER_CROUCH,
  RIDER_SEAT,
  stepApproach,
} from '@/game/render/patrolGeometry';
import { runtime } from '@/game/state/runtime';
import { chaserPressure } from '@/game/systems/chaser';

/*
 * What the patrol publishes for the rest of the renderer.
 *
 * The rooster tail is emitted into the shared `SPRAY` pool by `SnowSpray`, as a
 * second source into the same instanced mesh - which is the only reason it costs
 * no draw call. That emitter needs the *smoothed* pressure and the *drawn*
 * position, neither of which can be recovered from `runtime.chaser`: the raw
 * pressure snaps and the simulated Z is behind the camera. Both are therefore
 * written into `patrolSpray`, the module singleton in `nearField.ts` that owns
 * the contract between the two components. It lives there rather than here so
 * that the particle system depends on a value, not on this component - a plume
 * whose emitter imports the thing it draws behind is one refactor away from a
 * cycle.
 *
 * `Chaser` is registered before `SnowSpray` in `Scene`, and r3f runs `useFrame`
 * callbacks at equal priority in registration order, so this is the current
 * frame's pose rather than the previous one's. A frame of lag would be harmless
 * either way - it is a particle emitter, not a collider.
 */

/**
 * Metres further outboard the machine starts an entrance from.
 *
 * Enough to be off the frame edge at a phone's aspect, so the arrival is a sweep
 * in from the side rather than a fade up out of nothing. It is also what carries
 * a side change: the machine swings out past the edge, the side flips where
 * nobody can see it, and it cuts back in on the other shoulder.
 */
const ENTRY_SWING = 2.0;

/**
 * Metres further from the eye an entrance starts at.
 *
 * The machine grows by about a third as it arrives. It has to be *further* away
 * at the start rather than nearer, which is the opposite of what "closing in"
 * suggests: everything between the player and the camera is only nine metres
 * deep, so a machine drawn nearer the lens is a machine below the bottom edge of
 * the frame, not one looming in it.
 */
const ENTRY_DEPTH = 1.5;

/**
 * Pressure at which the machine has fully arrived alongside.
 *
 * Well under 1, and the two mappings off the one follower are deliberate.
 * Arriving is an *event* - "it is here" - and a single stumble takes the patrol
 * from 26 m to 15 m, which is a little over half pressure and unambiguously
 * something the player should be looking at. How close it then sits, how far the
 * rider folds and how hard it throws snow are the continuous meter.
 */
const ENTRY_PRESSURE = 0.45;

/** Below this the machine is not drawn at all. */
const PRESENCE_EPSILON = 0.02;

/**
 * Fraction of the gap the lane follow leaves after a second.
 *
 * The machine tracks the player's lane loosely, which sells pursuit far better
 * than one welded to it - a chaser that never moves relative to the player never
 * appears to move at all.
 */
const LANE_LAG = 0.01;

/** Fraction left after a second while swinging out to change shoulders. */
const CROSS_LAG = 6e-6;

/**
 * How far out the swing has to be before the side is allowed to flip.
 *
 * The flip itself is instantaneous and must stay that way: the drawn side may
 * only ever be -1 or +1, because the lateral offset that keeps the machine clear
 * of the player's silhouette is `patrolOutboard() * side`, and any value between
 * the two puts a tall machine directly behind the one pale silhouette in the
 * game that already fails to separate. There is no continuous path from one
 * shoulder to the other along the ground, so the machine leaves the frame to
 * make the crossing.
 */
const CROSS_SNAP = 0.06;

export function Chaser() {
  const groupRef = useRef<THREE.Group>(null);
  const riderRef = useRef<THREE.Group>(null);

  const machineGeometry = useMemo(() => patrolMachineGeometry(), []);
  const riderGeometry = useMemo(() => patrolRiderGeometry(), []);
  // Polished for the machine - it is lacquered plastic and steel, the shiniest
  // thing on the mountain after a grind rail. The rider is fabric.
  const machineMaterial = useMemo(() => vertexColorMaterial(GLOSS.polished), []);
  const riderMaterial = useMemo(() => vertexColorMaterial(GLOSS.prop), []);

  const approachRef = useRef(createApproach());
  /** Lane X the machine is trailing, lagging the player's. */
  const laneRef = useRef(0);
  /** The drawn shoulder. Only ever -1 or +1; see {@link CROSS_SNAP}. */
  const sideRef = useRef<-1 | 1>(-1);
  /** 1 settled alongside, 0 swung out of frame to change shoulders. */
  const crossRef = useRef(1);
  const laneWasRef = useRef<number>(CENTRE_LANE);
  const cameFromRef = useRef<number>(CENTRE_LANE - 1);

  useFrame(({ camera }, delta) => {
    const group = groupRef.current;
    const rider = riderRef.current;
    if (!group || !rider) return;

    const { chaser, lane } = runtime;

    // Which way the player came into their current lane. Tracked here rather
    // than in the simulation because nothing there records it and nothing there
    // needs to: it only decides which shoulder a decoration rides on.
    if (lane.targetLane !== laneWasRef.current) {
      cameFromRef.current = laneWasRef.current;
      laneWasRef.current = lane.targetLane;
    }
    const wantSide = patrolSideFor(lane.targetLane, cameFromRef.current);

    const pressure = runtime.running && chaser.visible ? chaserPressure(chaser) : 0;
    stepApproach(approachRef.current, pressure, delta);
    const pose = approachRef.current.value;

    const showing = pose > PRESENCE_EPSILON;
    group.visible = showing;
    // Zeroed rather than passed through below the threshold: `SnowSpray` gates
    // its emitter at 0.01, so anything in the gap between the two would trickle
    // snow out of a machine that is not being drawn.
    patrolSpray.pressure = showing ? pose : 0;

    if (!showing) {
      // Pinned while away, so the next entrance starts from where the player
      // actually is rather than sweeping in from wherever the last one left off.
      laneRef.current = lane.x;
      sideRef.current = wantSide;
      crossRef.current = 1;
      return;
    }

    laneRef.current = damp(laneRef.current, lane.x, LANE_LAG, delta);
    crossRef.current = damp(
      crossRef.current,
      wantSide === sideRef.current ? 1 : 0,
      CROSS_LAG,
      delta,
    );
    // Out past the frame edge: flip where it cannot be seen happening.
    if (crossRef.current < CROSS_SNAP) sideRef.current = wantSide;

    /*
     * The lens, live.
     *
     * Not `TUNING.camera.fov`: the run spends most of a session at
     * `fov + speedFovKick`, and the depth at which the machine fits the frame
     * moves the better part of a metre over those twelve degrees. `CameraRig` is
     * registered before this component in `Scene`, so both the fov and the
     * position read here are already this frame's.
     */
    const perspective = camera as THREE.PerspectiveCamera;
    const fov = perspective.isPerspectiveCamera ? perspective.fov : TUNING.camera.fov;
    const aspect = perspective.isPerspectiveCamera ? perspective.aspect : 1;
    const settledZ = patrolDrawnZ(camera.position.z, fov, aspect);

    // `cross` gates the entry ease as well as the lateral swing, so a shoulder
    // change is a small exit and re-entry rather than a slide across the frame.
    const arrival = pose * crossRef.current;
    const swing = clamp01(arrival / ENTRY_PRESSURE);

    group.position.x =
      patrolShoulderX(laneRef.current, sideRef.current, fov, aspect) +
      ENTRY_SWING * sideRef.current * (1 - swing);
    /*
     * Lerp, not a clamped one. `arrival` briefly exceeds 1 as the spring
     * overshoots, and extrapolating past the settled Z *is* the overshoot: the
     * machine arrives a little too close and settles back. The excursion is
     * bounded by construction at `ENTRY_DEPTH * PATROL.approachOvershoot`, about
     * eighteen centimetres, so it cannot walk into the camera.
     */
    group.position.z = lerp(
      settledZ - ENTRY_DEPTH,
      settledZ,
      Math.min(arrival, 1 + PATROL.approachOvershoot),
    );

    /*
     * The rider folds over the bars. This replaces the machine pitch entirely:
     * `rotation.x = pressure * -0.14` had the sign backwards - a negative
     * rotation about +x drops the -z end, so maximum pressure nosed the machine
     * *down* - and eight degrees of pitch on a shape with no discernible nose
     * was sub-perceptual whichever way it went. Negative here for the same
     * reason, read the other way: a positive rotation takes the head towards +z,
     * which is backwards away from the grips.
     */
    rider.rotation.x = -RIDER_CROUCH * clamp01(pose);

    // Where the plume comes off: the back of the drive track, on the snow.
    // `MACHINE_LENGTH`, not the `PATROL.drawnLength` cap - the machine is built
    // inside the cap, and emitting from the cap would throw the plume out of
    // clear air a hand's width behind the flap it is meant to come off.
    patrolSpray.x = group.position.x;
    patrolSpray.y = 0.12;
    patrolSpray.z = group.position.z + MACHINE_LENGTH / 2;
  });

  return (
    <group ref={groupRef} visible={false}>
      <mesh geometry={machineGeometry} material={machineMaterial} />
      <group ref={riderRef} position={RIDER_SEAT}>
        <mesh geometry={riderGeometry} material={riderMaterial} />
      </group>
    </group>
  );
}
