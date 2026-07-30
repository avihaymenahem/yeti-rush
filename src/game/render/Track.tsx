/**
 * The snow slope and its scenery.
 *
 * The world scrolls, the player does not. Every scrolling object derives its Z
 * from `runtime.distance` modulo the recycle span, so nothing is spawned,
 * destroyed or allocated while the run is in progress.
 *
 * The surface itself is one merged vertex-coloured geometry built in
 * `groundGeometry.ts` - it used to be five separate draw calls for a flat plane
 * with two stripes on it - carrying the one texture in the scene, the groomed
 * corduroy from `snowSurface.ts`. The scenery is one instanced mesh per pine
 * model.
 */

import { useFrame, useThree } from '@react-three/fiber';
import { Suspense, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { PINE_MODELS } from '@/game/content/models';
import { groundScrollZ, groundSurface } from '@/game/render/groundGeometry';
import { snowAlbedoTexture } from '@/game/render/snowSurface';
import { pineLayout, wrapZ, type PineInstance } from '@/game/render/trackLayout';
import { useModel, type ModelSpec } from '@/game/render/useModel';
import { runtime } from '@/game/state/runtime';

/** Reused for every instance matrix write - never allocate inside useFrame. */
const scratch = new THREE.Object3D();

/**
 * The whole snow surface: field, groomed run and lane grooves in one draw.
 *
 * It translates rather than staying still. A merged surface is static geometry,
 * and static tonal bands under a moving player read as ground that is not
 * moving - so the mesh slides towards the camera and snaps back a whole pattern
 * period at a time, which `groundGeometry` guarantees is invisible.
 */
function Ground() {
  const meshRef = useRef<THREE.Mesh>(null);

  /*
   * The device is asked what anisotropic filtering it can do rather than being
   * given a guess. The ground is viewed at roughly 11:1 at forty metres, so the
   * usual hardcoded four taps recovers about a quarter of the sharpness that is
   * actually available - and asking costs one call at mount.
   *
   * `capabilities` is fixed for the life of the context, so this selector can
   * never fire a re-render, which is the only thing that would matter here.
   */
  const maxAnisotropy = useThree((state) => state.gl.capabilities.getMaxAnisotropy());

  const { geometry, material } = useMemo(() => {
    const surface = groundSurface();
    // The map is hung here rather than inside `groundMaterial()` so that
    // building the surface stays free of the DOM: `tests/ground.test.ts` builds
    // the real geometry in node, and a canvas in the constructor would end that.
    if (!surface.material.map) {
      surface.material.map = snowAlbedoTexture(maxAnisotropy);
      // A material that gains a map after its first compile needs telling, or
      // the shader it already has is one with no `USE_MAP` define in it.
      surface.material.needsUpdate = true;
    }
    return surface;
  }, [maxAnisotropy]);

  useFrame(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    mesh.position.z = groundScrollZ(runtime.distance);
  });

  return (
    <mesh
      ref={meshRef}
      geometry={geometry}
      material={material}
      receiveShadow
      // Half a kilometre of surface with the camera sitting on it. The cull
      // test can only ever say "visible", so skip it as the rest of the
      // scrolling track does.
      frustumCulled={false}
    />
  );
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
      /*
       * The trees cast, and the shadow is the point rather than the tree.
       *
       * A pine at x = -5.5 only enters the frame horizontally past z <= -12.6,
       * so the tree itself is barely ever on screen. Its shadow is: the key
       * sits at [-46, 52, -20], which throws roughly 0.88 m of shadow across
       * the slope per metre of height, so a four-metre pine beside the fence
       * lays a dark shape well inside the left lane and sweeps it down the
       * track. That is the best speed cue the scene has and the one thing that
       * puts a moving dark value on a pale surface.
       *
       * It is also the most expensive item in this package: `InstancedMesh`
       * does no per-instance culling, so all 48 of the densest models in the
       * game are submitted to the shadow pass every frame. If the device
       * measurement says the frame is shadow-bound, this line is the first
       * thing to cut - and the fallback is a low-poly cone proxy at the same
       * transforms, never a smaller shadow map, which would cost every other
       * caster in the scene.
       *
       * No `receiveShadow`: a pine standing in another pine's shadow is not
       * visible from the piste, and leaving it off keeps the fragment shader
       * off the shadow map on the densest geometry in the frame.
       */
      castShadow
    />
  );
}

/** Snow-laden pines lining both sides of the run. */
function Pines({ count = 48 }: { count?: number }) {
  const layout = useMemo(() => pineLayout(count), [count]);

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
      <Pines />
    </>
  );
}
