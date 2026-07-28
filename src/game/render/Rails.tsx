/**
 * Grind rail rendering.
 *
 * One instanced mesh with a small pool, like the ramps. The geometry is built
 * along -z with its near end at the origin, so placement here is a lane and a Z
 * and nothing else - the climb is baked into the shape by `buildRail`, from the
 * same `TUNING.rail` numbers the physics reads.
 *
 * Rails can be long, so the visible window is extended by each rail's own
 * length: one whose start has already gone past the camera may still be being
 * ridden, and culling on its origin alone would make it vanish underfoot.
 */

import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { GLOSS } from '@/game/config/visuals';
import { vertexColorMaterial } from '@/game/render/mergeParts';
import { railGeometry, railPostGeometry } from '@/game/render/propGeometry';
import { RECYCLE_Z, SPAWN_Z } from '@/game/render/trackLayout';
import { runtime } from '@/game/state/runtime';
import { laneToX } from '@/game/systems/lanes';
import { MAX_RAILS, worldZOf } from '@/game/systems/spawner';

const scratch = new THREE.Object3D();

/** Two posts per rail, near end and far. */
const MAX_RAIL_POSTS = MAX_RAILS * 2;

export function Rails() {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const postRef = useRef<THREE.InstancedMesh>(null);
  const geometry = useMemo(() => railGeometry(), []);
  const postGeometry = useMemo(() => railPostGeometry(), []);
  // Polished: a steel rail is the shiniest thing on the mountain.
  const material = useMemo(() => vertexColorMaterial(GLOSS.polished), []);

  useFrame(() => {
    const mesh = meshRef.current;
    if (!mesh) return;

    const posts = postRef.current;
    let written = 0;
    let postsWritten = 0;
    for (const rail of runtime.track.rails) {
      if (!rail.active) continue;

      const worldZ = worldZOf(rail.trackZ, runtime.distance);
      if (worldZ > RECYCLE_Z + rail.length || worldZ < SPAWN_Z) continue;

      scratch.position.set(laneToX(rail.lane), 0, worldZ);
      scratch.rotation.set(0, 0, 0);
      // The geometry is built one metre long, so a rail's authored length is a
      // scale on Z. That is what lets every rail in the world - however many
      // different lengths are on screen - stay a single instanced draw.
      scratch.scale.set(1, 1, rail.length);
      scratch.updateMatrix();
      mesh.setMatrixAt(written, scratch.matrix);

      // The supports are drawn unscaled at each end. They cannot ride along in
      // the bar's geometry: that is stretched by the rail's length, which would
      // turn a thirteen-centimetre post into a metres-long slab and the whole
      // rail into a wall.
      if (posts) {
        for (const end of [0, -rail.length] as const) {
          if (postsWritten >= MAX_RAIL_POSTS) break;
          scratch.position.set(laneToX(rail.lane), 0, worldZ + end);
          scratch.scale.set(1, 1, 1);
          scratch.updateMatrix();
          posts.setMatrixAt(postsWritten, scratch.matrix);
          postsWritten++;
        }
      }

      written++;
      if (written >= MAX_RAILS) break;
    }

    mesh.count = written;
    mesh.instanceMatrix.needsUpdate = true;

    if (posts) {
      posts.count = postsWritten;
      posts.instanceMatrix.needsUpdate = true;
    }
  });

  return (
    <>
      <instancedMesh
        castShadow
        receiveShadow
        ref={meshRef}
        geometry={geometry}
        material={material}
        args={[undefined, undefined, MAX_RAILS]}
        frustumCulled={false}
      />
      <instancedMesh
        castShadow
        receiveShadow
        ref={postRef}
        geometry={postGeometry}
        material={material}
        args={[undefined, undefined, MAX_RAIL_POSTS]}
        frustumCulled={false}
      />
    </>
  );
}
