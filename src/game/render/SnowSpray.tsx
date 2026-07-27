/**
 * Snow thrown up by the board.
 *
 * Emits from the back of the board, harder the faster the run and harder again
 * while carving between lanes or landing from a jump. Spray is the cheapest
 * possible feedback that the player is moving fast and that a landing had
 * weight - without it a lane change is a silent slide.
 *
 * A fixed pool recycled oldest-first: no allocation during a run, and one
 * instanced draw call however much is in the air. The pool lives in a ref and
 * is only ever touched from inside the frame callback, because it is mutable
 * per-frame state rather than a render value.
 */

import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import * as THREE from 'three';
import { TUNING } from '@/game/config/tuning';
import { SPRAY } from '@/game/config/visuals';
import { createRng, type Rng } from '@/game/core/rng';
import { runtime } from '@/game/state/runtime';
import { laneToX } from '@/game/systems/lanes';

interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  spin: number;
}

interface SprayPool {
  particles: Particle[];
  rng: Rng;
  /** Ring cursor for oldest-first recycling. */
  cursor: number;
  /** Fractional emissions carried between frames, so the rate is frame-rate independent. */
  pending: number;
  wasAirborne: boolean;
}

const scratch = new THREE.Object3D();
/** Unused pool slots are scaled to nothing rather than left with stale matrices. */
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);

function createPool(): SprayPool {
  return {
    particles: Array.from({ length: SPRAY.count }, () => ({
      x: 0,
      y: 0,
      z: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      life: 0,
      spin: 0,
    })),
    rng: createRng(0x5b12),
    cursor: 0,
    pending: 0,
    wasAirborne: false,
  };
}

function emit(pool: SprayPool, count: number, force: number): void {
  for (let i = 0; i < count; i++) {
    const particle = pool.particles[pool.cursor % pool.particles.length] as Particle;
    pool.cursor++;

    particle.x = runtime.lane.x + pool.rng.range(-0.28, 0.28);
    particle.y = runtime.player.y + 0.08;
    particle.z = TUNING.player.z + 0.75;
    particle.vx = pool.rng.range(-1.5, 1.5) * force;
    particle.vy = pool.rng.range(1.2, 3.6) * force;
    particle.vz = pool.rng.range(1.5, 5.0) * force;
    particle.life = SPRAY.life * pool.rng.range(0.7, 1.2);
    particle.spin = pool.rng.range(-6, 6);
  }
}

export function SnowSpray() {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const poolRef = useRef<SprayPool>(null);

  useFrame((_, delta) => {
    const mesh = meshRef.current;
    if (!mesh) return;

    poolRef.current ??= createPool();
    const pool = poolRef.current;

    const dt = Math.min(delta, 0.05);
    const grounded = runtime.player.motion === 'running' || runtime.player.motion === 'sliding';
    const airborne = runtime.player.motion === 'airborne';

    if (runtime.running && runtime.alive) {
      // A landing throws up a burst.
      if (pool.wasAirborne && grounded) emit(pool, 18, 1.5);

      if (grounded) {
        // Steady trail, denser at speed. Carving and sliding both dig in.
        const carving = Math.abs(laneToX(runtime.lane.targetLane) - runtime.lane.x) > 0.15;
        const speed01 = runtime.speed / TUNING.speed.max;
        const rate =
          26 * speed01 * (carving ? 2.2 : 1) * (runtime.player.motion === 'sliding' ? 2.6 : 1);

        pool.pending += rate * dt;
        while (pool.pending >= 1) {
          pool.pending -= 1;
          emit(pool, 1, 0.6 + speed01 * 0.8);
        }
      }
    }

    pool.wasAirborne = airborne;

    // Advance and write. Particles drift backwards with the world as well as
    // along their own velocity, so they settle behind the player convincingly.
    let written = 0;
    for (const particle of pool.particles) {
      if (particle.life <= 0) continue;

      particle.life -= dt;
      if (particle.life <= 0) continue;

      particle.vy -= 9 * dt;
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      particle.z += (particle.vz + runtime.speed * 0.35) * dt;
      if (particle.y < 0.02) {
        particle.y = 0.02;
        particle.vy = 0;
      }

      const fade = Math.min(1, particle.life / SPRAY.life);
      scratch.position.set(particle.x, particle.y, particle.z);
      scratch.rotation.set(particle.spin * particle.life, particle.spin * particle.life, 0);
      scratch.scale.setScalar(SPRAY.size * fade);
      scratch.updateMatrix();
      mesh.setMatrixAt(written, scratch.matrix);
      written++;
    }

    // The write order is not stable frame to frame, so the tail is explicitly
    // hidden rather than trimmed with `count` - stale matrices would flicker
    // back into view.
    for (let i = written; i < pool.particles.length; i++) mesh.setMatrixAt(i, HIDDEN);

    mesh.count = pool.particles.length;
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, SPRAY.count]} frustumCulled={false}>
      {/* Low-poly flakes, matching the faceted look of everything else. */}
      <tetrahedronGeometry args={[1, 0]} />
      <meshLambertMaterial color={SPRAY.color} transparent opacity={0.9} depthWrite={false} />
    </instancedMesh>
  );
}
