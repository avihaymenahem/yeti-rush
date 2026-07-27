/**
 * The light rig.
 *
 * Three lights. Flat-shaded low-poly geometry has no surface detail to catch
 * light, so the separation has to come from hue rather than texture: a warm key
 * raking in from the left, a cool rim from behind the camera picking out near
 * edges, and a broad sky-to-ground bounce filling the shadows with blue rather
 * than black.
 *
 * The rim light is the important one. It is what stops an obstacle from
 * dissolving into the snow behind it, which on a white slope at 30 units per
 * second is a gameplay problem as much as a visual one.
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
  useLayoutEffect(() => {
    const light = keyRef.current;
    if (!light) return;

    const camera = light.shadow.camera;
    camera.left = -SHADOW.halfWidth;
    camera.right = SHADOW.halfWidth;
    camera.top = SHADOW.halfDepth;
    camera.bottom = -SHADOW.halfDepth;
    camera.near = SHADOW.near;
    camera.far = SHADOW.far;
    camera.updateProjectionMatrix();

    light.shadow.bias = SHADOW.bias;
    light.shadow.normalBias = SHADOW.normalBias;
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
      {/* The rim never casts. A second shadow pass would double the cost, and
          two sets of cast shadows at opposing angles reads as a lighting bug
          rather than as depth. */}
      <directionalLight
        color={LIGHTING.rim.color}
        intensity={LIGHTING.rim.intensity}
        position={[...LIGHTING.rim.position]}
      />
    </>
  );
}
