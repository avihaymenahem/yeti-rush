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
  /** Sky, top to bottom. */
  skyZenith: '#12518f',
  skyMid: '#5ea3d4',
  skyHorizon: '#ffcf90',

  /** The sun disc and the glow around it. */
  sunCore: '#fff6e0',
  sunGlow: '#ffb85c',

  /**
   * Snow under direct light, and in shadow.
   *
   * The lit tone is warm and the shadow tone strongly blue. That hue split is
   * doing the work here: flat-shaded geometry has no detail to catch light, so
   * a face turning away from the sun has to change *colour*, not just get
   * darker, or the whole slope reads as one undifferentiated sheet.
   */
  snowLit: '#fdf3e4',
  snowShadow: '#6f9ec9',

  /**
   * The groomed run, deliberately a good few steps down from the surrounding
   * field. Everything the player has to read at speed - the yeti, snow spray,
   * drifts, the ice wall - is near-white, and on a near-white piste none of it
   * has a silhouette. A mid-tone run is what gives them one.
   */
  piste: '#b9d3e8',
  pisteLine: '#96b8d6',

  /** Distant ranges, furthest first. Cooler and paler with distance. */
  mountainFar: '#7ea3c6',
  mountainMid: '#5f86ad',
  mountainNear: '#456d95',

  /** Atmospheric haze the world fades into. Sits between mid sky and horizon. */
  fog: '#a8cbe4',
} as const;

export const LIGHTING = {
  /** Warm key, low and behind-left, so obstacles cast towards the camera. */
  key: {
    color: '#fff0d2',
    intensity: 2.5,
    position: [-9, 11, -6] as const,
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
    intensity: 0.55,
  },
} as const;

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
   */
  exposure: 1.0,
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
  sunGlowSize: 0.28,
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
