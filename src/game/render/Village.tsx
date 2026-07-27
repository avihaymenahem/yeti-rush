/**
 * Alpine village dressing beside the track.
 *
 * Purely decorative and entirely off the playable lanes - nothing here has a
 * collider. It exists to sell the setting and to give the eye fixed reference
 * points so speed reads, which side scenery does better than the track itself.
 *
 * Three instanced meshes total: chalet bodies, roofs, and chairlift pylons.
 */

import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { createRng } from '@/game/core/rng';
import { TRACK_SPAN, wrapZ } from '@/game/render/trackLayout';
import { runtime } from '@/game/state/runtime';
import { GLOSS } from '@/game/config/visuals';

const scratch = new THREE.Object3D();

const COLORS = {
  wall: '#c8734f',
  roof: '#f2f7fa',
  pylon: '#6d7c88',
} as const;

/** Scenery starts beyond this distance from the centre, clear of the lanes. */
const SIDE_INSET = 7.5;
const SIDE_SPREAD = 7;

interface Building {
  x: number;
  zOffset: number;
  scale: number;
  rotation: number;
}

function useBuildings(count: number): Building[] {
  return useMemo(() => {
    const rng = createRng(0xb1d5);
    const out: Building[] = [];

    for (let i = 0; i < count; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      out.push({
        x: side * (SIDE_INSET + rng.range(0, SIDE_SPREAD)),
        zOffset: (i / count) * TRACK_SPAN + rng.range(-2, 2),
        scale: rng.range(0.8, 1.5),
        // Face roughly towards the slope, with some variation.
        rotation: rng.range(-0.4, 0.4) + (side < 0 ? Math.PI / 2 : -Math.PI / 2),
      });
    }

    return out;
  }, [count]);
}

function Chalets({ count = 18 }: { count?: number }) {
  const wallsRef = useRef<THREE.InstancedMesh>(null);
  const roofsRef = useRef<THREE.InstancedMesh>(null);
  const buildings = useBuildings(count);

  useFrame(() => {
    const walls = wallsRef.current;
    const roofs = roofsRef.current;
    if (!walls || !roofs) return;

    for (let i = 0; i < buildings.length; i++) {
      const building = buildings[i]!;
      const z = wrapZ(building.zOffset, runtime.distance);

      scratch.rotation.set(0, building.rotation, 0);
      scratch.scale.setScalar(building.scale);

      scratch.position.set(building.x, 1.1 * building.scale, z);
      scratch.updateMatrix();
      walls.setMatrixAt(i, scratch.matrix);

      scratch.position.set(building.x, 2.55 * building.scale, z);
      scratch.updateMatrix();
      roofs.setMatrixAt(i, scratch.matrix);
    }

    walls.instanceMatrix.needsUpdate = true;
    roofs.instanceMatrix.needsUpdate = true;
  });

  return (
    <>
      <instancedMesh castShadow receiveShadow ref={wallsRef} args={[undefined, undefined, count]} frustumCulled={false}>
        <boxGeometry args={[3, 2.2, 3.4]} />
        <meshPhongMaterial color={COLORS.wall} flatShading specular={GLOSS.prop.specular} shininess={GLOSS.prop.shininess} />
      </instancedMesh>
      <instancedMesh castShadow receiveShadow ref={roofsRef} args={[undefined, undefined, count]} frustumCulled={false}>
        {/* Four-sided cone: a hipped alpine roof under deep snow. */}
        <coneGeometry args={[2.9, 1.6, 4]} />
        <meshPhongMaterial color={COLORS.roof} flatShading specular={GLOSS.snow.specular} shininess={GLOSS.snow.shininess} />
      </instancedMesh>
    </>
  );
}

/** Chairlift pylons marching up the mountain, well outside the track. */
function Pylons({ count = 8 }: { count?: number }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const spacing = TRACK_SPAN / count;

  useFrame(() => {
    const mesh = meshRef.current;
    if (!mesh) return;

    for (let i = 0; i < count; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      scratch.position.set(side * 17, 4.5, wrapZ(i * spacing, runtime.distance));
      scratch.rotation.set(0, 0, 0);
      scratch.scale.set(1, 1, 1);
      scratch.updateMatrix();
      mesh.setMatrixAt(i, scratch.matrix);
    }

    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh castShadow receiveShadow ref={meshRef} args={[undefined, undefined, count]} frustumCulled={false}>
      <cylinderGeometry args={[0.22, 0.32, 9, 6]} />
      <meshPhongMaterial color={COLORS.pylon} flatShading specular={GLOSS.polished.specular} shininess={GLOSS.polished.shininess} />
    </instancedMesh>
  );
}

export function Village() {
  return (
    <>
      <Chalets />
      <Pylons />
    </>
  );
}
