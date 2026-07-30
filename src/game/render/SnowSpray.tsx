/**
 * Snow thrown up by the board, and by the ski patrol's track.
 *
 * A fixed pool recycled oldest-first: no allocation during a run, and one
 * instanced draw call however much is in the air. The pool lives in a ref and
 * is only ever touched from inside the frame callback, because it is mutable
 * per-frame state rather than a render value.
 *
 * Two emitters, one pool. The patrol's rooster tail is a second *source* into
 * these particles rather than its own system - a second system would mean a
 * second Lambert material identical to this one and a second draw call, on a
 * frame that has about seven to spare in total. It is driven through
 * `patrolSpray` in `nearField.ts`.
 *
 * The wake, the birth drift and the near-lens collapse - the three things that
 * decide whether a plume forms behind the board at all - are in `nearField.ts`
 * with the reasoning, along with the settle that takes a flake off the snow once
 * it has landed. What is here is the shape of the two emissions.
 */

import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { TUNING } from '@/game/config/tuning';
import { CHASER_SPRAY, SPRAY } from '@/game/config/visuals';
import { createRng, type Rng } from '@/game/core/rng';
import {
  carve01,
  lateralSpeed,
  patrolSpray,
  proximityFade,
  settleLife,
  sprayFade,
  sprayTumble,
  wakeVelocity,
} from '@/game/render/nearField';
import { runtime } from '@/game/state/runtime';

interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  spin: number;
  /**
   * What is left of the rider's momentum, 1 at birth and 0 once the wake has
   * taken it. Not a timer: it is read directly as the fraction of the world's
   * speed the particle is *not* yet giving up.
   */
  drift: number;
  /**
   * Which of the two birth tints this particle drew, rolled once when it was
   * emitted and never afterwards.
   *
   * The pool recycles, so a tint chosen at draw time would flicker every time a
   * slot came round again - the same rule the obstacle style rolls follow.
   */
  shade: number;
  /** 1 for the flat ground sheet, 0 for the high plume. Flattens the sprite. */
  sheet: number;
  /**
   * Zero in the air; the life the flake had left on the frame it touched down,
   * once it is not. It is both the settled flag and what the settle collapses
   * over - see `sprayFade`.
   */
  rest: number;
}

interface SprayPool {
  particles: Particle[];
  rng: Rng;
  /** Ring cursor for oldest-first recycling. */
  cursor: number;
  /** Fractional emissions carried between frames, so the rate is frame-rate independent. */
  pending: number;
  /** The same, for the patrol's emitter, kept apart so the two cannot rob each other. */
  patrolPending: number;
  wasAirborne: boolean;
}

const scratch = new THREE.Object3D();
const LIGHT_TONE = new THREE.Color(SPRAY.color);
const SHADE_TONE = new THREE.Color(SPRAY.shadeColor);

/**
 * Height at which a flake is considered to be lying on the snow.
 *
 * Just clear of the surface rather than on it, so a sprite half-buried in the
 * piste never z-fights with it. It is also the trigger for the settle, which is
 * why it is named rather than repeated.
 */
const REST_HEIGHT = 0.02;

function createParticle(): Particle {
  return {
    x: 0,
    y: 0,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    life: 0,
    spin: 0,
    drift: 0,
    shade: 0,
    sheet: 0,
    rest: 0,
  };
}

function createPool(): SprayPool {
  return {
    particles: Array.from({ length: SPRAY.count }, createParticle),
    rng: createRng(0x5b12),
    cursor: 0,
    pending: 0,
    patrolPending: 0,
    wasAirborne: false,
  };
}

/** Takes the oldest slot and rolls everything that is decided at birth. */
function claim(pool: SprayPool): Particle {
  const particle = pool.particles[pool.cursor % pool.particles.length] as Particle;
  pool.cursor++;
  particle.life = SPRAY.life * pool.rng.range(0.7, 1.2);
  particle.spin = pool.rng.range(-6, 6);
  particle.drift = 1;
  // The pool recycles, so everything decided at birth has to be cleared here.
  // A slot reused while it was still flagged as settled would be drawn at the
  // collapsed size of the flake before it and vanish within `settleSeconds`.
  particle.rest = 0;
  particle.shade = pool.rng.chance(SPRAY.shadeChance) ? 1 : 0;
  return particle;
}

/**
 * The high plume, off the edge the board is carving on.
 *
 * The origin used to be `lane.x ± 0.28` regardless of which way the rider was
 * turning, so snow came off the middle of the board - which is the one place on
 * a snowboard that never touches the snow. `carve` is signed, so this puts it on
 * the working edge and throws it outwards from there.
 */
function emitPlume(pool: SprayPool, count: number, force: number, carve: number): void {
  const side = Math.sign(carve);
  const bite = Math.abs(carve);

  for (let i = 0; i < count; i++) {
    const particle = claim(pool);
    // Running straight, both edges are equally close to the snow, so the origin
    // spreads across the board instead of picking a side at random per frame.
    const edge = side === 0 ? pool.rng.range(-0.24, 0.24) : side * 0.3;
    particle.x = runtime.lane.x + edge + pool.rng.range(-0.07, 0.07);
    particle.y = runtime.player.y + 0.12;
    particle.z = TUNING.player.z + 0.7;
    particle.vx = (pool.rng.range(-0.9, 0.9) + side * bite * 2.4) * force;
    particle.vy = pool.rng.range(2.0, 4.4) * force;
    particle.vz = pool.rng.range(1.0, 3.0) * force;
    particle.sheet = 0;
  }
}

/**
 * The flat sheet, fanning out along the snow and left behind.
 *
 * The second shape is what stops the spray reading as a single puff: a plume
 * describes how hard the board is working, a sheet describes the ground it has
 * just crossed, and the two live in different parts of the frame.
 */
function emitSheet(pool: SprayPool, count: number, force: number): void {
  for (let i = 0; i < count; i++) {
    const particle = claim(pool);
    particle.x = runtime.lane.x + pool.rng.range(-0.34, 0.34);
    particle.y = 0.05;
    particle.z = TUNING.player.z + 0.55;
    particle.vx = pool.rng.range(-1, 1) * 2.6 * force;
    particle.vy = pool.rng.range(0.2, 1.0) * force;
    particle.vz = pool.rng.range(0.2, 1.4) * force;
    particle.sheet = 1;
  }
}

/**
 * The patrol's rooster tail.
 *
 * Thrown up and towards the lens on purpose. The machine is drawn at about
 * `z = 5`, and the frame's bottom edge crosses the snow at about `z = 4`, so
 * there is a band of screen directly beneath it that the machine physically
 * cannot occupy however close it comes. Filling that band with its own spray is
 * what makes the pressure legible without moving the machine into the player's
 * silhouette.
 */
function emitPatrol(pool: SprayPool, count: number, pressure: number): void {
  for (let i = 0; i < count; i++) {
    const particle = claim(pool);
    particle.x = patrolSpray.x + pool.rng.range(-0.35, 0.35);
    particle.y = patrolSpray.y + pool.rng.range(0, 0.25);
    particle.z = patrolSpray.z;
    particle.vx = pool.rng.range(-1, 1) * CHASER_SPRAY.spread;
    particle.vy = pool.rng.range(2.2, 5.0) * (0.6 + pressure * 0.6);
    particle.vz = pool.rng.range(2.0, 5.5);
    particle.sheet = 0;
  }
}

export function SnowSpray() {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const poolRef = useRef<SprayPool>(null);

  const geometry = useMemo(() => {
    // Low-poly flakes, matching the faceted look of everything else.
    const geo = new THREE.TetrahedronGeometry(1, 0);
    /*
     * `vertexColors` has to be on for `instanceColor` to reach the fragment
     * shader - three gates `color_fragment` on `USE_COLOR`, not on the
     * instancing define. With it on, the vertex stage also multiplies by the
     * `color` attribute, and an *absent* attribute reads as WebGL's generic
     * (0, 0, 0, 1): every particle would come out black. A white one leaves the
     * instance tint as the only tint.
     */
    const white = new Float32Array(geo.getAttribute('position').count * 3).fill(1);
    geo.setAttribute('color', new THREE.BufferAttribute(white, 3));
    return geo;
  }, []);

  useFrame(({ camera }, delta) => {
    const mesh = meshRef.current;
    if (!mesh) return;

    poolRef.current ??= createPool();
    const pool = poolRef.current;

    const dt = Math.min(delta, 0.05);
    const motion = runtime.player.motion;
    const grounded = motion === 'running' || motion === 'sliding';
    const airborne = motion === 'airborne';
    const live = runtime.running && runtime.alive;

    if (live) {
      // A landing throws up a burst: mostly sheet, because what a landing does
      // is displace the ground rather than cut into it.
      if (pool.wasAirborne && grounded) {
        emitSheet(pool, 13, 1.5);
        emitPlume(pool, 5, 1.5, 0);
      }

      if (grounded) {
        /*
         * Steady trail, denser at speed and denser again while the board is
         * edged. Carving is read from the continuous carve scalar rather than
         * the `> 0.15` threshold this used to use: a boolean steps the rate
         * part-way through every lane change, and a step in an emission rate is
         * a visible seam in the plume.
         *
         * The normalisation is `speed / max`, which has a floor of 0.58 at the
         * opening speed rather than the zero that `(speed - start) / (max -
         * start)` gives. `systems/difficulty.ts` is getting a canonical
         * `speedProgress` for exactly this; route this through it when it lands.
         */
        const carve = carve01(runtime.lane, runtime.board.control);
        const speed01 = runtime.speed / TUNING.speed.max;
        const rate = 26 * speed01 * (1 + carve * 1.2) * (motion === 'sliding' ? 2.6 : 1);
        const signedCarve = lateralSpeed(runtime.lane, runtime.board.control);

        pool.pending += rate * dt;
        while (pool.pending >= 1) {
          pool.pending -= 1;
          const force = 0.6 + speed01 * 0.8;
          // Rolled per emission rather than split by a ratio, so the mix stays
          // right at any rate and neither shape ever starves.
          if (pool.rng.chance(0.55)) emitPlume(pool, 1, force, signedCarve);
          else emitSheet(pool, 1, force);
        }
      }

      if (patrolSpray.pressure > 0.01) {
        pool.patrolPending += CHASER_SPRAY.rateAtFullPressure * patrolSpray.pressure * dt;
        while (pool.patrolPending >= 1) {
          pool.patrolPending -= 1;
          emitPatrol(pool, 1, patrolSpray.pressure);
        }
      }
    } else {
      // Nothing is being thrown, so nothing may be owed either - a paused run
      // that resumes should not cough out a frame's backlog.
      pool.pending = 0;
      pool.patrolPending = 0;
    }

    pool.wasAirborne = airborne;

    const lensZ = camera.position.z;
    const nearPlane = (camera as THREE.PerspectiveCamera).near;

    let written = 0;
    for (const particle of pool.particles) {
      if (particle.life <= 0) continue;

      particle.life -= dt;
      if (particle.life <= 0) continue;

      particle.vy -= 9 * dt;
      // What is left of the rider's momentum, given up over `driftSeconds`.
      particle.drift = Math.max(0, particle.drift - dt / SPRAY.driftSeconds);

      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      particle.z += wakeVelocity(particle.vz, runtime.speed, particle.drift) * dt;
      if (particle.y < REST_HEIGHT) {
        particle.y = REST_HEIGHT;
        particle.vy = 0;
        /*
         * Snow that has come to rest sinks into the surface; it does not lie on
         * the piste as a faceted shard until its life runs out. That was 45% of
         * the plume reading as stray polygons in every still.
         *
         * Only on the first touch. This branch re-fires every frame afterwards,
         * because gravity keeps pulling a resting flake back through the floor,
         * and banking the life again each time would hold the collapse at full
         * size for as long as the flake sat there.
         */
        if (particle.rest === 0) {
          // Banked before the cut: `sprayFade` needs the size the flake was
          // being drawn at as well as what is left to collapse over.
          particle.rest = particle.life;
          particle.life = settleLife(particle.life);
        }
      }

      const fade = sprayFade(particle.life, particle.rest);
      const scale = SPRAY.size * fade * proximityFade(lensZ - particle.z, nearPlane);
      if (scale <= 0) continue;

      scratch.position.set(particle.x, particle.y, particle.z);
      const tumble = sprayTumble(particle.spin, particle.life, particle.rest);
      scratch.rotation.set(tumble, tumble, 0);
      // The ground sheet is squashed, so it reads as snow lying along the slope
      // rather than as a second, lower plume.
      if (particle.sheet) scratch.scale.set(scale, scale * 0.45, scale);
      else scratch.scale.setScalar(scale);
      scratch.updateMatrix();

      mesh.setMatrixAt(written, scratch.matrix);
      mesh.setColorAt(written, particle.shade ? SHADE_TONE : LIGHT_TONE);
      written++;
    }

    /*
     * Trimmed with `count`, not by hiding the tail.
     *
     * The loop above compacts every live particle into `[0, written)`, so
     * nothing beyond it is ever submitted and the stale matrices there cannot
     * flicker back into view. The comment this replaced defended against
     * exactly that hazard, and the hazard did not exist - it cost a second full
     * pass over the pool and a matrix write per dead slot, every frame.
     */
    mesh.count = written;
    mesh.instanceMatrix.needsUpdate = true;
    // Created lazily by the first `setColorAt`, so it is null on a frame where
    // nothing was alive.
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });

  return (
    <instancedMesh
      ref={meshRef}
      geometry={geometry}
      args={[undefined, undefined, SPRAY.count]}
      frustumCulled={false}
    >
      <meshLambertMaterial
        color={SPRAY.color}
        vertexColors
        transparent
        opacity={0.9}
        depthWrite={false}
      />
    </instancedMesh>
  );
}
