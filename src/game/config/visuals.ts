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
  snowLit: '#fdf3e4',
  snowShadow: '#5f93c9',

  /**
   * The groomed run, deliberately a good few steps down from the surrounding
   * field. Everything the player has to read at speed - the yeti, snow spray,
   * drifts, the ice wall - is near-white, and on a near-white piste none of it
   * has a silhouette. A mid-tone run is what gives them one.
   */
  piste: '#aecce9',
  pisteLine: '#7fb0dd',

  /** Distant ranges, furthest first. Cooler and paler with distance. */
  mountainFar: '#8fb6d8',
  mountainMid: '#6f9ac4',
  mountainNear: '#5480b0',

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
    intensity: 2.7,
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
     * Lifted back up once the key started casting. Ambient is the *only* thing
     * lighting the inside of a cast shadow, so with real shadows in the scene
     * this number stopped being "how flat is everything" and became "how black
     * are the shadows" - too low and a tree lays a hole in the snow.
     */
    intensity: 0.5,
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
   */
  radius: 5,
  blurSamples: 12,
  /**
   * VSM does not need the depth bias PCF does - it compares distributions
   * rather than a single depth, so the usual acne does not arise and a bias
   * large enough to matter only detaches shadows from their casters.
   */
  bias: 0,
  normalBias: 0,
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
