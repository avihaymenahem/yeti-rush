/**
 * Parallax mountain ranges.
 *
 * Three silhouette layers at different depths, drifting at different rates.
 * Without them the world ends at the fog and the run reads as a treadmill in a
 * void; with them there is somewhere the slope is coming down from.
 *
 * Each range is one procedurally built triangle strip, generated from the
 * seeded RNG so the skyline is identical every session rather than a different
 * mountain each reload, which would be its own kind of wrong.
 *
 * This file owns the *shape*. Everything that decides a vertex's value - the
 * ridge shading, the snowline, the aerial perspective towards the sky - is
 * `rangeVertexColour` in `render/atmosphere.ts`, next to the sky gradient it has
 * to agree with. Three things changed together and they are one idea:
 *
 *  1. **One mesh per range, not two.** The strip is built at twice its nominal
 *     width so the sideways drift never exposes an edge, instead of drawing the
 *     same geometry twice side by side. Six draw calls become three.
 *  2. **Colour is baked towards the rendered sky, per vertex, at that vertex's
 *     own elevation.** Before this the layers were drawn *lighter* than the sky
 *     above their own ridgelines.
 *  3. **The lateral parallax was exactly backwards** and is gone. See `Range`.
 */

import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { TUNING } from '@/game/config/tuning';
import { MOUNTAINS } from '@/game/config/visuals';
import { clamp01, lerp, smoothstep } from '@/game/core/math';
import { createRng, type Rng } from '@/game/core/rng';
import { rangeVertexColour, type RangeShading } from '@/game/render/atmosphere';
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
 * The strip's base sits below the horizon, so its bottom edge is never visible
 * over the fogged ground.
 */
const RANGE_BASE_Y = -2;

/**
 * Sub-segments each coarse peak-to-valley span is broken into, and the
 * roughness of the noise laid over it, as a fraction of the layer height.
 *
 * The ridge used to be a pure alternating zigzag - `peaks * 2` segments and
 * nothing between them - which at this size reads as a sawtooth rather than as
 * rock. Two octaves at half amplitude each break the straight edges without
 * costing anything that matters: the three ranges together come to about two
 * thousand triangles, in three draw calls.
 *
 * Eight is set by pixels, not by taste. At eight sub-segments the far range's
 * fine step is about three units wide at three hundred metres, subtending
 * roughly half a degree - eight pixels of ridge on a portrait phone. Finer than
 * that and the detail is smaller than the aliasing on the edge carrying it.
 *
 * Note the noise can lift a peak a few per cent above `spec.height`. That is
 * intended - `height` is the nominal scale of a range, not a ceiling - and
 * everything downstream clamps the height *fraction* rather than the geometry.
 */
const RIDGE_DETAIL = 8;
const RIDGE_ROUGHNESS = 0.06;

/**
 * Cyclic value noise: `count` samples that wrap seamlessly, so the strip can be
 * repeated end to end without a seam appearing where the drift wraps.
 *
 * Each octave places its control points on a ring and interpolates between them
 * with a smoothstep, so the last sample joins the first by construction rather
 * than by remembering to copy one over the other.
 *
 * The finest octave is deliberately kept to one control point per *two* output
 * samples. An octave with a control point per sample is not noise with a
 * frequency, it is per-vertex jitter: it cannot be interpolated, so it carries
 * no shape and aliases as the range drifts.
 */
function ridgeNoise(rng: Rng, count: number, controlsAtBase: number, octaves: number): number[] {
  const out = new Array<number>(count).fill(0);

  for (let octave = 0; octave < octaves; octave++) {
    const controls = controlsAtBase * Math.pow(2, octave);
    const amplitude = RIDGE_ROUGHNESS * Math.pow(0.5, octave);

    const values: number[] = [];
    for (let i = 0; i < controls; i++) values.push(rng.range(-1, 1));

    for (let i = 0; i < count; i++) {
      const u = (i / count) * controls;
      const a = Math.floor(u) % controls;
      const b = (a + 1) % controls;
      out[i] =
        (out[i] as number) +
        amplitude * lerp(values[a] as number, values[b] as number, smoothstep(u - Math.floor(u)));
    }
  }

  return out;
}

/** Builds a ridge line as a single filled strip, two nominal widths across. */
function buildRange(spec: RangeSpec, seed: number): THREE.BufferGeometry {
  const rng = createRng(seed);
  const segments = spec.peaks * 2;

  // The coarse ridge: alternating peaks and valleys, with enough variation that
  // the silhouette never looks like a sawtooth.
  const coarse: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const isPeak = i % 2 === 1;
    coarse.push(isPeak ? rng.range(0.62, 1.0) : rng.range(0.08, 0.3));
  }
  // Close the loop so the strip wraps seamlessly when it repeats.
  coarse[segments] = coarse[0] as number;

  const fine = segments * RIDGE_DETAIL;
  const noise = ridgeNoise(rng, fine, segments * 2, 2);

  // Height fractions at every fine vertex, indexed modulo `fine`.
  const factors: number[] = [];
  for (let i = 0; i < fine; i++) {
    const at = i / RIDGE_DETAIL;
    const a = Math.floor(at);
    const base = lerp(coarse[a] as number, coarse[a + 1] as number, smoothstep(at - a));
    // Never below the base line: a valley dipping under zero would tear a hole
    // in the strip and show the fog through it.
    factors.push(Math.max(0.02, base + (noise[i] as number)));
  }

  const shading: RangeShading = {
    distance: Math.abs(spec.z),
    height: spec.height,
    baseY: RANGE_BASE_Y,
    // The resting eye. The camera rises with a jump, but nobody reads a skyline
    // during one and re-baking a geometry per frame is not on the table.
    eyeY: TUNING.camera.height,
  };

  const body = new THREE.Color(spec.color);
  const positions: number[] = [];
  const colors: number[] = [];

  const step = spec.width / fine;
  const startX = -spec.width / 2;

  /**
   * Which way this stretch of ridge faces, 0 turned away from the key and 1
   * towards it. Rising to the right means the surface turns left, and left is
   * where the key light is.
   */
  const sunFacingAt = (i: number): number => {
    const previous = factors[(i - 1 + fine) % fine] as number;
    const next = factors[(i + 1) % fine] as number;
    return clamp01(0.5 + (next - previous) * 2);
  };

  // Two nominal widths of strip in one geometry. Drawing the same range twice
  // side by side cost a draw call per copy for geometry that never changes;
  // emitting it twice costs a few hundred vertices, once.
  const scratch = new THREE.Color();
  const push = (i: number, t: number): void => {
    const colour = rangeVertexColour(body, shading, t, sunFacingAt(i), scratch);
    colors.push(colour.r, colour.g, colour.b);
  };

  for (let i = 0; i < fine * 2; i++) {
    const x0 = startX + i * step;
    const x1 = startX + (i + 1) * step;
    const i0 = i % fine;
    const i1 = (i + 1) % fine;
    const t0 = factors[i0] as number;
    const t1 = factors[i1] as number;

    // Two triangles per segment: ground-to-ridge quad.
    positions.push(x0, 0, 0, x1, 0, 0, x1, t1 * spec.height, 0);
    positions.push(x0, 0, 0, x1, t1 * spec.height, 0, x0, t0 * spec.height, 0);

    push(i0, 0);
    push(i1, 0);
    push(i1, t1);
    push(i0, 0);
    push(i1, t1);
    push(i0, t0);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  // The material is unlit and never reads them, but three's vertex prefix
  // declares the attribute unconditionally and a missing buffer is a driver
  // warning at best. A few kilobytes on geometry built once.
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function Range({ spec, seed }: { spec: RangeSpec; seed: number }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const geometry = useMemo(() => buildRange(spec, seed), [spec, seed]);

  useFrame(({ camera }) => {
    const mesh = meshRef.current;
    if (!mesh) return;

    /*
     * Ride with the camera in Z so the range is never approached, and slide
     * sideways a fraction of the distance travelled to sell the parallax.
     *
     * What is *not* here any more is `camera.position.x +`, and dropping it is
     * the entire lateral-parallax fix. Pinning the ranges to the camera's X
     * cancelled the one real parallax this game has: the camera translates
     * about +-0.84 units on every lane change (`laneFollow` 0.38 against lanes
     * at +-2.2), and a 169 m mountain lagging a 5 m fence post through that
     * translation is genuine, physically correct depth arriving at the exact
     * moment the player is looking. Meanwhile the drift below fakes lateral
     * motion out of *forward* distance, where a peak dead ahead does not slide
     * sideways at all. The two were exactly backwards.
     *
     * Coverage is not a concern: the narrowest strip is 420 units across, drawn
     * twice over, against a visible half-width of about 43.
     */
    mesh.position.set(
      -((runtime.distance * spec.parallax) % spec.width),
      RANGE_BASE_Y,
      camera.position.z + spec.z,
    );
  });

  return (
    <mesh ref={meshRef} geometry={geometry} frustumCulled={false}>
      <meshBasicMaterial vertexColors fog={false} />
    </mesh>
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
