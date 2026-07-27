/**
 * The snow slope and its scenery.
 *
 * The world scrolls, the player does not. Every scrolling object derives its Z
 * from `runtime.distance` modulo the recycle span, so nothing is spawned,
 * destroyed or allocated while the run is in progress.
 *
 * This is placeholder scenery for M0/M1: it exists to make speed readable and
 * to prove the frame budget. The authored chunk system replaces it in M2.
 */

import { useFrame } from '@react-three/fiber';
import { Suspense, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { LANES } from '@/game/config/tuning';
import { PINE_MODELS } from '@/game/content/models';
import { createRng } from '@/game/core/rng';
import {
  TRACK_CENTRE_Z,
  TRACK_COLORS,
  TRACK_SPAN,
  wrapZ,
} from '@/game/render/trackLayout';
import { useModel, type ModelSpec } from '@/game/render/useModel';
import { runtime } from '@/game/state/runtime';
import { GLOSS } from '@/game/config/visuals';

/** Reused for every instance matrix write - never allocate inside useFrame. */
const scratch = new THREE.Object3D();

function Ground() {
  return (
    <>
      {/* Far wider than the track needs: on a tablet the horizontal field of
          view is wide enough to see past a narrow plane, and the exposed edge
          against the sky is very obvious. One extra plane costs nothing. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, TRACK_CENTRE_Z]}>
        <planeGeometry args={[300, TRACK_SPAN + 40]} />
        <meshPhongMaterial color={TRACK_COLORS.snow} specular={GLOSS.snow.specular} shininess={GLOSS.snow.shininess} />
      </mesh>

      {/* The groomed run, a shade cooler than the field either side of it. Its
          edges are what tell the player where the playable width ends. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.004, TRACK_CENTRE_Z]}>
        <planeGeometry args={[9.2, TRACK_SPAN + 40]} />
        <meshPhongMaterial color={TRACK_COLORS.piste} specular={GLOSS.snow.specular} shininess={GLOSS.snow.shininess} />
      </mesh>
    </>
  );
}

/**
 * Two continuous grooves in the snow marking the lane boundaries. Static -
 * they read as unbroken tracks, so there is nothing to scroll.
 */
function LaneGuides() {
  const boundaries = useMemo(() => {
    const out: number[] = [];
    for (let i = 0; i < LANES.length - 1; i++) {
      out.push((LANES[i]! + LANES[i + 1]!) / 2);
    }
    return out;
  }, []);

  return (
    <>
      {boundaries.map((x) => (
        <mesh key={x} position={[x, 0.012, TRACK_CENTRE_Z]}>
          <boxGeometry args={[0.09, 0.02, TRACK_SPAN + 40]} />
          <meshPhongMaterial color={TRACK_COLORS.laneGuide} specular={GLOSS.snow.specular} shininess={GLOSS.snow.shininess} />
        </mesh>
      ))}
    </>
  );
}

/**
 * Ridges of packed snow running across the slope. Without something moving
 * underfoot the speed ramp is invisible; these are the cheapest possible cue.
 */
function SnowRidges({ count = 26 }: { count?: number }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const spacing = TRACK_SPAN / count;

  useFrame(() => {
    const mesh = meshRef.current;
    if (!mesh) return;

    for (let i = 0; i < count; i++) {
      scratch.position.set(0, 0.01, wrapZ(i * spacing, runtime.distance));
      scratch.rotation.set(0, 0, 0);
      scratch.scale.set(1, 1, 1);
      scratch.updateMatrix();
      mesh.setMatrixAt(i, scratch.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, count]} frustumCulled={false}>
      <boxGeometry args={[14, 0.02, 0.5]} />
      <meshPhongMaterial color={TRACK_COLORS.snowShade} specular={GLOSS.snow.specular} shininess={GLOSS.snow.shininess} />
    </instancedMesh>
  );
}

interface PineInstance {
  x: number;
  zOffset: number;
  scale: number;
  rotation: number;
}

/**
 * Deterministic scenery layout, shared by every pine variant.
 *
 * Each variant claims the instances whose index falls to it, so the three
 * models interleave along the treeline instead of one species filling one side.
 */
function usePineLayout(count: number): PineInstance[] {
  return useMemo(() => {
    // Fixed seed: the scenery layout is decorative and stable across runs.
    const rng = createRng(0x5eed);
    const out: PineInstance[] = [];
    for (let i = 0; i < count; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      out.push({
        x: side * rng.range(5.5, 13),
        zOffset: (i / count) * TRACK_SPAN + rng.range(-1.5, 1.5),
        scale: rng.range(0.75, 1.35),
        rotation: rng.range(0, Math.PI * 2),
      });
    }
    return out;
  }, [count]);
}

/** One instanced mesh per pine model, sharing the treeline layout. */
function PineLayer({
  spec,
  layout,
  variant,
  variantCount,
}: {
  spec: ModelSpec;
  layout: PineInstance[];
  variant: number;
  variantCount: number;
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const { geometry, material } = useModel(spec);

  const mine = useMemo(
    () => layout.filter((_, index) => index % variantCount === variant),
    [layout, variant, variantCount],
  );

  useFrame(() => {
    const mesh = meshRef.current;
    if (!mesh) return;

    for (let i = 0; i < mine.length; i++) {
      const pine = mine[i]!;
      // Models are ground-aligned, so they sit at y = 0 whatever their scale.
      scratch.position.set(pine.x, 0, wrapZ(pine.zOffset, runtime.distance));
      scratch.rotation.set(0, pine.rotation, 0);
      scratch.scale.setScalar(pine.scale);
      scratch.updateMatrix();
      mesh.setMatrixAt(i, scratch.matrix);
    }

    mesh.count = mine.length;
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh
      ref={meshRef}
      geometry={geometry}
      material={material}
      args={[undefined, undefined, mine.length]}
      frustumCulled={false}
    />
  );
}

/** Snow-laden pines lining both sides of the run. */
function Pines({ count = 48 }: { count?: number }) {
  const layout = usePineLayout(count);

  return (
    <>
      {PINE_MODELS.map((spec, index) => (
        <Suspense key={spec.url} fallback={null}>
          <PineLayer
            spec={spec}
            layout={layout}
            variant={index}
            variantCount={PINE_MODELS.length}
          />
        </Suspense>
      ))}
    </>
  );
}

export function Track() {
  return (
    <>
      <Ground />
      <LaneGuides />
      <SnowRidges />
      <Pines />
    </>
  );
}
