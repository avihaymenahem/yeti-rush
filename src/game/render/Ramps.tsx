/**
 * Ramp rendering.
 *
 * A packed-snow kicker on a timber frame, with chevrons up the ride surface.
 * Geometry lives in `propGeometry` and is ground-aligned, matching every other
 * obstacle, so placement here is just a lane and a Z.
 *
 * Ramps are rare enough that one instanced mesh with a small pool covers them.
 */

import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { vertexColorMaterial } from '@/game/render/mergeParts';
import { rampGeometry } from '@/game/render/propGeometry';
import { RECYCLE_Z, SPAWN_Z } from '@/game/render/trackLayout';
import { runtime } from '@/game/state/runtime';
import { laneToX } from '@/game/systems/lanes';
import { MAX_RAMPS, worldZOf } from '@/game/systems/spawner';

const scratch = new THREE.Object3D();

export function Ramps() {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const geometry = useMemo(() => rampGeometry(), []);
  const material = useMemo(() => vertexColorMaterial(), []);

  useFrame(() => {
    const mesh = meshRef.current;
    if (!mesh) return;

    let written = 0;
    for (const ramp of runtime.track.ramps) {
      if (!ramp.active) continue;

      const worldZ = worldZOf(ramp.trackZ, runtime.distance);
      if (worldZ > RECYCLE_Z || worldZ < SPAWN_Z) continue;

      scratch.position.set(laneToX(ramp.lane), 0, worldZ);
      scratch.rotation.set(0, 0, 0);
      scratch.scale.set(1, 1, 1);
      scratch.updateMatrix();
      mesh.setMatrixAt(written, scratch.matrix);

      written++;
      if (written >= MAX_RAMPS) break;
    }

    mesh.count = written;
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh castShadow receiveShadow
      ref={meshRef}
      geometry={geometry}
      material={material}
      args={[undefined, undefined, MAX_RAMPS]}
      frustumCulled={false}
    />
  );
}
