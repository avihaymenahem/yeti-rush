/**
 * Piste marker poles beside the run.
 *
 * The only thing in this game that passes the camera. Every other side element
 * converges on a vanishing point and leaves frame eight to eleven metres ahead,
 * which is the mechanical reason a still at 21 units per second is
 * indistinguishable from one at 12: nothing sweeps, so there is no rate to read.
 * At `MARKERS.spacing` a pole leaves frame about six times a second at the
 * opening speed and ten at the top - an order of magnitude more near-field flow
 * than anything else in the frame, for one instanced draw call.
 *
 * The claim that the camera's narrow half-fov forbids passing objects is a
 * placement argument dressed as a framing one. At `MARKERS.x` a pole leaves
 * frame around `z = -4` at the widened lens, against the fence at 5.1 leaving at
 * about -7.7; the fence has always been too far out to sweep.
 *
 * Two things are deliberately absent.
 *
 * **No `castShadow`.** `MARKERS.x` sits well inside the shadow box, so a pole
 * would lay a hard bar across the snow beside the outer lane sixty times a
 * second. A rhythmic dark band next to the track the player is reading is a
 * readability disaster, and it would arrive as a free side effect of a purely
 * decorative object.
 *
 * **No collider, and none is possible.** `systems/collision.ts` iterates
 * `rt.track.obstacles` and nothing else, so this is decoration by construction
 * rather than by convention. What that buys has to be protected in the *art*:
 * the poles are held under `MARKERS.height` so they can never read as something
 * to jump or duck, and out at `MARKERS.x` so they can never read as something in
 * a lane. The layout that enforces both is in `nearField.ts`.
 */

import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { MARKERS } from '@/game/config/visuals';
import { assemble, vertexColorMaterial } from '@/game/render/mergeParts';
import { markerLayout } from '@/game/render/nearField';
import { wrapZ } from '@/game/render/trackLayout';
import { runtime } from '@/game/state/runtime';

const scratch = new THREE.Object3D();

/** The snow band near the top, the one piece of contrast the pole carries. */
const BAND_COLOR = '#fdf3e4';

/**
 * One pole, built at `MARKERS.height` so a per-instance scale of 1 is exactly
 * the authored ceiling and every roll below it is shorter.
 *
 * Six radial segments. It is a 12 cm stick seen from four metres away - the
 * silhouette is a line, and every segment past what stops it looking square is
 * multiplied by a hundred-odd instances.
 */
function buildPole(): THREE.BufferGeometry {
  const { radius, height } = MARKERS;

  return assemble([
    // Tapered, because a parallel-sided stick reads as a pipe and a slalom pole
    // is thicker where it is driven into the snow.
    {
      geometry: new THREE.CylinderGeometry(radius * 0.85, radius * 1.15, height, 6),
      color: MARKERS.color,
      position: [0, height / 2, 0],
    },
    {
      geometry: new THREE.CylinderGeometry(radius * 1.3, radius * 1.3, height * 0.09, 6),
      color: BAND_COLOR,
      position: [0, height * 0.78, 0],
    },
    // A cap, so the top is not an open tube against the sky.
    {
      geometry: new THREE.SphereGeometry(radius * 0.95, 6, 4),
      color: MARKERS.color,
      position: [0, height, 0],
    },
  ]);
}

export function Markers() {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const geometry = useMemo(() => buildPole(), []);
  const material = useMemo(() => vertexColorMaterial(), []);
  const layout = useMemo(() => markerLayout(), []);

  useFrame(() => {
    const mesh = meshRef.current;
    if (!mesh) return;

    for (let i = 0; i < layout.length; i++) {
      const marker = layout[i]!;
      scratch.position.set(marker.x, 0, wrapZ(marker.zOffset, runtime.distance));
      // Leaned across the track rather than along it, so the lean reads against
      // the vertical of the fence posts behind them.
      scratch.rotation.set(0, 0, marker.lean);
      scratch.scale.setScalar(marker.scale);
      scratch.updateMatrix();
      mesh.setMatrixAt(i, scratch.matrix);
    }

    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh
      receiveShadow
      ref={meshRef}
      geometry={geometry}
      material={material}
      args={[undefined, undefined, layout.length]}
      frustumCulled={false}
    />
  );
}
