/**
 * Power-up pickups.
 *
 * One instanced mesh per power-up, each drawn as the thing it actually is: a
 * mug of cocoa, a snowboard, a chairlift seat, a pair of wings, a star. They
 * were five identical octahedra separated only by tint, which asks the player
 * to have memorised a colour key - and colour is the first thing a low sun and
 * heavy fog take away. A silhouette survives both, and reads from far enough
 * out to be worth changing lane for.
 *
 * Still one draw call each: every model is merged into a single geometry with
 * its colours baked into vertex attributes, the same trick the obstacles and
 * the yeti use.
 */

import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { TUNING } from '@/game/config/tuning';
import { POWER_UP_IDS, type PowerUpId } from '@/game/content/powerUps';
import { RECYCLE_Z, SPAWN_Z } from '@/game/render/trackLayout';
import { runtime } from '@/game/state/runtime';
import { laneToX } from '@/game/systems/lanes';
import { MAX_PICKUPS, worldZOf } from '@/game/systems/spawner';
import { GLOSS } from '@/game/config/visuals';
import { vertexColorMaterial } from '@/game/render/mergeParts';
import { pickupGeometry } from '@/game/render/propGeometry';

const scratch = new THREE.Object3D();

const BASE_HEIGHT = TUNING.coins.baseHeight + 0.2;

function PickupLayer({ id }: { id: PowerUpId }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const clockRef = useRef(0);
  const geometry = useMemo(() => pickupGeometry(id), [id]);
  // Polished: a pickup should catch the light and pull the eye.
  const material = useMemo(() => vertexColorMaterial(GLOSS.polished), []);

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
      scratch.rotation.set(0, clockRef.current * 1.6, 0);
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
    <instancedMesh
      ref={meshRef}
      geometry={geometry}
      material={material}
      args={[undefined, undefined, MAX_PICKUPS]}
      frustumCulled={false}
    />
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
