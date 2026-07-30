/**
 * Where the player is going to come down.
 *
 * A soft disc pinned to `(lane.x, 0)` that grows and strengthens with height,
 * standing in for the cast shadow exactly where the cast shadow stops being
 * usable. `LANDING_MARK` carries the measurement; the part worth repeating here
 * is that this is a **playability** element. With the player at four metres a
 * grid sampled across the lower frame came back uniform snow - no shadow
 * anywhere in it - so at the top of every ramp arc the game asks for a lane
 * decision and shows nothing to make it against.
 *
 * **The fix is not to raise the key light.** The obstacle shadows this rig
 * throws are the strongest thing in the build and their *length* is what makes
 * them read; lifting the sun to keep an airborne shadow on screen would flatten
 * every chalet, fence and pine in the game to buy back one sprite.
 *
 * It replaces the contact blob that used to live in `Scene.tsx`, which is why
 * this costs no draw call - and it replaces it on a measurement rather than on
 * a preference. That blob composited `PALETTE.snowShadow` at 0.32, and
 * `snowShadow` is an *albedo*: run through an unlit basic material and ACES it
 * reaches the screen at luminance 149, which is **brighter than the lit piste at
 * 144.5**. Over the piste - the surface the player actually rides - the contact
 * shadow was lightening the snow by 1.4 levels, and over the untouched field it
 * was worth 5.1. The ~70-level contact shadow the frame really has, and which is
 * genuinely good, is the key light's, not that quad's.
 *
 * Nothing here reads React state and nothing is allocated per frame: one
 * texture, one plane, three numbers written through a ref.
 */

import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { TUNING } from '@/game/config/tuning';
import { LANDING_MARK } from '@/game/config/visuals';
import { landingMarkAt, landingMarkTexels, MARK_TEXTURE_SIZE } from '@/game/render/landing';
import { runtime } from '@/game/state/runtime';

/**
 * The falloff, uploaded once as raw bytes.
 *
 * The profile itself lives in `landing.ts` - see `landingMarkTexels` for why it
 * is a byte array rather than a 2D canvas, which is a correctness argument and
 * not a tidying one. Everything left here is the three-side plumbing.
 */
function markTexture(): THREE.DataTexture {
  const texture = new THREE.DataTexture(
    landingMarkTexels(),
    MARK_TEXTURE_SIZE,
    MARK_TEXTURE_SIZE,
    THREE.RGBAFormat,
  );

  /*
   * `DataTexture` defaults to **nearest** filtering with no mipmaps, alone
   * among three's texture classes - so left at its defaults this ships a
   * 64-texel disc magnified about 3.5x, which is a visible staircase all the way
   * round the rim of the one element in the frame whose whole job is to read as
   * penumbra. It is a default, not an omission, and it has to be overridden.
   *
   * Linear *without* a mip chain is the correct pair rather than half a job:
   * the disc is 1.4 m across at nine metres, so it is only ever magnified and
   * no level below zero is ever sampled. Generating them would cost upload time
   * and a third again in memory to hold images nothing can reach.
   *
   * The colour space is left at `NoColorSpace`, which is right for both
   * channels: the RGB is a flat 255 that no transfer function can move, and
   * alpha is never encoded.
   */
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

export function LandingMark() {
  const meshRef = useRef<THREE.Mesh>(null);
  const texture = useMemo(() => markTexture(), []);

  // External-system cleanup rather than state synchronisation, which is the one
  // sanctioned use of an effect under this project's React rules and the same
  // one `Player.tsx` documents. The Canvas mounts once for the session, so in a
  // build this never fires; under a development hot reload it is the difference
  // between reloading and leaking a texture and its upload on every edit.
  useEffect(() => () => texture.dispose(), [texture]);

  useFrame(() => {
    const mesh = meshRef.current;
    if (!mesh) return;

    const { radius, strength } = landingMarkAt(runtime.player.y);

    /*
     * Skipped outright on the snow rather than drawn at zero strength.
     *
     * Most of a run is spent grounded, so this is the difference between one
     * draw call and none across the majority of frames, on a frame already
     * running at about 50 against a budget near 60. A quad at zero strength is
     * not free: it still costs the blend state, the bind and a metre and a half
     * of rasterised snow that provably cannot change a pixel.
     */
    mesh.visible = strength > 0;
    if (!mesh.visible) return;

    // The *current* lateral position, not the target lane. Mid-swipe the player
    // is genuinely between lanes and will land between them; showing where the
    // ease has actually reached is the honest answer and the continuous one.
    mesh.position.x = runtime.lane.x;
    // The plane is two units across, so a uniform scale of `radius` gives a disc
    // of exactly that radius in metres.
    mesh.scale.setScalar(radius);
    (mesh.material as THREE.MeshBasicMaterial).opacity = strength;
  });

  return (
    <mesh
      ref={meshRef}
      // Off until the first frame says otherwise, so a mount at ground level
      // never flashes a full-strength disc for one frame.
      visible={false}
      rotation={[-Math.PI / 2, 0, 0]}
      position={[0, LANDING_MARK.y, TUNING.player.z]}
      /*
       * First in the transparent pass, which is the one ordering question a
       * multiply cannot be relaxed about: it darkens whatever is already in the
       * framebuffer, so anything drawn *before* it is treated as lying on the
       * snow. That is right for the ground and wrong for everything else in the
       * pass - the carve trail, the spray and the falling snow are all
       * `depthWrite: false`, so the depth buffer cannot sort them out, and a
       * near flake between the lens and the player would otherwise be dimmed by
       * a mark nine metres behind it.
       *
       * The cost of going first is that the mark cannot darken the trail it
       * lies over, which is physically the wrong way round and practically
       * nothing: the trail stops being laid the instant the player leaves the
       * snow, and the last sample has scrolled five metres behind them before
       * the mark has any strength worth seeing.
       */
      renderOrder={-1}
    >
      <planeGeometry args={[2, 2]} />
      {/*
        A **multiply**, and every flag below is load-bearing to that.

        `tint` is a display-space factor rather than a colour, which is what
        makes one constant correct over both surfaces the mark lands on: the
        piste is a mid blue and the field beside it is near-white, so a fixed
        shadow colour that reads on one is wrong on the other. It therefore has
        to reach the framebuffer unaltered - hence `toneMapped` off, and `fog`
        off, because this stands in for a shadow lying on a surface the fog has
        already tinted and fogging the multiplier too would apply it twice.

        `premultipliedAlpha` is not a detail here, it is the mechanism, and
        three will refuse `MultiplyBlending` without it. The pair resolves to
        `blendFuncSeparate(DST_COLOR, ONE_MINUS_SRC_ALPHA, ZERO, ONE)`, so the
        result is `dst * (src.rgb + 1 - src.a)` - and three premultiplies
        *after* the colour-space encode, in the display space the multiply lives
        in. The shader hands over `src.rgb = tint * strength * falloff` and
        `src.a = strength * falloff`, which lands exactly on
        `dst * mix(1, tint, strength * falloff)`: full tint at the core, no-op at
        the rim, and no clamping anywhere in between.

        `depthWrite` off with a polygon offset for the same reason the carve
        trail has one - it sits 20 mm above a surface it must never z-fight with
        at a grazing angle - and pulled one step further than the trail's, since
        it is one step higher off the snow.
      */}
      <meshBasicMaterial
        map={texture}
        color={LANDING_MARK.tint}
        transparent
        premultipliedAlpha
        blending={THREE.MultiplyBlending}
        toneMapped={false}
        fog={false}
        depthWrite={false}
        polygonOffset
        polygonOffsetFactor={-3}
        polygonOffsetUnits={-3}
      />
    </mesh>
  );
}
