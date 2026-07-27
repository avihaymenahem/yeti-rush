/**
 * Coin rendering.
 *
 * Every coin on the track is one instanced mesh - one draw call for hundreds
 * of coins. They share a single spin angle rather than each tracking its own,
 * which is both cheaper and reads better: a coin line spins in unison.
 */

import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import * as THREE from 'three';
import { TUNING } from '@/game/config/tuning';
import { RECYCLE_Z, SPAWN_Z } from '@/game/render/trackLayout';
import { runtime } from '@/game/state/runtime';
import { laneToX } from '@/game/systems/lanes';
import { MAX_COINS, worldZOf } from '@/game/systems/spawner';
import { GLOSS } from '@/game/config/visuals';

const scratch = new THREE.Object3D();
// YXZ order applies the spin *after* the tilt, so the disc faces the player and
// rotates about the world Y axis. With the default XYZ order the spin would be
// applied around the cylinder's own axis and be invisible.
scratch.rotation.order = 'YXZ';

const COIN_COLOR = '#f0b429';

export function CoinField() {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const spinRef = useRef(0);

  useFrame((_, delta) => {
    const mesh = meshRef.current;
    if (!mesh) return;

    spinRef.current = (spinRef.current + TUNING.coins.spinRate * delta) % (Math.PI * 2);

    let written = 0;
    for (const coin of runtime.track.coins) {
      if (!coin.active) continue;

      const worldZ = worldZOf(coin.trackZ, runtime.distance);
      if (worldZ > RECYCLE_Z || worldZ < SPAWN_Z) continue;

      scratch.position.set(laneToX(coin.lane), coin.y, worldZ);
      scratch.rotation.set(Math.PI / 2, spinRef.current, 0);
      scratch.scale.set(1, 1, 1);
      scratch.updateMatrix();
      mesh.setMatrixAt(written, scratch.matrix);

      written++;
      if (written >= MAX_COINS) break;
    }

    mesh.count = written;
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, MAX_COINS]} frustumCulled={false}>
      <cylinderGeometry args={[TUNING.coins.radius, TUNING.coins.radius, 0.08, 12]} />
      <meshPhongMaterial
        color={COIN_COLOR}
        flatShading
        emissive="#7a5410"
        specular={GLOSS.metal.specular}
        shininess={GLOSS.metal.shininess}
      />
    </instancedMesh>
  );
}
