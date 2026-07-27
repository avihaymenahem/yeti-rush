/**
 * The light rig.
 *
 * Three lights, no shadow maps. Flat-shaded low-poly geometry has no surface
 * detail to catch light, so the separation has to come from hue rather than
 * texture: a warm key from low and behind-left, a cool rim from behind the
 * camera picking out near edges, and a broad sky-to-ground bounce filling the
 * shadows with blue rather than black.
 *
 * The rim light is the important one. It is what stops an obstacle from
 * dissolving into the snow behind it, which on a white slope at 30 units per
 * second is a gameplay problem as much as a visual one.
 *
 * Tone mapping is configured on the Canvas itself in `App.tsx` rather than
 * here, so the renderer is created with the right settings instead of being
 * mutated after the fact.
 */

import { LIGHTING } from '@/game/config/visuals';

export function Lighting() {
  return (
    <>
      <hemisphereLight
        args={[LIGHTING.ambient.sky, LIGHTING.ambient.ground, LIGHTING.ambient.intensity]}
      />
      <directionalLight
        color={LIGHTING.key.color}
        intensity={LIGHTING.key.intensity}
        position={[...LIGHTING.key.position]}
      />
      <directionalLight
        color={LIGHTING.rim.color}
        intensity={LIGHTING.rim.intensity}
        position={[...LIGHTING.rim.position]}
      />
    </>
  );
}
