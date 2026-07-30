/**
 * The light rig.
 *
 * Three lights. Flat-shaded low-poly geometry has no surface detail to catch
 * light, so the separation has to come from hue rather than texture: a warm key
 * raking in from the left, a cool fill from behind the camera lifting the faces
 * turned towards the viewer, and a broad sky-to-ground bounce filling the
 * shadows with blue rather than black.
 *
 * The second light was called a rim for most of this project's life and it has
 * never been one. It sits at `[7, 4, 9]`, which is *in front of* the subject
 * and behind the camera; a rim has to be behind the subject. What it actually
 * does - and it is the only thing in the rig that does it - is light
 * camera-facing normals, because both the key and `SKY.sunDirection` point
 * down-track and give every such surface `N.L < 0`. Removing it takes the rear
 * of the ski patrol and every camera-facing obstacle face to near-black, so it
 * stays; it is only softened and correctly named.
 *
 * **The three intensities are one ratio, not three numbers.** Nothing here sets
 * how bright the scene is - `ATMOSPHERE.exposure` and the tone curve do that -
 * so the only thing the rig decides is how far apart what the sun reaches and
 * what it does not are. Raising the key and lowering the ambient are the same
 * edit made twice, and changing one alone will read as the whole slope getting
 * brighter or duller rather than as more or less form. `LIGHTING.ambient` has
 * the measured sizes.
 *
 * **A real edge that separates a silhouette is not in this file and cannot be.**
 * No directional light can produce one, because a light contributes by
 * direction and a silhouette is a *viewing-angle* phenomenon. That job belongs
 * to the Fresnel term in `render/atmosphere.ts`, which is applied to the
 * materials rather than added to the rig.
 *
 * The key casts. See `SHADOW` for why that is affordable here when it usually
 * is not - the short version is that the player never moves, so the shadow
 * camera is a small fixed box that is set up once and never touched again.
 *
 * Tone mapping is configured on the Canvas itself in `App.tsx` rather than
 * here, so the renderer is created with the right settings instead of being
 * mutated after the fact.
 */

import { useLayoutEffect, useRef } from 'react';
import type * as THREE from 'three';
import { LIGHTING, SHADOW } from '@/game/config/visuals';

export function Lighting() {
  const keyRef = useRef<THREE.DirectionalLight>(null);

  // The shadow camera is configured imperatively and exactly once. Three only
  // rebuilds its projection when told, and driving an orthographic camera's
  // extents through JSX props re-runs on every React render for no benefit -
  // this rig is static for the life of the app.
  //
  // It is also pinned to the origin and stays there. That is only possible
  // because the player never moves, and it is what removes the texel-snapping
  // shimmer that usually forces cascades. Do not make it follow anything.
  useLayoutEffect(() => {
    const light = keyRef.current;
    if (!light) return;

    const camera = light.shadow.camera;
    // `halfWidth` maps to the camera's X, which with the key at
    // `[-46, 52, -20]` works out at almost pure world **Z**: it is the
    // down-track extent, not the across-track one. See `SHADOW`, which spells
    // the basis out - reading these two names the obvious way is how the
    // shadow reach came to be tuned backwards.
    camera.left = -SHADOW.halfWidth;
    camera.right = SHADOW.halfWidth;
    camera.top = SHADOW.halfDepth;
    camera.bottom = -SHADOW.halfDepth;
    camera.near = SHADOW.near;
    camera.far = SHADOW.far;
    camera.updateProjectionMatrix();

    light.shadow.bias = SHADOW.bias;
    light.shadow.normalBias = SHADOW.normalBias;
    // The blur that makes the edges soft. Only VSM reads these - under PCF
    // `radius` is ignored entirely, which is exactly why the first pass at this
    // came out stair-stepped however large the map got.
    light.shadow.radius = SHADOW.radius;
    light.shadow.blurSamples = SHADOW.blurSamples;
  }, []);

  return (
    <>
      <hemisphereLight
        args={[LIGHTING.ambient.sky, LIGHTING.ambient.ground, LIGHTING.ambient.intensity]}
      />
      <directionalLight
        ref={keyRef}
        color={LIGHTING.key.color}
        intensity={LIGHTING.key.intensity}
        position={[...LIGHTING.key.position]}
        castShadow
        shadow-mapSize-width={SHADOW.mapSize}
        shadow-mapSize-height={SHADOW.mapSize}
      />
      {/* The fill never casts. A second shadow pass would double the cost, and
          two sets of cast shadows at opposing angles reads as a lighting bug
          rather than as depth. */}
      <directionalLight
        color={LIGHTING.fill.color}
        intensity={LIGHTING.fill.intensity}
        position={[...LIGHTING.fill.position]}
      />
    </>
  );
}
