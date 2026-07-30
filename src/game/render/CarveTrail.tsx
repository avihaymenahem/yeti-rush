/**
 * The groove the board cuts in the snow.
 *
 * A ring of track-space samples, one every `TRAIL.spacing` metres, rebuilt every
 * frame into a ribbon whose across-track section is a groove: a lip, a wall and
 * a floor either side of the centreline, each side shaded differently because
 * the key light only comes from one of them. The lips are the entire reason it
 * reads as displaced material rather than as a decal painted on the snow - a
 * dark stripe on its own is a skid mark, a dark stripe between two bright ones
 * is a groove - and the asymmetry is the reason it reads as a groove rather than
 * as a symmetrical painted band.
 *
 * That section's *relief* then scales with how hard the board was carving where
 * each sample was laid, and that is the only thing varying the ribbon along its
 * length: with one fixed set of tones a scan down the trench is as flat as the
 * scan across it used to be, and the trail's darkest value is a decal the frame
 * carries the whole time rather than something the player did.
 *
 * The ring, the distance-driven sampling, the carve scalar that sets the width
 * and the section's tones are all in `nearField.ts` with their reasoning. What
 * is here is the plumbing that uploads them.
 *
 * Two things this deliberately does not do. It does not `castShadow` - this is
 * a mark in the snow, and a shadow of a mark is a bug. And it does not run long:
 * the camera sits around `z = +9` and the frame's bottom edge crosses the snow
 * at about `z = +4`, so only the first four or five metres behind the rider are
 * ever rasterised. `TRAIL.samples` buys about 25 m of buffer for that, which is
 * the cheapest place in this package to claw something back if the frame is
 * tight.
 */

import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { TUNING } from '@/game/config/tuning';
import { TRAIL } from '@/game/config/visuals';
import { clamp01, lerp } from '@/game/core/math';
import {
  advanceTrail,
  buildCarveRibbon,
  carve01,
  carveSection,
  createTrail,
  DIG_STEPS,
  trenchDepth01,
  type TrailRing,
} from '@/game/render/nearField';
import { runtime } from '@/game/state/runtime';

/**
 * The across-track section, built once. Only its geometry and its alpha profile
 * are read here - the tones come from the depth ladder below, and this is the
 * fully carved section, which is the deepest rung of it.
 *
 * Every vertex is shared by the two strips that meet at it - the opposite of
 * what shipped, which duplicated them so each colour break would be hard. With
 * only a trench and two lips that duplication was right: a shared vertex would
 * have blended the lip into the trench and given back the whole read. With a
 * wall between them, sharing *is* the read, and the interpolator draws both
 * gradients for nothing.
 */
const SECTION = carveSection();
const VERTICES_PER_SAMPLE = SECTION.length;

/**
 * The section's tones at each depth of carve, in linear RGB, converted once.
 * `THREE.Color` does the sRGB decode on assign.
 *
 * `DIG_STEPS` carries the reasoning for why this is a ladder of authored
 * sections and not a blend between two of them.
 */
const TONE_LADDER = Array.from({ length: DIG_STEPS + 1 }, (_, step) =>
  carveSection(step / DIG_STEPS).map((vertex) => new THREE.Color(vertex.tone)),
);

export function CarveTrail() {
  const meshRef = useRef<THREE.Mesh>(null);
  const trailRef = useRef<TrailRing>(null);
  const elapsedRef = useRef(0);

  const geometry = useMemo(() => buildCarveRibbon(), []);

  useFrame((_, delta) => {
    const mesh = meshRef.current;
    if (!mesh) return;

    trailRef.current ??= createTrail();
    const trail = trailRef.current;

    elapsedRef.current += delta;
    const now = elapsedRef.current;

    const motion = runtime.player.motion;
    const onSnow = motion === 'running' || motion === 'sliding';
    const carve = carve01(runtime.lane, runtime.board.control);
    const halfWidth = lerp(TRAIL.baseWidth, TRAIL.carveWidth, carve) / 2;

    advanceTrail(
      trail,
      runtime.distance,
      runtime.lane.x,
      halfWidth,
      onSnow && runtime.running && runtime.alive,
      now,
    );

    // Fetched through the mesh rather than closed over, so the buffers stay
    // owned by the geometry and this callback owns nothing across renders.
    const positionAttribute = mesh.geometry.getAttribute('position');
    const colorAttribute = mesh.geometry.getAttribute('color');
    const positions = positionAttribute.array as Float32Array;
    const colors = colorAttribute.array as Float32Array;

    const n = trail.x.length;
    for (let k = 0; k < n; k++) {
      // Oldest first, so buffer order is age order and the static index buffer
      // stitches neighbours rather than the wrap.
      const slot = (trail.cursor + k) % n;
      const x = trail.x[slot]!;
      const hw = trail.halfWidth[slot]!;
      // The sample was laid when the world had travelled `laidAt`; everything
      // since has scrolled it towards the camera by the difference.
      const z = TUNING.player.z + (runtime.distance - trail.laidAt[slot]!);
      const age = now - trail.bornAt[slot]!;
      // Real seconds, not distance travelled, so a ribbon left behind by a run
      // that has ended dissolves instead of freezing on the snow.
      const alpha = trail.live[slot]! * clamp01(1 - age / TRAIL.fadeSeconds);
      /*
       * How hard the board was carving here, recovered from the half width the
       * sample already carries. It picks the section's relief, so the groove is
       * deeper where the rider worked and shallower where they ran straight -
       * which is the only thing that varies the ribbon *along* its length. Fixed
       * tones would leave a scan down the trench as bit-identical as the scan
       * across it used to be.
       */
      const tones = TONE_LADDER[Math.round(trenchDepth01(hw) * DIG_STEPS)]!;

      for (let v = 0; v < VERTICES_PER_SAMPLE; v++) {
        const across = SECTION[v]!;
        const vertex = k * VERTICES_PER_SAMPLE + v;

        // Only the floor widens with the carve. The wall and the lip are
        // properties of the snow rather than of the turn, so a hard carve digs
        // in rather than merely spreading out.
        positions[vertex * 3] = x + across.side * (hw + across.out);
        positions[vertex * 3 + 1] = TRAIL.y;
        positions[vertex * 3 + 2] = z;

        const tone = tones[v]!;
        colors[vertex * 4] = tone.r;
        colors[vertex * 4 + 1] = tone.g;
        colors[vertex * 4 + 2] = tone.b;
        colors[vertex * 4 + 3] = alpha * across.alpha;
      }
    }

    positionAttribute.needsUpdate = true;
    colorAttribute.needsUpdate = true;
  });

  return (
    <mesh ref={meshRef} geometry={geometry} frustumCulled={false}>
      {/*
        Unlit, and the section is the reason rather than the tones.

        The ribbon is a flat sheet at `TRAIL.y` - every normal in it points
        straight up - so a lit material would hand all seven strips the same
        `N.L` and shade a groove exactly as it shades the snow beside it. The
        lit wall and the shaded one exist only as authored value, and a light
        can only take them away.

        `TRAIL.color`, `wallColor` and `lipColor` are *inputs to the tone curve*
        and not display values, whatever the comment here used to say:
        `meshBasicMaterial` has `toneMapped` on, so an authored hex is decoded,
        run through ACES at `ATMOSPHERE.exposure` and re-encoded like everything
        else. Check a change through the curve, or the trench comes out more
        saturated than it was written - which is precisely how it ended up
        measuring chroma 114 against the 60 of the lit piste.

        `depthWrite` off with a polygon offset, because it sits 16 mm above a
        surface it must never z-fight with at a grazing angle.
      */}
      <meshBasicMaterial
        vertexColors
        transparent
        depthWrite={false}
        side={THREE.DoubleSide}
        polygonOffset
        polygonOffsetFactor={-2}
        polygonOffsetUnits={-2}
      />
    </mesh>
  );
}
