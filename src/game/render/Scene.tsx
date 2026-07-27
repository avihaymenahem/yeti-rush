/**
 * Scene assembly and the camera rig.
 *
 * Deliberately cheap: exactly one shadow-casting light, no environment map, no
 * render-target post-processing. A shadow pass is affordable here only because
 * the player never moves, so the shadow camera is a small fixed box rather than
 * a frustum chasing a character - see `SHADOW`. The grade is a DOM overlay
 * rather than a fullscreen pass (see `.grade` in index.css) so it costs the 3D
 * pipeline nothing at all.
 *
 * What does the visual work instead is hue: a warm key against cool ambient and
 * a cold rim, a graded sky with a sun in it, and layered mountains for depth.
 */

import { useFrame } from '@react-three/fiber';
import { lazy, Suspense, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { TUNING } from '@/game/config/tuning';
import { ATMOSPHERE, PALETTE } from '@/game/config/visuals';
import { clamp01, damp } from '@/game/core/math';
import { Chaser } from '@/game/render/Chaser';
import { CoinField } from '@/game/render/CoinField';
import { Fences } from '@/game/render/Fences';
import { GameLoop } from '@/game/render/GameLoop';
import { Lighting } from '@/game/render/Lighting';
import { Mountains } from '@/game/render/Mountains';
import { Obstacles } from '@/game/render/Obstacles';
import { Pickups } from '@/game/render/Pickups';
import { PlatformBridge } from '@/game/render/PlatformBridge';
import { Player } from '@/game/render/Player';
import { Rails } from '@/game/render/Rails';
import { Ramps } from '@/game/render/Ramps';
import { Sky } from '@/game/render/Sky';
import { Snow } from '@/game/render/Snow';
import { SnowSpray } from '@/game/render/SnowSpray';
import { Track } from '@/game/render/Track';
import { Village } from '@/game/render/Village';
import { runtime } from '@/game/state/runtime';
import { cameraDistanceFor } from '@/game/systems/camera';
import { chaserPressure } from '@/game/systems/chaser';

/**
 * The perf overlay is reached only through this dynamic import, inside a branch
 * `import.meta.env.DEV` folds to `false` in production. That is what keeps
 * `r3f-perf` (~220 kB) out of the shipped bundle - a static import would ship
 * it to every player for a tool none of them can open.
 */
const PerfOverlay = import.meta.env.DEV
  ? lazy(() => import('@/game/render/PerfOverlay'))
  : null;

/** Extra degrees of field of view at top speed. */
const SPEED_FOV_KICK = 9;
/** How hard the camera shakes when the patrol is right behind. */
const PRESSURE_SHAKE = 0.06;

/**
 * Chase camera. It follows the player's lane only partially - a camera locked
 * to the player makes the lane change invisible, because nothing moves
 * relative to the frame - and it pulls back far enough that the outer lanes
 * stay on screen at the current aspect ratio.
 *
 * Field of view widens with speed. That is the cheapest speed cue there is: the
 * edges of the frame stretch as the run accelerates, and it costs nothing.
 */
function CameraRig() {
  const shakeRef = useRef(0);

  // The camera comes from the frame state rather than `useThree` - this rig
  // only ever mutates it imperatively, so there is nothing to subscribe to.
  useFrame(({ camera, size }, delta) => {
    const targetX = runtime.lane.x * TUNING.camera.laneFollow;
    camera.position.x = damp(camera.position.x, targetX, 0.0001, delta);

    // Rise a little with the player so a jump does not leave the frame.
    const targetY = TUNING.camera.height + runtime.player.y * TUNING.camera.jumpFollow;
    camera.position.y = damp(camera.position.y, targetY, 0.0001, delta);

    // Recomputed per frame so a rotation or split-screen resize reframes
    // immediately; it is a handful of arithmetic ops.
    const targetZ = cameraDistanceFor(size.width / size.height);
    camera.position.z = damp(camera.position.z, targetZ, 0.0001, delta);

    const perspective = camera as THREE.PerspectiveCamera;
    if (perspective.isPerspectiveCamera) {
      const speed01 = clamp01(
        (runtime.speed - TUNING.speed.start) / (TUNING.speed.max - TUNING.speed.start),
      );
      const targetFov = TUNING.camera.fov + speed01 * SPEED_FOV_KICK;
      const nextFov = damp(perspective.fov, targetFov, 0.02, delta);
      if (Math.abs(nextFov - perspective.fov) > 0.001) {
        perspective.fov = nextFov;
        perspective.updateProjectionMatrix();
      }
    }

    // A rumble that builds as the patrol closes in, so the danger is felt
    // before it is seen.
    const pressure = runtime.running ? chaserPressure(runtime.chaser) : 0;
    shakeRef.current += delta * 34;
    const shake = pressure * pressure * PRESSURE_SHAKE;
    camera.position.x += Math.sin(shakeRef.current) * shake;
    camera.position.y += Math.cos(shakeRef.current * 1.37) * shake;

    camera.lookAt(
      runtime.lane.x * TUNING.camera.laneFollow * 0.5,
      TUNING.camera.lookAtHeight,
      TUNING.camera.lookAheadZ,
    );
  });

  return null;
}

/** Faint, because the key light's cast shadow is now the dramatic one. */
const CONTACT_OPACITY = 0.2;

/**
 * A flat translucent disc directly under the player, shrinking and fading as
 * they rise.
 *
 * Kept even now that the key light casts real shadows, and deliberately made
 * fainter rather than removed. The cast shadow is thrown off to the right by a
 * raking light, which is what sells the lighting but is a poor altitude gauge -
 * height and lane offset both move it sideways. This sits square underneath and
 * answers "how high am I, over what" on its own, which at thirty units a second
 * is a gameplay readout rather than decoration.
 */
/**
 * A radial falloff drawn once into a small canvas.
 *
 * The disc this replaced was a sixteen-segment circle with a hard rim, which
 * read as a polygon stamped on the snow next to a genuinely soft cast shadow.
 * A gradient costs one 64x64 texture and no geometry, and needs no shader.
 * `pow` on the alpha keeps the middle dark and pulls the falloff outwards,
 * because a straight linear ramp reads as a grey smudge with no centre.
 */
function contactTexture(): THREE.Texture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;

  const context = canvas.getContext('2d');
  if (context) {
    const image = context.createImageData(size, size);
    const centre = (size - 1) / 2;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = (x - centre) / centre;
        const dy = (y - centre) / centre;
        const falloff = clamp01(1 - Math.hypot(dx, dy));
        const i = (y * size + x) * 4;
        image.data[i] = 255;
        image.data[i + 1] = 255;
        image.data[i + 2] = 255;
        image.data[i + 3] = Math.round(255 * Math.pow(falloff, 1.6));
      }
    }
    context.putImageData(image, 0, 0);
  }

  const texture = new THREE.Texture(canvas);
  texture.needsUpdate = true;
  return texture;
}

function BlobShadow() {
  const meshRef = useRef<THREE.Mesh>(null);
  const texture = useMemo(() => contactTexture(), []);

  useFrame(() => {
    const mesh = meshRef.current;
    if (!mesh) return;

    mesh.position.x = runtime.lane.x;
    // Full size and darkest on the ground, gone by peak jump height.
    const height01 = clamp01(runtime.player.y / TUNING.player.jumpPeakHeight);
    mesh.scale.setScalar(1 - height01 * 0.45);
    (mesh.material as THREE.MeshBasicMaterial).opacity = CONTACT_OPACITY * (1 - height01 * 0.7);
  });

  return (
    <mesh ref={meshRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, TUNING.player.z]}>
      <planeGeometry args={[1.5, 1.5]} />
      <meshBasicMaterial
        map={texture}
        color={PALETTE.snowShadow}
        transparent
        opacity={CONTACT_OPACITY}
        depthWrite={false}
      />
    </mesh>
  );
}

export function Scene() {
  return (
    <>
      {/* Insurance behind the sky dome. Without an explicit background the
          renderer clears to black, which is what shows through if the dome is
          ever clipped or fails to compile. */}
      <color attach="background" args={[PALETTE.fog]} />

      {/* Exponential-squared, so the falloff is gentle nearby and closes in
          hard at distance - linear fog puts a visible band across the slope. */}
      <fogExp2 attach="fog" args={[PALETTE.fog, ATMOSPHERE.fogDensity]} />

      <Lighting />
      <Sky />
      <Mountains />

      <CameraRig />
      <GameLoop />
      <PlatformBridge />

      <Track />
      <Fences />
      <Village />
      <Ramps />
      <Rails />
      <Obstacles />
      <CoinField />
      <Pickups />
      <Chaser />
      <Player />
      <BlobShadow />
      <SnowSpray />
      <Snow />

      {PerfOverlay && (
        <Suspense fallback={null}>
          <PerfOverlay />
        </Suspense>
      )}
    </>
  );
}
