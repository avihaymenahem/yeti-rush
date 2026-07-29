/**
 * Obstacle rendering.
 *
 * One instanced mesh per obstacle kind - or per art variant, for a kind drawn
 * with several models - so the whole track costs a fixed handful of draw calls
 * no matter how dense it gets. Each frame the active pool is scanned and
 * `count` is set to however many instances were written; unused instances are
 * simply not drawn rather than hidden off screen.
 *
 * Kinds with a CC0 model use its geometry; the rest fall back to a box. Both
 * paths share the same placement loop, and in both the collider in
 * `content/obstacles.ts` remains authoritative - the art is fitted to it.
 */

import { useFrame } from '@react-three/fiber';
import { Suspense, useMemo, useRef } from 'react';
import * as THREE from 'three';
import {
  OBSTACLE_JITTER,
  OBSTACLE_MODELS,
  styleAngle,
  styleScale,
  styleTint,
  variantIndex,
} from '@/game/content/models';
import { OBSTACLE_KINDS, obstacleDef, type ObstacleKind } from '@/game/content/obstacles';
import { vertexColorMaterial } from '@/game/render/mergeParts';
import { isPropKind, propGeometry, type PropKind } from '@/game/render/propGeometry';
import { RECYCLE_Z, SPAWN_Z } from '@/game/render/trackLayout';
import { useModel, type ModelSpec } from '@/game/render/useModel';
import { runtime } from '@/game/state/runtime';
import { laneToX } from '@/game/systems/lanes';
import { MAX_OBSTACLES, worldZOf } from '@/game/systems/spawner';
import { GLOSS, saturate } from '@/game/config/visuals';

const scratch = new THREE.Object3D();
const scratchColour = new THREE.Color();

/**
 * Writes the visible obstacles of one kind into an instanced mesh.
 *
 * @param centreY - height to place instances at. Zero for prepared models,
 *        which are ground-aligned; the collider centre for primitive boxes,
 *        which are centred on their origin.
 * @param variant - which art variant this mesh draws, and how many there are.
 *        Omitted by the single-model layers, which take every obstacle of the
 *        kind. Filtering here rather than sorting the pool keeps the hot path a
 *        single linear scan, exactly as it was.
 */
function useObstacleInstances(
  meshRef: React.RefObject<THREE.InstancedMesh | null>,
  kind: ObstacleKind,
  centreY: number,
  variant?: { index: number; count: number },
): void {
  const jitter = OBSTACLE_JITTER[kind] ?? false;

  useFrame(() => {
    const mesh = meshRef.current;
    if (!mesh) return;

    let written = 0;
    for (const obstacle of runtime.track.obstacles) {
      if (!obstacle.active || obstacle.kind !== kind) continue;
      if (variant && variantIndex(obstacle.style, variant.count) !== variant.index) continue;

      const worldZ = worldZOf(obstacle.trackZ, runtime.distance);
      // Entities exist further out than they are drawn; skip the invisible ones.
      if (worldZ > RECYCLE_Z || worldZ < SPAWN_Z) continue;

      scratch.position.set(laneToX(obstacle.lane), centreY, worldZ);
      // Turned, resized and tinted per instance for the kinds that can take it.
      // Swapping the model alone was not enough: four rocks all standing square
      // on at one size still read as the same rock going past.
      scratch.rotation.set(0, jitter ? styleAngle(obstacle.style) : 0, 0);
      scratch.scale.setScalar(jitter ? styleScale(obstacle.style) : 1);
      scratch.updateMatrix();
      mesh.setMatrixAt(written, scratch.matrix);
      if (jitter) {
        mesh.setColorAt(written, scratchColour.setScalar(styleTint(obstacle.style)));
      }

      written++;
      if (written >= MAX_OBSTACLES) break;
    }

    mesh.count = written;
    mesh.instanceMatrix.needsUpdate = true;
    // Allocated lazily by the first `setColorAt`, so this is only ever touched
    // on the kinds that actually tint.
    if (jitter && mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });
}

/** Model-backed obstacles. Suspends while the GLB loads. */
function ModelObstacleLayer({
  kind,
  spec,
  variant,
}: {
  kind: ObstacleKind;
  spec: ModelSpec;
  // Explicitly `| undefined` for `exactOptionalPropertyTypes`: the single-model
  // layers pass the prop and leave it unset, rather than omitting it.
  variant?: { index: number; count: number } | undefined;
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const { geometry, material } = useModel(spec);

  // Prepared models are ground-aligned, and so is every obstacle collider.
  useObstacleInstances(meshRef, kind, 0, variant);

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
      <meshPhongMaterial color={saturate(def.color)} flatShading specular={GLOSS.prop.specular} shininess={GLOSS.prop.shininess} />
    </instancedMesh>
  );
}

export function Obstacles() {
  return (
    <>
      {OBSTACLE_KINDS.map((kind) => {
        const specs = OBSTACLE_MODELS[kind];
        if (specs) {
          // A layer per variant. `variant` is left undefined when there is only
          // one, so the common case does no per-instance work at all.
          return specs.map((spec, index) => (
            // Suspense per layer, so one slow model does not blank the others.
            <Suspense key={spec.url} fallback={null}>
              <ModelObstacleLayer
                kind={kind}
                spec={spec}
                variant={specs.length > 1 ? { index, count: specs.length } : undefined}
              />
            </Suspense>
          ));
        }
        if (isPropKind(kind)) return <PropObstacleLayer key={kind} kind={kind} />;
        return <BoxObstacleLayer key={kind} kind={kind} />;
      })}
    </>
  );
}
