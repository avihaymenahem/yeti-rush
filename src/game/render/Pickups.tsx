/**
 * Power-up pickups.
 *
 * One instanced mesh per power-up so each keeps its own colour, which is the
 * only thing telling the player what they are about to grab. They bob and spin
 * to read as collectable rather than as an obstacle.
 */

import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import * as THREE from 'three';
import { TUNING } from '@/game/config/tuning';
import { POWER_UP_IDS, powerUpDef, type PowerUpId } from '@/game/content/powerUps';
import { RECYCLE_Z, SPAWN_Z } from '@/game/render/trackLayout';
import { runtime } from '@/game/state/runtime';
import { laneToX } from '@/game/systems/lanes';
import { MAX_PICKUPS, worldZOf } from '@/game/systems/spawner';
import { GLOSS } from '@/game/config/visuals';

const scratch = new THREE.Object3D();

const BASE_HEIGHT = TUNING.coins.baseHeight + 0.2;

function PickupLayer({ id }: { id: PowerUpId }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const clockRef = useRef(0);
  const def = powerUpDef(id);

  useFrame((_, delta) => {
    const mesh = meshRef.current;
    if (!mesh) return;

    clockRef.current += delta;
    const bob = Math.sin(clockRef.current * 2.2) * 0.18;

    let written = 0;
    for (const pickup of runtime.track.pickups) {
      if (!pickup.active || pickup.powerUp !== id) continue;

      const worldZ = worldZOf(pickup.trackZ, runtime.distance);
      if (worldZ > RECYCLE_Z || worldZ < SPAWN_Z) continue;

      scratch.position.set(laneToX(pickup.lane), BASE_HEIGHT + bob, worldZ);
      scratch.rotation.set(0.4, clockRef.current * 1.6, 0);
      scratch.scale.set(1, 1, 1);
      scratch.updateMatrix();
      mesh.setMatrixAt(written, scratch.matrix);

      written++;
      if (written >= MAX_PICKUPS) break;
    }

    mesh.count = written;
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, MAX_PICKUPS]} frustumCulled={false}>
      {/* An octahedron reads as "special" at a glance, unlike a box or a coin. */}
      <octahedronGeometry args={[0.44, 0]} />
      <meshPhongMaterial
        color={def.color}
        emissive={def.color}
        emissiveIntensity={0.35}
        flatShading
        specular={GLOSS.polished.specular}
        shininess={GLOSS.polished.shininess}
      />
    </instancedMesh>
  );
}

export function Pickups() {
  return (
    <>
      {POWER_UP_IDS.map((id) => (
        <PickupLayer key={id} id={id} />
      ))}
    </>
  );
}
