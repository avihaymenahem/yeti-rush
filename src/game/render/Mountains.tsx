/**
 * Parallax mountain ranges.
 *
 * Three silhouette layers at different depths, drifting at different rates.
 * Without them the world ends at the fog and the run reads as a treadmill in a
 * void; with them there is somewhere the slope is coming down from.
 *
 * Each range is one procedurally built triangle strip - a few hundred triangles
 * and a single draw call per layer. Generated from the seeded RNG so the
 * skyline is identical every session rather than a different mountain each
 * reload, which would be its own kind of wrong.
 */

import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { MOUNTAINS, PALETTE } from '@/game/config/visuals';
import { createRng } from '@/game/core/rng';
import { runtime } from '@/game/state/runtime';

interface RangeSpec {
  z: number;
  height: number;
  width: number;
  peaks: number;
  color: string;
  parallax: number;
}

/**
 * Builds a ridge line as a single filled strip.
 *
 * Peaks vary in height and are given a snow cap by vertex colour: the top of
 * each peak is lit snow, the base the range's own haze colour. That vertical
 * gradient is what makes a flat silhouette read as a mountain rather than a
 * paper cut-out.
 */
function buildRange(spec: RangeSpec, seed: number): THREE.BufferGeometry {
  const rng = createRng(seed);
  const segments = spec.peaks * 2;
  const positions: number[] = [];
  const colors: number[] = [];

  const base = new THREE.Color(spec.color);
  const cap = new THREE.Color(PALETTE.snowLit);

  const heights: number[] = [];
  for (let i = 0; i <= segments; i++) {
    // Alternate between peaks and valleys, with enough variation that the
    // silhouette never looks like a sawtooth.
    const isPeak = i % 2 === 1;
    const factor = isPeak ? rng.range(0.62, 1.0) : rng.range(0.08, 0.3);
    heights.push(spec.height * factor);
  }
  // Close the loop so the strip can wrap seamlessly when it repeats.
  heights[segments] = heights[0] as number;

  const step = spec.width / segments;
  const startX = -spec.width / 2;

  for (let i = 0; i < segments; i++) {
    const x0 = startX + i * step;
    const x1 = startX + (i + 1) * step;
    const h0 = heights[i] as number;
    const h1 = heights[i + 1] as number;

    // Two triangles per segment: ground-to-ridge quad.
    positions.push(x0, 0, 0, x1, 0, 0, x1, h1, 0);
    positions.push(x0, 0, 0, x1, h1, 0, x0, h0, 0);

    // Snow only on the upper reaches. Lerping the whole face towards white
    // washes the range out until it dissolves into the sky behind it; the
    // silhouette has to stay dark for the layers to read as separate ranges.
    const capAmount = (height: number) =>
      THREE.MathUtils.smoothstep(height / spec.height, 0.55, 1.0) * 0.85;

    const c0 = base.clone().lerp(cap, capAmount(h0));
    const c1 = base.clone().lerp(cap, capAmount(h1));

    colors.push(base.r, base.g, base.b, base.r, base.g, base.b, c1.r, c1.g, c1.b);
    colors.push(base.r, base.g, base.b, c1.r, c1.g, c1.b, c0.r, c0.g, c0.b);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function Range({ spec, seed }: { spec: RangeSpec; seed: number }) {
  const groupRef = useRef<THREE.Group>(null);
  const geometry = useMemo(() => buildRange(spec, seed), [spec, seed]);

  useFrame(({ camera }) => {
    const group = groupRef.current;
    if (!group) return;

    // Ride with the camera so the range is never approached, and slide
    // sideways a fraction of the distance travelled to sell the parallax.
    group.position.x = camera.position.x - ((runtime.distance * spec.parallax) % spec.width);
    group.position.z = camera.position.z + spec.z;
  });

  return (
    <group ref={groupRef}>
      {/* Two copies side by side, so the sideways drift never exposes an edge. */}
      {[0, 1].map((index) => (
        <mesh key={index} geometry={geometry} position={[index * spec.width, -2, 0]} frustumCulled={false}>
          <meshBasicMaterial vertexColors fog={false} />
        </mesh>
      ))}
    </group>
  );
}

export function Mountains() {
  return (
    <>
      {MOUNTAINS.layers.map((layer, index) => (
        <Range key={layer.z} spec={layer} seed={0x30a1 + index * 977} />
      ))}
    </>
  );
}
