/**
 * Obstacle rendering.
 *
 * One instanced mesh per obstacle kind, so the whole track costs a fixed
 * handful of draw calls no matter how dense it gets. Each frame the active
 * pool is scanned and `count` is set to however many instances were written -
 * unused instances are simply not drawn rather than hidden off screen.
 *
 * Kinds with a CC0 model use its geometry; the rest fall back to a box. Both
 * paths share the same placement loop, and in both the collider in
 * `content/obstacles.ts` remains authoritative - the art is fitted to it.
 */

import { useFrame } from '@react-three/fiber';
import { Suspense, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { OBSTACLE_MODELS } from '@/game/content/models';
import { OBSTACLE_KINDS, obstacleDef, type ObstacleKind } from '@/game/content/obstacles';
import { vertexColorMaterial } from '@/game/render/mergeParts';
import { isPropKind, propGeometry, type PropKind } from '@/game/render/propGeometry';
import { RECYCLE_Z, SPAWN_Z } from '@/game/render/trackLayout';
import { useModel, type ModelSpec } from '@/game/render/useModel';
import { runtime } from '@/game/state/runtime';
import { laneToX } from '@/game/systems/lanes';
import { MAX_OBSTACLES, worldZOf } from '@/game/systems/spawner';
import { GLOSS } from '@/game/config/visuals';

const scratch = new THREE.Object3D();

/**
 * Writes the visible obstacles of one kind into an instanced mesh.
 *
 * @param centreY - height to place instances at. Zero for prepared models,
 *        which are ground-aligned; the collider centre for primitive boxes,
 *        which are centred on their origin.
 */
function useObstacleInstances(
  meshRef: React.RefObject<THREE.InstancedMesh | null>,
  kind: ObstacleKind,
  centreY: number,
): void {
  useFrame(() => {
    const mesh = meshRef.current;
    if (!mesh) return;

    let written = 0;
    for (const obstacle of runtime.track.obstacles) {
      if (!obstacle.active || obstacle.kind !== kind) continue;

      const worldZ = worldZOf(obstacle.trackZ, runtime.distance);
      // Entities exist further out than they are drawn; skip the invisible ones.
      if (worldZ > RECYCLE_Z || worldZ < SPAWN_Z) continue;

      scratch.position.set(laneToX(obstacle.lane), centreY, worldZ);
      scratch.rotation.set(0, 0, 0);
      scratch.scale.set(1, 1, 1);
      scratch.updateMatrix();
      mesh.setMatrixAt(written, scratch.matrix);

      written++;
      if (written >= MAX_OBSTACLES) break;
    }

    mesh.count = written;
    mesh.instanceMatrix.needsUpdate = true;
  });
}

/** Model-backed obstacles. Suspends while the GLB loads. */
function ModelObstacleLayer({ kind, spec }: { kind: ObstacleKind; spec: ModelSpec }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const { geometry, material } = useModel(spec);

  // Prepared models are ground-aligned, and so is every obstacle collider.
  useObstacleInstances(meshRef, kind, 0);

  return (
    <instancedMesh castShadow receiveShadow
      ref={meshRef}
      geometry={geometry}
      material={material}
      args={[undefined, undefined, MAX_OBSTACLES]}
      frustumCulled={false}
    />
  );
}

/** Obstacles built in code, for the kinds no model in either kit fits. */
function PropObstacleLayer({ kind }: { kind: ObstacleKind & PropKind }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const geometry = useMemo(() => propGeometry(kind), [kind]);
  const material = useMemo(() => vertexColorMaterial(), []);

  // Props are ground-aligned, like the prepared models.
  useObstacleInstances(meshRef, kind, 0);

  return (
    <instancedMesh castShadow receiveShadow
      ref={meshRef}
      geometry={geometry}
      material={material}
      args={[undefined, undefined, MAX_OBSTACLES]}
      frustumCulled={false}
    />
  );
}

/** Last resort, if a kind has neither a model nor a builder. */
function BoxObstacleLayer({ kind }: { kind: ObstacleKind }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const def = obstacleDef(kind);

  useObstacleInstances(meshRef, kind, def.centreY);

  return (
    <instancedMesh castShadow receiveShadow
      ref={meshRef}
      args={[undefined, undefined, MAX_OBSTACLES]}
      frustumCulled={false}
    >
      <boxGeometry args={[def.visual.width, def.visual.height, def.visual.depth]} />
      <meshPhongMaterial color={def.color} flatShading specular={GLOSS.prop.specular} shininess={GLOSS.prop.shininess} />
    </instancedMesh>
  );
}

export function Obstacles() {
  return (
    <>
      {OBSTACLE_KINDS.map((kind) => {
        const spec = OBSTACLE_MODELS[kind];
        if (spec) {
          // Per layer, so one slow model does not blank the others.
          return (
            <Suspense key={kind} fallback={null}>
              <ModelObstacleLayer kind={kind} spec={spec} />
            </Suspense>
          );
        }
        if (isPropKind(kind)) return <PropObstacleLayer key={kind} kind={kind} />;
        return <BoxObstacleLayer key={kind} kind={kind} />;
      })}
    </>
  );
}
