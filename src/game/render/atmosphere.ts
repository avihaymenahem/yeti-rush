/**
 * The colour pipeline everything in the frame has to agree with.
 *
 * Three separate jobs that are all the same job:
 *
 *  - **The sky gradient, in TypeScript.** `Sky.tsx` evaluates it on the GPU and
 *    the mountain ranges bake it into vertex colours, so the two have to be the
 *    same function. The band edges live here once and are uploaded to the sky
 *    shader as a uniform rather than written twice.
 *  - **The fog colour as a *display* value.** `PALETTE.fog` is mixed by three
 *    *after* `<tonemapping_fragment>` and `<colorspace_fragment>` and uploaded
 *    through `getUnlitUniformColorSpace`, so it is a literal pixel and not
 *    comparable to any other authored colour. The sky's horizon join has to
 *    reach exactly that pixel, which means the join has to happen after the
 *    same two chunks.
 *  - **The rim term.** The only mechanism this renderer has for separating a
 *    silhouette from what is behind it.
 *
 * Why a rim needs to be a *material* term and cannot be a light: both the key
 * (`[-46, 52, -20]`) and `SKY.sunDirection` point down-track, so a surface
 * facing the camera has `N.L < 0` against both and receives nothing from
 * either. The only thing reaching it is `hemisphereLight`, whose
 * `mix(ground, sky, 0.5 * dot(N, up) + 0.5)` gives *every* vertical face in the
 * scene the identical fifty-fifty value regardless of which way it points. That
 * is the mechanical reason a white yeti dissolves into white snow: nothing in
 * the rig varies with the viewing angle, and a silhouette is a viewing-angle
 * phenomenon.
 */

import * as THREE from 'three';
import { PALETTE, SKY } from '@/game/config/visuals';
import { clamp01, smoothstep } from '@/game/core/math';

/**
 * The two smoothstep bands of the sky gradient, as sines of elevation.
 *
 * A single mix from horizon to zenith washes the middle of the sky out, so the
 * dome is horizon-into-mid then mid-into-zenith. Uploaded to `Sky.tsx` as a
 * `vec4` rather than written into the GLSL, because `Mountains.tsx` bakes the
 * same curve into vertex colours and two copies of four numbers is how the
 * ranges end up hazing towards a sky that is no longer there.
 *
 * **These four numbers are the frame's value structure, not a taste setting,
 * and they were the measured cause of "the sky and the snow are the same
 * luminance".** The camera pitches about 6.8 degrees down and the vertical fov
 * is 58, so the visible sky spans elevation 0 to about 22 degrees - `h` from 0
 * to 0.38 - and fills roughly 39% of a portrait frame. The old bands spent that
 * entire window on the *horizon-into-mid* leg: `lowerTo` at 0.3 is 17.5 degrees,
 * so the sky was still 56% hot horizon four fifths of the way up the frame, and
 * a rendered histogram over the visible dome came out at a mean of 160 and a
 * median of 163 with 77% of it above 150 - against snow measured at 157 to 172.
 * The two largest areas in the world had no value separation because the sky
 * never got round to falling off inside the part of it anybody can see.
 *
 * Both legs are pulled down so the whole journey happens *within* the visible
 * band. The horizon glow now closes by about 6.3 degrees and the zenith mix is
 * over half done by 22, which puts the visible dome at a mean of 125 and a
 * median of 125 with 13% above 150. Nothing was repainted: the three authored
 * hexes are untouched and the darks come from the gradient reaching them.
 *
 * Two constraints bound how far this can go, and both are checked in
 * `tests/atmosphere.test.ts` rather than trusted:
 *
 *  - `lowerFrom` sets the value at `h = 0`, which has to stay within a few
 *    points of the fog or the horizon acquires a seam. At -0.03 the sky meets
 *    the fog at 157.5 against 154.4.
 *  - Every mountain vertex hazes towards this curve at its *own* elevation, and
 *    the ranges top out at 10 to 18 degrees - squarely inside the leg that just
 *    moved. Dropping the sky there without dropping the rock with it inverts
 *    figure and ground, which is why `PALETTE.mountainFar/Mid/Near` came down in
 *    the same change and must move with it again if these are ever retuned.
 */
export const SKY_GRADIENT = {
  lowerFrom: -0.03,
  lowerTo: 0.11,
  upperFrom: 0.05,
  upperTo: 0.66,
} as const;

const zenith = new THREE.Color(PALETTE.skyZenith);
const midSky = new THREE.Color(PALETTE.skyMid);
const horizon = new THREE.Color(PALETTE.skyHorizon);

/**
 * The sky's colour looking along a direction whose Y component is `h`, in the
 * renderer's working (scene-linear) space - i.e. the value that goes *into* the
 * tone curve, not the pixel that comes out.
 *
 * That is the useful form for the mountains: the ranges are `meshBasicMaterial`
 * and therefore tone-mapped by the same curve as the dome, so a range whose
 * colour matches this function at its own elevation is behind the sky by
 * construction, however the exposure or the tone mapper is later retuned.
 *
 * The sun is deliberately not included. It is an emitter sitting in one
 * direction, not part of the gradient, and a mountain that hazed towards it
 * would carry a bright patch that did not move when the sun did.
 */
export function skyGradientAt(h: number, target = new THREE.Color()): THREE.Color {
  const height = Math.max(-1, Math.min(1, h));
  const lower = smoothstep(
    (height - SKY_GRADIENT.lowerFrom) / (SKY_GRADIENT.lowerTo - SKY_GRADIENT.lowerFrom),
  );
  const upper = smoothstep(
    (height - SKY_GRADIENT.upperFrom) / (SKY_GRADIENT.upperTo - SKY_GRADIENT.upperFrom),
  );

  return target.copy(horizon).lerp(midSky, lower).lerp(zenith, upper);
}

/**
 * The sun's halo, as the scene-linear amount of `PALETTE.sunGlow` the dome adds
 * looking `dotToSun` off the disc.
 *
 * Exists for the same reason {@link rimTerm} does: the shape of the term has to
 * be checkable without a GL context, and it is two lines. Kept in step with the
 * dome's fragment shader by hand.
 *
 * It earns the mirror. The glow is an *additive* term on a sky sitting near 0.1
 * scene-linear, so wherever it is appreciable it decides the pixel - and at the
 * width it originally shipped at, "appreciable" meant essentially the whole
 * visible dome. Any measurement of what the sky is worth that leaves this out is
 * measuring a sky nobody sees.
 */
export function sunGlowTerm(dotToSun: number): number {
  return (
    Math.pow(Math.max(dotToSun, 0), 1 / Math.max(SKY.sunGlowSize, 0.001)) * SKY.sunGlowStrength
  );
}

/**
 * `PALETTE.fog` as the pixel it actually becomes.
 *
 * Round-tripped through `THREE.Color` exactly as `WebGLMaterials.refreshFogUniforms`
 * does rather than parsed straight out of the hex, so that if three's colour
 * management is ever reconfigured this moves with the renderer instead of
 * quietly disagreeing with it.
 */
export function fogDisplayColour(target = new THREE.Color()): THREE.Color {
  new THREE.Color(PALETTE.fog).getRGB(target, THREE.SRGBColorSpace);
  return target;
}

/**
 * How a distant range resolves against the sky it stands in front of.
 *
 * This lives here rather than with the geometry on purpose: none of it is about
 * the *shape* of a mountain, all of it is about the value a mass takes when
 * there is three hundred metres of air in front of it. `Mountains.tsx` owns the
 * ridge line; this owns everything that decides whether that ridge reads as
 * depth or as a cut-out.
 */
export const RANGE_SHADING = {
  /**
   * Distance, in metres, at which aerial perspective is taken to be total.
   *
   * Derived rather than written down per layer: at 300 / 220 / 160 the three
   * ranges land on 0.75 / 0.55 / 0.40, which is the ordering the palette's
   * chroma grading already assumes. Moving a layer's `z` moves its haze with
   * it, which is the whole reason this is one number and not three.
   */
  hazeFullDistance: 400,
  /**
   * Fraction of a layer's haze that survives at its ridgeline.
   *
   * Haze is deepest at the base and thinnest at the top. That is not physics -
   * the whole range sits at essentially one distance - it is what mountain
   * painters do, and it is what makes a flat strip read as a mass in air rather
   * than a paper cut-out. It has to stop above zero, or a distant snow cap
   * arrives at full strength against a sky it is meant to be three hundred
   * metres behind.
   */
  hazeAtRidge: 0.25,
  /**
   * How far the body darkens towards the ridge.
   *
   * The dark band under the snowline is what gives a range a *silhouette*, and
   * without it the far layer sits about eleven points of display luminance
   * *above* the sky over its own ridgeline - figure and ground inverted, which
   * is most of what made these read as cardboard. The previous build had it the
   * other way up: it lerped the top towards white and left the base at full
   * strength, under a comment correctly stating that "the silhouette has to
   * stay dark for the layers to read as separate ranges".
   */
  ridgeShade: 0.4,
  /**
   * The snowline, as a fraction of the layer's nominal height, and how much
   * snow sits above it.
   *
   * A snowline is an *altitude*, not a property of each peak, which is exactly
   * what the previous curve got wrong: `smoothstep(h / height, 0.55, 1.0)`
   * scaled by 0.85, against peak factors drawn from `[0.62, 1.0]`, evaluates to
   * **0.055** at the low end. Most peaks had no cap at all and a handful had a
   * full one, so there was no line - just a few white triangles. Over a much
   * narrower band the boundary runs across the flanks at one height, which is
   * what reads as a massif.
   *
   * `capStrength` is well under 1 because a full-strength cap lands around 84%
   * display luminance against a sky at 41%: a hard white band, not snow at
   * three hundred metres.
   *
   * **It is a contrast against the sky, not a value, and that is why it moved
   * when the sky did.** At 0.5 the caps stood 82, 70 and 46 display levels over
   * the sky at their own ridgelines - which is the arrangement that reads as
   * three ranges in air. Compressing `SKY_GRADIENT` took the dome at those
   * elevations down by about a third and left the caps where they were, so the
   * same 0.5 became 100, 92 and 79 levels of contrast: the peaks stopped being
   * snow and became three glowing pink cones at the vanishing point, which is
   * the brightest, warmest mass in the upper frame and the last place the eye
   * should be pulled to. Found on a device, not in the arithmetic - the previous
   * measurement had explicitly excluded the caps from the inversion check on the
   * correct grounds that snow *is* meant to sit above the sky, and that
   * exclusion is exactly what let this through.
   *
   * At 0.34 the contrast is back to 80, 71 and 57, and the peaks land 24 display
   * levels darker in absolute terms as well - which the frame's value range
   * wants anyway.
   */
  snowLineFrom: 0.5,
  snowLineTo: 0.72,
  capStrength: 0.34,
  /**
   * How far the body swings between the sunlit and the shaded tint across a
   * flank.
   *
   * The key sits far to the left, so the left flank of every peak faces it. A
   * uniform white cap is the giveaway that a range was generated rather than
   * painted; splitting it warm-left and cool-right also softens the body-to-cap
   * boundary, because the shaded side's cap is close in value to the rock under
   * it.
   */
  sunFlank: 0.18,
} as const;

export interface RangeShading {
  /** Horizontal distance from the eye, in metres. How much air is in the way. */
  distance: number;
  /** Nominal height of the range, in metres. */
  height: number;
  /** World Y the strip's base sits at. */
  baseY: number;
  /** Eye height above the snow. */
  eyeY: number;
}

const capLit = new THREE.Color(PALETTE.snowLit);
const capShade = new THREE.Color(PALETTE.snowShadow);
const capMix = new THREE.Color();
const skyBehind = new THREE.Color();

/**
 * The colour of a ridge vertex: the range's own hue darkened towards the
 * ridgeline, a snow cap above the snowline tinted by which way the flank faces
 * the sun, and finally a blend towards whatever the sky is doing in that
 * vertex's own direction.
 *
 * The last step is the one that matters. The ranges are `meshBasicMaterial` and
 * therefore run through the same tone curve as the dome, so a colour built
 * towards `skyGradientAt` sits behind the sky *by construction* - it stays
 * behind it if the exposure is retuned, if the tone mapper is swapped, or if
 * the sky palette is re-authored, none of which is true of a hand-picked hex.
 *
 * `sunFacing` runs 0 (turned away from the key) to 1 (towards it).
 */
export function rangeVertexColour(
  body: THREE.Color,
  range: RangeShading,
  heightFraction: number,
  sunFacing: number,
  target = new THREE.Color(),
): THREE.Color {
  const t = clamp01(heightFraction);
  const facing = clamp01(sunFacing);

  target.copy(body).multiplyScalar(1 - RANGE_SHADING.ridgeShade * smoothstep((t - 0.25) / 0.7));
  target.multiplyScalar(1 + RANGE_SHADING.sunFlank * (facing - 0.5));

  const cap =
    RANGE_SHADING.capStrength *
    smoothstep(
      (t - RANGE_SHADING.snowLineFrom) / (RANGE_SHADING.snowLineTo - RANGE_SHADING.snowLineFrom),
    );
  if (cap > 0) target.lerp(capMix.copy(capShade).lerp(capLit, facing), cap);

  // The elevation this vertex is actually seen at. `distance` is the horizontal
  // separation exactly, because the ranges ride the camera's Z.
  const dy = t * range.height + range.baseY - range.eyeY;
  skyGradientAt(dy / Math.hypot(dy, range.distance), skyBehind);

  const haze = clamp01(range.distance / RANGE_SHADING.hazeFullDistance);
  const falloff = (1 - t) * (1 - t);
  return target.lerp(
    skyBehind,
    haze * (RANGE_SHADING.hazeAtRidge + (1 - RANGE_SHADING.hazeAtRidge) * falloff),
  );
}

/**
 * The Fresnel rim.
 *
 * `strength` is added to `outgoingLight` *before* tone mapping, which is why it
 * looks absurd next to a 0-1 albedo and is not: ACES compresses hard in the
 * shoulder, and at a typical lit prop value of about 0.5 linear an added 0.8
 * lands as roughly sixteen points of display luminance rather than blowing to
 * white. Anything below about 0.5 is invisible on a device, which is where the
 * first attempt at this landed.
 *
 * `power` is the real knob, and more so here than in a smooth-shaded renderer.
 * Nearly every material in this game is `flatShading: true`, so `N` is constant
 * across a facet and a facet that is edge-on lights up as a whole rather than
 * only at its border. That suits low-poly art - it is the same reason the
 * specular is left faceted - but it means lowering the exponent does not
 * broaden a thin edge, it floods whole polygons. Raise it before raising
 * `strength`.
 */
export const RIM = {
  strength: 1.4,
  power: 3.5,
  /**
   * Warm, towards the sun rather than towards the sky. The piste it has to
   * separate against is a cool mid-blue, so a cool edge would be the one hue in
   * the palette guaranteed not to read.
   */
  color: '#ffd9a6',
  /**
   * How much of the term survives as a surface turns to face straight up or
   * straight down, as `|N.up|` from full to none.
   *
   * This is not a taste setting, it is what stops the rim destroying the frame.
   * A Fresnel term on a horizontal plane seen from a 3.2 m eye is near-total at
   * any distance worth drawing: the ground at forty metres is only 4.6 degrees
   * off the view direction, giving `N.V = 0.08` and a rim of 0.75 - which would
   * pour warm light over the entire mid-ground and refill the exact luminance
   * band the palette pass exists to empty. Fog does not save it either; at forty
   * metres `exp(-d^2 z^2)` is still 0.92.
   *
   * A silhouette is an upright thing standing against something behind it. A
   * floor has nothing behind it, so it gets nothing.
   */
  upFade: [0.55, 0.9],
} as const;

/**
 * Injected before `<opaque_fragment>`, where `outgoingLight` exists and nothing
 * has been tone mapped yet.
 *
 * `normal` and `vViewPosition` are both view-space and both in scope from
 * `<normal_fragment_begin>`; `viewMatrix` comes from the renderer's own
 * fragment prefix. The fog fade recomputes three's exact `FOG_EXP2` transmission
 * (`1 - fogFactor`) rather than approximating it, so the rim disappears into
 * aerial perspective at precisely the rate everything else does - a rim that
 * outlived the fog would draw crisp edges on objects that had otherwise
 * dissolved, which reads as a depth-sorting fault.
 */
const RIM_FRAGMENT = /* glsl */ `
  float rimFacing = 1.0 - saturate( dot( normal, normalize( vViewPosition ) ) );
  float rimTerm = pow( rimFacing, uRimPower );

  vec3 rimUp = normalize( ( viewMatrix * vec4( 0.0, 1.0, 0.0, 0.0 ) ).xyz );
  rimTerm *= 1.0 - smoothstep( uRimUpFade.x, uRimUpFade.y, abs( dot( normal, rimUp ) ) );

  #if defined( USE_FOG ) && defined( FOG_EXP2 )
    rimTerm *= exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
  #endif

  outgoingLight += uRimColor * ( rimTerm * uRimStrength );

  #include <opaque_fragment>
`;

const RIM_UNIFORMS = /* glsl */ `
  #include <common>
  uniform vec3 uRimColor;
  uniform float uRimStrength;
  uniform float uRimPower;
  uniform vec2 uRimUpFade;
`;

/**
 * One function object, shared by every patched material.
 *
 * `Material.customProgramCacheKey` defaults to `onBeforeCompile.toString()`, so
 * a fresh closure per material would key a fresh program per material: the yeti,
 * the props, the rails, the coins and every imported model would each compile
 * their own identical shader, and they would do it during the first frame of the
 * first run. Declaring it once at module scope is the whole reason this is not a
 * method or a factory.
 */
function applyRim(shader: THREE.WebGLProgramParametersWithUniforms): void {
  shader.uniforms.uRimColor = { value: new THREE.Color(RIM.color) };
  shader.uniforms.uRimStrength = { value: RIM.strength };
  shader.uniforms.uRimPower = { value: RIM.power };
  shader.uniforms.uRimUpFade = { value: new THREE.Vector2(RIM.upFade[0], RIM.upFade[1]) };

  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', RIM_UNIFORMS)
    .replace('#include <opaque_fragment>', RIM_FRAGMENT);
}

/** Stated rather than inherited, so the "one variant" promise is visible. */
function rimCacheKey(): string {
  return 'rim';
}

/**
 * Gives a material a camera-facing edge.
 *
 * Only ever applied to `MeshPhongMaterial`, and deliberately per material
 * rather than by overriding the shared `opaque_fragment` chunk: that chunk is
 * also compiled into `MeshBasicMaterial` and into the depth and distance
 * materials the shadow pass builds, none of which have a `normal` or a
 * `vViewPosition` in scope. A global override does not misbehave, it fails to
 * compile and takes the scene with it.
 */
export function patchRim<T extends THREE.Material>(material: T): T {
  material.onBeforeCompile = applyRim;
  material.customProgramCacheKey = rimCacheKey;
  return material;
}

/**
 * The rim's strength for a given `N.V` and surface orientation, in the same
 * units the shader adds to `outgoingLight`.
 *
 * Exists so the shape of the term is checkable without a GL context. Kept in
 * step with {@link RIM_FRAGMENT} by hand, which is only tolerable because it is
 * four lines - if it grows, delete this and test something else.
 */
export function rimTerm(dotNV: number, dotNUp = 0): number {
  const facing = Math.pow(1 - clamp01(dotNV), RIM.power);
  const upright =
    1 - smoothstep((Math.abs(dotNUp) - RIM.upFade[0]) / (RIM.upFade[1] - RIM.upFade[0]));
  return facing * upright * RIM.strength;
}
