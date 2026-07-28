/**
 * Art direction.
 *
 * One palette and one set of atmosphere numbers, so the sky, fog, lighting,
 * snow and grade all agree. Splitting these across the components that use them
 * is how a scene ends up with a warm sun, cold fog and a sky that matches
 * neither.
 *
 * The look is late-afternoon alpine: a low warm sun, deep blue overhead fading
 * to gold at the horizon, warm highlights on the snow and distinctly cool
 * violet-blue shadows. Cold shadows against a warm key is what stops flat-shaded
 * geometry reading as flat - the hue shift does the work that surface detail
 * would otherwise have to.
 *
 * Readability comes first. Obstacles have to be parsed in a fifth of a second,
 * so the grade never crushes contrast between an obstacle and the snow.
 */

/**
 * How much more saturated everything but the sky is drawn.
 *
 * A single place, applied at the point colours become geometry, rather than a
 * hundred hand-picked hex values drifting apart over time.
 *
 * The sky is exempt on purpose and it is the one exemption that matters. It
 * already carries the widest hue journey in the scene - deep blue overhead to a
 * hot horizon - and it fills most of the frame; pushing it further turns a
 * gradient into a poster. Everything *in* the world is the opposite case: flat
 * shading gives geometry no surface detail, so hue and chroma are all it has to
 * separate one thing from another, and a pale palette leaves the slope reading
 * as one sheet of off-white whatever the lighting does.
 *
 * Fog is exempt with the sky. It is the atmosphere the world dissolves into and
 * has to agree with what is behind it, or the horizon acquires a seam.
 */
export const SATURATION = 1.35;

/**
 * Pushes a hex colour's chroma by {@link SATURATION}, leaving hue and lightness
 * alone.
 *
 * Chroma only, deliberately. Lifting lightness would flatten the value contrast
 * the whole art direction rests on, and shifting hue would break the warm-key
 * against cool-shadow split that gives flat-shaded facets their form. A pure
 * saturation push makes the existing palette more itself rather than a new one.
 *
 * A grey stays grey: with no chroma to scale there is nothing to push, which is
 * what keeps snow white and steel neutral instead of turning them lilac.
 */
export function saturate(hex: string, amount: number = SATURATION): string {
  const value = hex.replace('#', '');
  const r = parseInt(value.slice(0, 2), 16) / 255;
  const g = parseInt(value.slice(2, 4), 16) / 255;
  const b = parseInt(value.slice(4, 6), 16) / 255;

  // Scale each channel away from its own luminance. Equivalent to raising HSL
  // saturation, without the round trip through hue - and it degrades gracefully
  // on near-greys, where a hue is meaningless anyway.
  const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const push = (channel: number): string => {
    const lifted = Math.max(0, Math.min(1, luma + (channel - luma) * amount));
    return Math.round(lifted * 255)
      .toString(16)
      .padStart(2, '0');
  };

  return `#${push(r)}${push(g)}${push(b)}`;
}

export const PALETTE = {
  /**
   * Sky, top to bottom.
   *
   * Deliberately a wide hue journey rather than a gentle wash: a deep saturated
   * blue overhead against a hot orange horizon is most of where the scene's
   * colour comes from, since the ground is snow and contributes almost none.
   */
  skyZenith: '#123a7d',
  skyMid: '#4e97d6',
  skyHorizon: '#ffb267',

  /** The sun disc and the glow around it. */
  sunCore: '#fff6e0',
  sunGlow: '#ff9f43',

  /**
   * Snow under direct light, and in shadow.
   *
   * The lit tone is warm and the shadow tone strongly blue. That hue split is
   * doing the work here: flat-shaded geometry has no detail to catch light, so
   * a face turning away from the sun has to change *colour*, not just get
   * darker, or the whole slope reads as one undifferentiated sheet.
   */
  snowLit: saturate('#fdf3e4'),
  snowShadow: saturate('#5f93c9'),

  /**
   * The groomed run, deliberately a good few steps down from the surrounding
   * field. Everything the player has to read at speed - the yeti, snow spray,
   * drifts, the ice wall - is near-white, and on a near-white piste none of it
   * has a silhouette. A mid-tone run is what gives them one.
   */
  piste: saturate('#aecce9'),
  pisteLine: saturate('#7fb0dd'),

  /** Distant ranges, furthest first. Cooler and paler with distance. */
  mountainFar: saturate('#8fb6d8'),
  mountainMid: saturate('#6f9ac4'),
  mountainNear: saturate('#5480b0'),

  /** Atmospheric haze the world fades into. Sits between mid sky and horizon. */
  fog: '#a8cbe4',
} as const;

export const LIGHTING = {
  /**
   * Warm key, hard over to the left and slightly up-slope, so every visible
   * face splits cleanly into a lit left and a shadowed right and the cast
   * shadows fall right and towards the camera where they can be seen.
   *
   * Pushed much further left than it used to sit. A key nearly overhead lights
   * the tops of things and leaves the sides evenly lit, which on flat-shaded
   * geometry means no form at all - the facets need a raking angle to separate.
   *
   * The distance is what the *shadow* camera needs, not the shading: a
   * directional light's contribution depends only on direction, so it is pushed
   * far enough out that the whole visible slope sits inside the shadow frustum.
   *
   * Elevation is set by shadow *length*, and it is the one place the rig
   * knowingly disagrees with the sky. The warm horizon this palette is built
   * around needs a sun sitting almost on the skyline, and a light at that angle
   * throws shadows several times the height of what casts them - a fence turns
   * into a black band across two lanes. So the key is lifted to about 45
   * degrees, where a shadow is roughly as long as its object is tall, while
   * `SKY.sunDirection` keeps the low sun that makes the horizon glow. Stylised
   * art does this constantly; the alternative is choosing between a flat sky and
   * an unreadable slope.
   */
  key: {
    color: '#fff0d2',
    // Raised with the ambient drop. The pair is what sets contrast: a stronger
    // key against a darker fill deepens the shadow *and* brightens what is lit,
    // where lowering ambient alone would only have made the whole slope duller.
    intensity: 3.0,
    position: [-46, 52, -20] as const,
  },
  /**
   * Cool rim from behind the camera's right, catching the near edges of
   * geometry. This is what separates an obstacle from the snow behind it.
   */
  rim: {
    color: '#8fc9ff',
    intensity: 1.0,
    position: [7, 4, 9] as const,
  },
  /**
   * Sky-to-ground bounce, and the only thing lighting faces turned away from
   * the key. Kept deliberately low: a strong ambient fills every shadow and
   * flattens the whole scene back out, which is exactly what the key and rim
   * are there to prevent.
   */
  ambient: {
    sky: '#9fcbec',
    ground: '#d9c9ad',
    /**
     * Ambient is the *only* thing lighting the inside of a cast shadow, so with
     * real shadows in the scene this stopped being "how flat is everything" and
     * became "how dark are the shadows" - and it is the lever for shadow
     * *strength*, which nothing in `SHADOW` controls.
     *
     * Brought back down after the blur was widened. Softening cost density: a
     * heavily blurred variance shadow spreads its darkness over a wider penumbra
     * and bleeds a little light into the core, so the same shadow reads weaker
     * the softer it gets. Lowering ambient puts that density back without
     * touching `radius`, which is the only setting that would have cost softness.
     *
     * The floor is legibility, not taste: too low and a tree lays a black hole
     * in the snow, and anything with a near-white silhouette stops reading
     * against it.
     */
    intensity: 0.36,
  },
} as const;

/**
 * Cast shadows from the key light.
 *
 * The original decision was no shadow maps at all, because a shadow pass is the
 * fastest way to lose 60 fps on a mid-range Android GPU. What makes them
 * affordable here is the treadmill: **the player never moves**, so the shadow
 * camera can be pinned to the origin and never updated. It needs to cover only
 * the near slope, which is a small fixed box rather than a frustum chasing a
 * moving character across an open world - and a static shadow camera also means
 * no texel-snapping shimmer as it slides, which is the usual reason cascades
 * exist. The whole feature is a consequence of an architecture rule chosen for
 * completely different reasons.
 *
 * Only what reads at close range casts. Coins, snow particles, mountains and
 * the sky are all excluded: hundreds of tiny casters would cost the entire
 * saving for shadows too small to resolve.
 */
export const SHADOW = {
  /**
   * Shadow map resolution.
   *
   * Resolution alone was never what made the first attempt look stair-stepped -
   * a fence rail is a hundred millimetres thick, so its shadow is a couple of
   * texels wide however big the map is, and a couple of texels is a staircase.
   * What fixes that is blurring the map (see `blurSamples`); the resolution just
   * decides how much detail there is to blur.
   */
  mapSize: 2048,
  /**
   * Half-extents of the orthographic box, in light space.
   *
   * Tightened hard, because texel density is resolution *divided by area* and
   * the area is the half nobody looks at. This covers the near slope, which is
   * all that matters: past it the fog has taken over and a missing shadow is
   * invisible. Together with the larger map, a texel went from about 4 cm to
   * under 2 cm.
   */
  halfWidth: 19,
  halfDepth: 33,
  near: 20,
  far: 130,
  /**
   * How far the shadow map is blurred, in texels, and how many taps do it.
   *
   * This is the setting that makes a shadow *soft* rather than merely small.
   * PCF - including three's confusingly named `PCFSoftShadowMap` - samples a
   * fixed handful of neighbouring texels, which dithers an edge without ever
   * widening it, so a two-texel-wide shadow stays a two-texel staircase. VSM
   * stores depth statistically and can therefore be genuinely blurred, giving a
   * penumbra with no stepping at any resolution.
   *
   * The cost is light bleeding where one caster stands close behind another.
   * On an open slope with sparse trees that case barely arises, which is what
   * makes VSM the right trade here and the wrong one in an interior.
   *
   * Widened a long way past where this started, in two goes. `radius` is the
   * *softness* and nothing else - it spreads the penumbra without lifting the
   * shadow, so a shadow does not get weaker as it gets softer, which is the
   * trade every other lever here would have made.
   *
   * `blurSamples` has to rise with it. The taps are spread across whatever
   * distance `radius` asks for, so raising one alone thins the sampling until
   * the gradient bands - and a blur sampled too coarsely reads as steps, which
   * is the exact artefact this whole approach exists to remove.
   *
   * The ceiling is light bleeding, not cost: VSM reconstructs a shadow from
   * depth statistics, and blurring hard enough starts letting light through
   * where one caster stands close behind another. On an open slope with sparse
   * trees there is a lot of room before that shows, which is why this can go as
   * wide as it has - the same setting in an interior would have fallen apart
   * long before here.
   */
  radius: 20,
  blurSamples: 36,
  /**
   * VSM does not need the depth bias PCF does - it compares distributions
   * rather than a single depth, so the usual acne does not arise and a bias
   * large enough to matter only detaches shadows from their casters.
   */
  bias: 0,
  normalBias: 0,
} as const;

/**
 * How hard the screen reacts to things happening.
 *
 * Presentation, which is why it lives here and not in `tuning.ts`. None of it
 * can change the outcome of a run - the simulation decides that a crash
 * happened, these numbers only decide what a crash *looks* like. The one
 * genuinely gameplay-side number in the same area, the gap that counts as a
 * near miss, is in `tuning.ts` where it belongs, because it pays score.
 *
 * **There is no camera shake here, and there must not be.** Shake was tried on
 * crashes, landings, near misses and patrol pressure, and it was hated on
 * sight. Worth recording, because shake is the reflex answer to "this moment
 * needs more impact" and would otherwise be reinvented: on a phone held in two
 * hands, a camera that moves when the player did not move it reads as the game
 * malfunctioning rather than as force, and it fights the one thing they are
 * trying to aim. The flash does the same job without moving anything.
 */
export const FEEDBACK = {
  /** Ending the run, and the only thing that flashes the screen. */
  crashFlash: 0.55,

  /**
   * Seconds for the flash to halve. Short: a lingering white veil reads as a
   * broken renderer rather than as an impact.
   */
  flashHalfLife: 0.07,

  /** Below this the impulse is snapped to zero and stops costing anything. */
  epsilon: 0.002,
} as const;

/**
 * Saturation applied to colours baked out of imported models.
 *
 * The CC0 packs are authored for a neutral viewer and land muted against this
 * palette - the pines in particular read grey-green next to a hot horizon.
 * Applied at bake time rather than as a screen-space filter, so it costs
 * nothing per frame and never touches the snow, which is meant to stay pale.
 */
export const IMPORT_SATURATION: number = 1.22;

/**
 * Painted behind the canvas so there is no white flash before the first frame,
 * and used as the native splash colour. Mid-sky rather than horizon, because
 * that is what fills most of the frame.
 */
export const CANVAS_BACKGROUND = PALETTE.skyMid;

/**
 * Behind the launch poster, on both the native splash and the web boot screen.
 *
 * Not `CANVAS_BACKGROUND`: the poster is a dusk scene opening on night sky,
 * while the game itself runs under a pale blue one, so painting the daylight
 * colour behind the splash is a flash of the wrong sky before the right one.
 *
 * Sampled from the top of the art rather than chosen - `scripts/generate-splash.mjs`
 * writes it to `assets/splash.json`, and `tests/splash.test.ts` fails if this
 * and the two native declarations of it ever drift apart from the image.
 */
export const SPLASH_BACKGROUND = '#051844';

/**
 * Specular response.
 *
 * Everything used to be Lambert, which has no specular term at all: a surface
 * turned towards the sun got brighter and that was the entire lighting model.
 * Snow, lacquered board bases and painted timber all read as the same chalky
 * matte, and the low sun that the whole palette is built around never actually
 * glinted off anything.
 *
 * Phong rather than a physically-based material, deliberately. PBR without an
 * environment map to reflect has nothing to work with and costs more to shade;
 * a specular lobe against the existing key and rim lights is what this art
 * style wants. With flat shading the highlight breaks across facets, which is
 * the point - it picks out the geometry instead of smoothing it over.
 *
 * Higher `shininess` is a tighter, sharper highlight.
 */
export const GLOSS = {
  /**
   * Snow. Broad and soft: a wide lobe reads as a sheen across the whole slope
   * rather than a hotspot, and the specular is tinted to the sky it is
   * reflecting rather than left white.
   */
  snow: { specular: '#cfe6fb', shininess: 14 },
  /** Painted timber and plaster - a modest sheen. */
  prop: { specular: '#f6f2e8', shininess: 26 },
  /**
   * Fur. A dark specular, which is what keeps it fur: the specular colour sets
   * the *strength* of the highlight, so a near-black one gives a soft sheen
   * where the prop setting turns the yeti into painted plastic.
   */
  fur: { specular: '#5c626b', shininess: 8 },
  /** Board bases, rails, anything lacquered or metal. */
  polished: { specular: '#ffffff', shininess: 72 },
  /** Coins. Warm and tight, so they read as struck metal. */
  metal: { specular: '#fff0b8', shininess: 90 },
} as const;

export const ATMOSPHERE = {
  /**
   * Exposure into the filmic tone curve. ACES already lifts and desaturates,
   * so pushing exposure above 1 on an already-pale snow palette is what turns
   * the whole scene milky.
   *
   * Pulled slightly under 1. ACES desaturates hardest in the shoulder, and on a
   * snow scene the snow *is* the shoulder - so a little less exposure keeps
   * more of the frame off the part of the curve that drains the colour out of
   * it, without giving up the highlight rolloff that stops the slope clipping.
   */
  exposure: 0.92,
  /**
   * Exponential fog density.
   *
   * Balanced against `TUNING.track.drawDistance`: dense enough that the world
   * has fully closed in by the time geometry spawns, so nothing pops into
   * clear air, but thin enough that obstacles are readable the moment they
   * emerge.
   *
   * This governs how far ahead the track can be *read*, which at speed is a
   * gameplay number, not a decorative one. At 0.011 an obstacle was already
   * 45% dissolved at 70 m - under two seconds' warning at top speed, on a game
   * that asks for a decision roughly every half second. Thinned so the run is
   * legible about twice as far out, with `drawDistance` pushed back to match so
   * the spawn edge stays hidden inside the haze.
   */
  fogDensity: 0.0072,
} as const;

export const SKY = {
  /** Radius of the sky dome. Inside the camera far plane, ahead of the fog. */
  radius: 480,
  /** Direction of the sun, matching the key light. */
  sunDirection: [-0.55, 0.28, -0.79] as const,
  /** Angular size of the disc, and of the glow around it. */
  sunSize: 0.026,
  sunGlowSize: 0.22,
} as const;

export const MOUNTAINS = {
  /** Layers from furthest to nearest: distance, height, colour, parallax rate. */
  layers: [
    { z: -300, height: 74, width: 620, peaks: 13, color: PALETTE.mountainFar, parallax: 0.012 },
    { z: -220, height: 54, width: 500, peaks: 11, color: PALETTE.mountainMid, parallax: 0.026 },
    { z: -160, height: 36, width: 420, peaks: 9, color: PALETTE.mountainNear, parallax: 0.045 },
  ],
} as const;

export const SPRAY = {
  /** Particles in the pool kicked up by the board. */
  count: 90,
  /** Seconds a particle lives. */
  life: 0.55,
  size: 0.16,
  color: '#ffffff',
} as const;
