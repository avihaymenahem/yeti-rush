/**
 * Piste fencing along both edges of the run.
 *
 * As well as dressing the slope, this is a readability aid: two continuous
 * lines converging towards the horizon give the eye a strong sense of speed and
 * of where the playable width ends, which a flat snowfield does not.
 *
 * Placed outside the outer lanes so it never reads as an obstacle, and drawn as
 * a single instanced mesh - one call for the whole run, both sides.
 */

import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { assemble, vertexColorMaterial } from '@/game/render/mergeParts';
import { TRACK_SPAN, wrapZ } from '@/game/render/trackLayout';
import { runtime } from '@/game/state/runtime';

const scratch = new THREE.Object3D();

/** Distance from the centre line to the fence, clear of the outer lanes. */
const FENCE_X = 5.1;
/** Metres between fence sections. */
const SPACING = 2.6;

const COLORS = {
  post: '#6b4a30',
  rail: '#8a5a3c',
  marker: '#e8663c',
  snow: '#fdf3e4',
} as const;

/**
 * One section: two posts and two rails, with an orange marker board on every
 * section so the line reads as piste boundary rather than farm fencing.
 */
function buildSection(): THREE.BufferGeometry {
  return assemble([
    { geometry: new THREE.BoxGeometry(0.12, 1.15, 0.12), color: COLORS.post, position: [0, 0.575, -SPACING / 2] },
    { geometry: new THREE.BoxGeometry(0.12, 1.15, 0.12), color: COLORS.post, position: [0, 0.575, SPACING / 2] },
    // Snow caps on the posts, tying the fence to the rest of the palette.
    { geometry: new THREE.BoxGeometry(0.17, 0.08, 0.17), color: COLORS.snow, position: [0, 1.17, -SPACING / 2] },
    { geometry: new THREE.BoxGeometry(0.17, 0.08, 0.17), color: COLORS.snow, position: [0, 1.17, SPACING / 2] },
    { geometry: new THREE.BoxGeometry(0.07, 0.1, SPACING), color: COLORS.rail, position: [0, 0.95, 0] },
    { geometry: new THREE.BoxGeometry(0.07, 0.1, SPACING), color: COLORS.rail, position: [0, 0.58, 0] },
    { geometry: new THREE.BoxGeometry(0.05, 0.34, 0.7), color: COLORS.marker, position: [0, 0.8, 0] },
  ]);
}

export function Fences() {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const geometry = useMemo(() => buildSection(), []);
  const material = useMemo(() => vertexColorMaterial(), []);

  const perSide = Math.ceil(TRACK_SPAN / SPACING);
  const total = perSide * 2;

  useFrame(() => {
    const mesh = meshRef.current;
    if (!mesh) return;

    for (let i = 0; i < perSide; i++) {
      const z = wrapZ(i * SPACING, runtime.distance);

      scratch.position.set(-FENCE_X, 0, z);
      scratch.updateMatrix();
      mesh.setMatrixAt(i, scratch.matrix);

      scratch.position.set(FENCE_X, 0, z);
      scratch.updateMatrix();
      mesh.setMatrixAt(perSide + i, scratch.matrix);
    }

    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh
      ref={meshRef}
      geometry={geometry}
      material={material}
      args={[undefined, undefined, total]}
      frustumCulled={false}
    />
  );
}
