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

/**
 * Lifts a hex colour until its brightest channel reaches `floor`'s, leaving the
 * hue alone.
 *
 * The counterpart to {@link saturate}, and it exists because of one measured
 * fact about this rig: **a face turned towards the camera is lit by almost
 * nothing.** Both the key and `SKY.sunDirection` point down-track, so such a
 * face gets `N.L < 0` against the key and receives only the fill and the
 * hemisphere - about 0.14 of irradiance over pi, once the Lambert BRDF has
 * taken its share. Push a near-black albedo through that and ACES at
 * `ATMOSPHERE.exposure` returns literal `rgb(0, 0, 0)`: `#0c0f13` renders as a
 * hole in the frame rather than as a dark surface.
 *
 * **The brightest channel, not the luminance, and that distinction is the whole
 * correctness of this function.** Rec. 709 luminance rates a saturated red at
 * 0.21, so a floor stated in luminance would decide that the ski patrol's
 * `#b8322c` body is too dark and lift it to pink - destroying the one colour on
 * the machine that has to survive. A red panel is not a hole; a channel of 0.72
 * is putting plenty of light back at the camera. The brightest channel is what
 * says whether *any* light is coming off the surface, which is the question
 * being asked.
 *
 * An *additive* lift, so the differences between the channels survive exactly
 * and the result is the same colour with more light on it rather than a
 * different colour. Scaling instead would multiply the chroma along with the
 * value and turn a near-neutral panel into a tinted one.
 *
 * A colour already at or above the floor is returned untouched - this raises a
 * floor, it does not flatten a palette onto one.
 */
export function floorValue(hex: string, floor: string): string {
  const channels = (value: string): [number, number, number] =>
    [0, 2, 4].map((i) => parseInt(value.replace('#', '').slice(i, i + 2), 16) / 255) as [
      number,
      number,
      number,
    ];

  const rgb = channels(hex);
  const lift = Math.max(...channels(floor)) - Math.max(...rgb);
  if (lift <= 0) return hex;

  // No clamp is needed and none is hidden here: the lift is exactly what the
  // brightest channel is short of, so that channel lands on the floor's and
  // every other one lands below it.
  return `#${rgb
    .map((channel) =>
      Math.round((channel + lift) * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

export const PALETTE = {
  /**
   * Sky, top to bottom.
   *
   * Deliberately a wide hue journey rather than a gentle wash: a deep saturated
   * blue overhead against a hot orange horizon is most of where the scene's
   * colour comes from, since the ground is snow and contributes almost none.
   *
   * **Re-authored for a tone-mapped sky and only correct once `Sky.tsx` runs
   * through the tone curve.** The dome shader used to write `gl_FragColor`
   * directly with no `<tonemapping_fragment>` or `<colorspace_fragment>`, so a
   * linear value went raw into an sRGB-interpreted buffer and the zenith
   * displayed as near-black - the mechanical reason the sky and the world
   * looked like two different images. Once both chunks are in, these values are
   * the *input* to ACES at `ATMOSPHERE.exposure` rather than the pixel: the old
   * `#123a7d` would have come out around 15% display luminance and taken the
   * frame's only genuinely dark end with it. These are pitched so the zenith
   * still lands somewhere near 5-10% *after* the curve.
   *
   * If these look wrong on screen, check the shader before touching the hexes.
   *
   * **The zenith moved with the operator swap and the exposure that followed
   * it.** At `#0a2148` it rendered to 11.2% display luminance under the new
   * curve, over the 10% ceiling `tests/atmosphere.test.ts` holds it to - the
   * dome has to keep a genuinely deep top or the gradient stops being a
   * journey. Rather than pick a number that merely clears the bound, this is
   * aimed at `#051844`, which is `SPLASH_BACKGROUND`: the colour sampled off
   * the top of the launch poster. It now renders `#00193e` at 8.8% against the
   * poster's 9.1%, so the sky the player sees when the game opens and the sky
   * they see when it starts are, for the first time, the same sky.
   */
  skyZenith: '#071a3a',
  skyMid: '#3a78ad',
  skyHorizon: '#e08a3c',

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
   *
   * Taken down a further ten points of value, from 78% to 68%, because "a good
   * few steps down" was not true of the frame that shipped. Measured over the
   * lower 60% of a real capture, **70% of the play space sat inside a single
   * 10% luminance band** - the run and the haze were within a point of each
   * other and of the lit field. The piste is the single largest surface in
   * every frame, so it is the cheapest place to buy that range back.
   */
  piste: saturate('#8fb2d4'),
  pisteLine: saturate('#7fb0dd'),

  /**
   * Distant ranges, furthest first. Cooler and paler with distance.
   *
   * Two separate things changed here and they are easy to conflate.
   *
   * Value: pulled down about twenty points. The ranges are `meshBasicMaterial`
   * and so go through the tone curve, and once the sky does too (see
   * `skyZenith`) a range lighter than the sky behind it inverts figure and
   * ground. That inversion is most of what made these read as cardboard.
   *
   * Chroma: the saturation push is now *graded by distance* instead of the
   * flat 1.35 all three used to share. Aerial perspective is desaturation and a
   * value lift together, so pushing a 300 m range exactly as hard as a 160 m
   * one throws away half the depth cue and leaves three silhouettes that differ
   * only in outline.
   *
   * **All three came down again with `SKY_GRADIENT`, and they are not
   * independent of it.** Every ridge vertex hazes towards `skyGradientAt` at its
   * own elevation, and the ranges top out at 10 to 18 degrees - exactly the band
   * the gradient compression darkened. Left where they were, the far range came
   * out twenty points of display luminance *above* the sky over its own
   * ridgeline: figure and ground inverted, the same defect the previous pass
   * fixed, arriving from the other direction. Retune one of these and the other
   * has to move; `tests/atmosphere.test.ts` fails loudly if it does not.
   */
  mountainFar: saturate('#4d6377', 1.05),
  mountainMid: saturate('#3e5674', 1.2),
  mountainNear: saturate('#2a3f5d', SATURATION),

  /**
   * Atmospheric haze the world fades into. Sits between mid sky and horizon.
   *
   * **This hex is not comparable to any other in `PALETTE`.** Every other
   * colour here is authored in scene-linear terms and passes through exposure,
   * ACES and the sRGB encode before it becomes a pixel. Fog does not: three
   * mixes it *after* `<tonemapping_fragment>` and `<colorspace_fragment>` and
   * uploads it through `getUnlitUniformColorSpace`, so this is a literal
   * display value and is immune to `ATMOSPHERE.exposure`, to the tone curve and
   * to any grade. Reading it as "the same kind of number as `piste`" is the
   * mistake everyone will make.
   *
   * Which also makes it the frame's brightness *floor* over more than half its
   * ground area, and at the old `#a8cbe4` that floor was 77% - the top of the
   * band 70% of the play space was already crammed into. Taken to about 61%.
   * Re-measure the histogram after the lighting work; the target is no decile
   * above ~35% with the bottom four carrying at least 15% between them.
   */
  fog: '#7d9fc4',
} as const;

/**
 * The second directional light, defined out of line so `LIGHTING` can expose it
 * under both its old and its new name during the rename.
 *
 * It sits at `[7, 4, 9]` - *behind the camera*, which is the whole story. It
 * was called a rim light and it has never been one: a rim needs to be behind
 * the subject, and this is in front of it. What it actually is, and the only
 * thing in the rig that is, is a fill on camera-facing normals - both the key
 * and `SKY.sunDirection` point down-track, so every surface turned towards the
 * viewer has `N.L < 0` against both and would otherwise be lit by nothing but
 * the hemisphere.
 *
 * So: renamed, and softened from 1.0, because at full strength it was flattening
 * the very faces the key had gone to the far left to shape. **Do not move it and
 * do not delete it.** Removing it takes the rear of the ski patrol and every
 * camera-facing obstacle face to near-black. The job it was misnamed for - a
 * genuine silhouette-separating edge - is a Fresnel term in the material, not a
 * light, and it cannot be done with a directional light from anywhere.
 */
const FILL_LIGHT = {
  color: '#a8d0f0',
  intensity: 0.7,
  position: [7, 4, 9] as const,
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
    //
    // Raised again by the same reasoning when ambient went 0.36 -> 0.30. The
    // ratio is the number that matters and nothing exposes it: 3.0/0.36 is 8.3
    // and 3.2/0.30 is 10.7, a 29% widening of the gap between what the sun
    // reaches and what it does not. **The position must not move with it.** The
    // cast shadows this rig throws are the strongest thing in the build; only
    // their density is being changed here, never their direction or length.
    intensity: 3.2,
    position: [-46, 52, -20] as const,
  },
  /** Cool fill on camera-facing normals. See {@link FILL_LIGHT}. */
  fill: FILL_LIGHT,
  /**
   * Sky-to-ground bounce, and the only thing lighting faces turned away from
   * the key. Kept deliberately low: a strong ambient fills every shadow and
   * flattens the whole scene back out, which is exactly what the key and rim
   * are there to prevent.
   */
  ambient: {
    /**
     * The sky half of the bounce, and the only thing lighting the inside of a
     * cast shadow on the snow - the ground is horizontal, so `dot(N, up)` is 1
     * and `hemisphereLight` hands it this colour undiluted.
     *
     * Deepened and pushed about thirty points of chroma when `SKY_GRADIENT` was
     * compressed, and the two are the same decision. This is a stand-in for the
     * dome integrated over the upper hemisphere; the dome is now a good deal
     * darker and considerably bluer over the elevations that dominate that
     * integral, so a pale desaturated bounce would be lighting the snow with a
     * sky that is no longer overhead. It is also what keeps a deepened shadow
     * reading as *blue snow* rather than as a hole: value went down, chroma went
     * up, and the eye reads the second one as light rather than as dirt.
     */
    sky: '#86bfea',
    /**
     * The bounce off the ground, applied by `hemisphereLight` to every
     * downward-facing normal in the scene.
     *
     * Was a warm sand `#d9c9ad`, which is the bounce off a beach. Under a
     * snowfield the light coming back up is cold and it is the *snow's* colour,
     * so this is now a cool blue - and eleven points darker, because the old
     * value was also lifting every underside towards the same pale band the
     * rest of this pass is trying to empty out.
     *
     * Moved with the sky half, and by less: this is snow reflecting the sun as
     * well as the sky, so it does not follow the dome all the way down.
     */
    ground: '#7fa8ca',
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
     *
     * Held at 0.36 through the palette pass rather than raised, deliberately,
     * on the grounds that raising it fills shadows back in. That reasoning held
     * and the measurement that followed strengthened it, so this has now gone
     * the other way: **down to 0.30.**
     *
     * The size of that is worth stating, because the display transfer flatters
     * it. Modelled through the real Phong terms and the real tone curve, a cast
     * shadow on the untouched field goes from 78.8 to 68.0 display luminance and
     * one on the piste from 34.6 to 29.1 - about eleven and five levels
     * respectively, not the seventeen percent the raw number suggests. ACES is
     * steep down there and a sixth off the only light reaching a shadow buys
     * less than arithmetic promises.
     *
     * It is still worth having, for a reason that is not about shadows at all.
     * Ambient is what lights every face turned *away* from the key, and a drift
     * measured 3.2 luminance levels above the snow it sits on - white on white,
     * with nothing to give its lee side a value. Every point taken off here is a
     * point of form on every object in the game, which is the one place a
     * legibility problem and a flatness problem have the same fix.
     *
     * **The observation that settles the floor:** a pine shadow lying across the
     * piste, on a device, now that the trees cast. If the core reads as a hole
     * rather than as blue snow, the fix is the *hue* above before the value here
     * - `ambient.sky` gained thirty points of chroma in this same change
     * precisely so a deeper shadow stays snow. 0.34 is the value to retreat to
     * if that is not enough.
     */
    intensity: 0.3,
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
   *
   * Held at 2048 while `blurSamples` was cut, because the two are not
   * interchangeable and dropping both at once would leave nothing to attribute
   * a regression to. **The measurement that settles this is an A/B on a real
   * phone: frame time as shipped, against frame time with `castShadow` removed
   * from the key light.** If shadows are more than about 30% of the frame, 1024
   * is the next step - and the thing to check afterwards is the fence rails,
   * which are the thinnest casters in the game and the first place stepping
   * shows.
   */
  mapSize: 2048,
  /**
   * Half-extents of the orthographic box, **in light space, which is not world
   * space and is not even close to it.**
   *
   * This is the trap. `Lighting.tsx` maps `halfWidth` to `camera.left/right`,
   * which is the shadow camera's X - and with the key at `[-46, 52, -20]`
   * looking at the origin, that axis works out at about `(-0.399, 0, 0.917)`.
   * It is almost pure world **Z**. So `halfWidth` is the *down-track* extent,
   * and `halfDepth` (the camera's Y) is very nearly the *across-track* one.
   * Both names say the opposite of what they do, and reading them the obvious
   * way is how the shadow reach got tuned backwards.
   *
   * At 19 the box clipped every cast shadow at roughly 21 m of track, which is
   * about two thirds of a second at top speed - shadows were being thrown away
   * inside the band the player is actually reading. At 30 the reach is about
   * 33 m. It costs no draw calls at all: every caster is already
   * `frustumCulled={false}` and submitted to the shadow pass regardless of
   * whether the box happens to cover it.
   *
   * `halfDepth` at 33 was never the binding constraint - along the centreline
   * it permits |z| up to about 115 m - and is left alone.
   */
  halfWidth: 30,
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
   *
   * Both came down together and neither is a softness decision.
   *
   * `radius` is measured in *texels*, and widening `halfWidth` from 19 to 30
   * grew the texel along that axis by the same 1.58x. Dividing `radius` by it
   * holds the penumbra at the roughly 37 cm it already had; leaving it at 20
   * would have widened the blur by half again for free and started bleeding.
   *
   * `blurSamples` is the one number in the file with a plausible claim to being
   * the frame's dominant cost. Two 2048-square maps, 36 taps, two separable
   * passes is on the order of 300 million texture fetches per frame - about
   * 18 Gtexel/s at 60 Hz, which is not a mid-range Adreno number. Sixteen taps
   * is a 2.25x cut. It is affordable in quality terms because taps are spread
   * over `radius`, and `radius` just fell by the same kind of factor, so the
   * sampling *density* along the blur is close to what it was.
   */
  radius: 12,
  blurSamples: 16,
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

  /*
   * The rush channel.
   *
   * A second impulse alongside the flash, and the reason for a second one at
   * all is that the flash is *pictorial* - it is styled as snow thrown at the
   * lens - so firing it at three different sizes for a crash, a landing and a
   * near miss would make every event in the game the same picture. Rush is
   * consumed as an additive kick to the field of view and as the strength of a
   * dark edge gradient: a framing change and a vignette, no translation
   * anywhere, which is the distinction the camera rules in this file turn on.
   */

  /** Seconds for the rush to halve. */
  rushHalfLife: 0.12,
  /** Leaving a ramp: the biggest thing that happens without ending the run. */
  launchRush: 0.65,
  /** Touching down. Scaled by the fall at the call site, this is the ceiling. */
  landingRush: 0.5,
  /** Squeezing past something. Frequent, so deliberately the smallest. */
  nearMissRush: 0.35,
  /**
   * Ceiling on the *continuous* edge tint the run's speed drives, as opposed to
   * the transient punches above.
   *
   * Held well under 1 on purpose. A veil that is always slightly on is the
   * definition of something nobody perceives, and it leaves no headroom for the
   * punches to read against - the whole value of the transients is that they
   * arrive above a baseline the eye has stopped noticing.
   */
  speedRushMax: 0.3,
  /**
   * Shaping exponent on that continuous term.
   *
   * Above 1, so the tint stays out of the way through the opening of a run and
   * gathers towards the top of the speed ramp. Linear made the difference
   * between 21 and 36 units per second a uniform grey wash rather than an
   * escalation.
   */
  speedRushGamma: 1.6,

  /*
   * The shove channel.
   *
   * A stumble is a loss of grip, not an impact, and it has never had any screen
   * response at all - `runtime.stumbles` has no reader anywhere. It gets its
   * own channel rather than borrowing the flash because the two are different
   * verbs and a longer half-life: a trip is something the player recovers
   * *from* over most of a second, where a crash is instantaneous.
   */

  /** Seconds for the shove to halve. Longer than the flash - it is a recovery. */
  shoveHalfLife: 0.18,
  /** Clipping a low obstacle. */
  stumbleShove: 0.4,

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
 *
 * This is the *authored* sky value, and the sky now goes through the tone
 * curve, so it sits a little darker than what actually renders. That is fine
 * and not worth a fourth colour to keep in sync: the job is to be in the right
 * family for the one frame before the canvas paints, not to match it.
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
   * Snow. A near-field sheen that falls away with distance, tinted to the sky
   * it is reflecting rather than left white.
   *
   * **`shininess` 3 was a measured mistake and this is the correction.** The
   * reasoning that produced it was that `0.75^14` is 0.018, so a tight lobe
   * generated no highlight at all. That is true of the power term alone and it
   * omits the rest of three's `D_BlinnPhong`, which scales by
   * `(shininess * 0.5 + 1)` - eight at 14 against two and a half at 3. The real
   * change was about sevenfold, not the thirtyfold claimed, and the number it
   * landed on has a worse property than being too small.
   *
   * A flat plane under a directional light has only one thing varying `N.H`
   * across it: the view vector. Traced over the visible slope, `N.H` runs from
   * 0.88 under the rider to 0.61 at the fog line, so at `shininess` 3 the lobe
   * delivers 0.55 down to 0.18 - **it never switches off anywhere on screen.**
   * That is not a sheen, it is a near-white veil laid over the largest surface
   * in every frame, and it was the second biggest reason the game looked pale:
   * on its own it cost the piste 23 of its 93 points of chroma and added 26
   * levels of luminance. An additive near-white term is the most efficient way
   * there is to desaturate something.
   *
   * At 8 the same trace runs 0.58 to 0.031 - a real glint in the near field
   * that is gone by mid-distance, which is what "the low sun glints off the
   * snow" is supposed to mean and what the original Lambert-only complaint was
   * actually asking for. The falloff is the feature; a specular that is
   * everywhere is indistinguishable from raising the albedo.
   */
  snow: { specular: '#cfe6fb', shininess: 8 },
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
   * Exposure into the tone curve.
   *
   * **Read this together with the operator in `App.tsx`; the two are one
   * decision.** It sat at 0.92 for as long as that operator was ACES, on the
   * argument that ACES desaturates hardest in its shoulder and a snow scene
   * lives in the shoulder, so backing off exposure kept colour. The argument
   * was right about the mechanism and it was treating the symptom: the cure for
   * a curve that drains chroma is not to use less of the curve, it is a curve
   * that does not drain chroma.
   *
   * With Neutral in place the number has to move, and *upwards*, for a reason
   * that is easy to miss. ACES lifts its toe - it is a filmic S - so swapping it
   * out for an operator that is near-linear below 0.76 dropped the whole frame,
   * most visibly the sky: the dome fell about 25 levels at the horizon and
   * opened a seam against `PALETTE.fog`, which is a raw display value and so
   * did not move with it. `tests/atmosphere.test.ts` caught that within a run.
   *
   * 1.2 is where the horizon lands back on the fog - 152 against 154, a
   * two-level step along a line that is meant to be invisible - and it is
   * *measured against that*, not chosen for brightness. What it buys on the way
   * is the top end the frame did not have: a fully lit white reaches 245 here
   * against ACES's 224 at 0.92, and the play space had **0.3% of its pixels
   * above luminance 204 where the launch poster has 17.5%**. Nothing in the
   * game was reaching white, which is a large part of why it read as flat.
   *
   * Do not raise it further to chase the poster's brightness. Past about 1.3
   * the lit snow crosses Neutral's compression knee, where the operator's one
   * desaturating term lives, and the frame starts giving back the chroma this
   * whole change exists to recover - the lit-to-shadow range is already turning
   * over at 1.3 in the same measurement.
   */
  exposure: 1.2,
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
  /** Angular size of the disc. */
  sunSize: 0.026,
  /**
   * Angular size of the glow around it, as the reciprocal of the falloff
   * exponent: the shader raises `dot(dir, sun)` to `1 / sunGlowSize`.
   *
   * **Tightened a long way, and this was measured rather than judged.** The sun
   * sits at 16 degrees of elevation, which is inside the 22-degree band of sky a
   * portrait frame can see, and at 0.22 the exponent is 4.5 - the glow is still
   * at half strength 31 degrees off the disc. It was therefore not a glow, it
   * was a warm wash over essentially the whole visible dome, and it was carrying
   * more of "the sky and the snow are the same value" than the gradient was: at
   * 0.22 the visible sky came out at a median of 163, and the same gradient with
   * the glow alone tightened dropped it to 143.
   *
   * At 0.12 the exponent is 8.3 and the glow is a genuine halo around a low sun
   * rather than the sky's ambient tone. The disc and the horizon band still
   * carry the warmth - that has not been taken away, it has been put back where
   * a low sun actually puts it.
   */
  sunGlowSize: 0.12,
  /**
   * How much of `PALETTE.sunGlow` the halo adds, before tone mapping.
   *
   * Lived in the dome shader as a bare `0.55` next to the multiply, which made
   * it the one number in the sky nobody could find. It is a scene-linear add on
   * top of a mid sky sitting near 0.1 linear, so it dominates wherever it is
   * appreciable - which is exactly why it needs a name and a reason.
   *
   * Trimmed with the size for the same measured reason, and only trimmed: the
   * eye has to be able to find the light source, and a halo that has been taken
   * out entirely leaves a 58-degree fov with a bright disc and no explanation
   * for it.
   */
  sunGlowStrength: 0.42,
} as const;

export const MOUNTAINS = {
  /**
   * Layers from furthest to nearest: distance, height, colour, parallax rate.
   *
   * The heights are set by the *skyline angles they subtend at the real
   * camera*, not by how big each range should be. At 74 / 54 / 36 the far and
   * mid ranges topped out within half a degree of one another - 12.4 and 12.9
   * degrees - so two of the three layers drew the same ragged line in the same
   * place and the whole backdrop read as one band with a texture problem.
   *
   * Now roughly 18 / 15 / 10 degrees. The near range in particular has to sit
   * visibly *low*: it is what the others tower behind, and at 36 it was tall
   * enough to hide them.
   *
   * 100 rather than the 96 that would give the far range a clean two degrees of
   * separation. Two degrees is the floor a skyline test can assert, and landing
   * exactly on the floor is a test that fails on a rounding difference.
   */
  layers: [
    { z: -300, height: 100, width: 620, peaks: 13, color: PALETTE.mountainFar, parallax: 0.012 },
    { z: -220, height: 62, width: 500, peaks: 11, color: PALETTE.mountainMid, parallax: 0.026 },
    { z: -160, height: 30, width: 420, peaks: 9, color: PALETTE.mountainNear, parallax: 0.045 },
  ],
} as const;

/**
 * Snow thrown up by the board, and by the ski patrol's track.
 *
 * One pool, one instanced mesh, two emitters - the patrol's rooster tail is a
 * second source into the same particles rather than its own system, which is
 * what makes it cost zero draw calls.
 */
export const SPRAY = {
  /**
   * Particles in the pool.
   *
   * Bigger and shorter-lived rather than simply more numerous. Sustained
   * population is rate times lifetime, and a hundred-odd alpha-blended
   * `depthWrite: false` sprites is already about a quarter of a full-screen
   * overdraw pass every frame; the pool grew only enough to carry the second
   * emitter, while `life` came down to keep the population near where it was.
   */
  count: 120,
  /** Seconds a particle lives. */
  life: 0.45,
  /**
   * Radius of a flake.
   *
   * Nearly doubled. At 0.16 a flake was a couple of pixels on a six-inch screen
   * at any distance worth looking at, and a couple of pixels of white on white
   * is nothing - the plume was costing fill and delivering no image. Large
   * sprites are the only ones that read at this size.
   */
  size: 0.3,
  color: '#ffffff',
  /**
   * The darker of the two birth tints, rolled per particle.
   *
   * Was `#6589ac`, chosen as "below the piste value on purpose" so the spray
   * could introduce a genuinely dark value where it cost no obstacle any
   * legibility. The argument was right and the number was not, because it
   * ignored what happens to it afterwards: this is a **Lambert albedo**, not a
   * pixel. A tetrahedron facet turned away from the key gets only the fill and
   * the hemisphere, so `#6589ac` lands at 32 display luminance - a hard-edged
   * black shard sitting on pale snow, which is what made 45% of the plume read
   * as stray polygons rather than as snow.
   *
   * Re-authored so the same facet lands near 74 and the sunward one near 185:
   * snow in shade, which is the only thing a flake can legitimately be. Ugly is
   * worse than absent, and this was the clearest case of it in the frame.
   */
  shadeColor: '#b9cfe4',
  /**
   * Fraction of particles born on the darker tint.
   *
   * Lived in `SnowSpray.tsx` as a bare `SHADE_CHANCE = 0.45`. At nearly half the
   * pool it was not a variation, it was a second plume in a different colour -
   * and the whole justification for a dark tint is that it breaks up an
   * otherwise uniform white mass, which a quarter does and a half undoes.
   *
   * **Zero is a legitimate landing point.** If the retinted flakes still read as
   * debris on a device, take this out rather than tuning it: a plume of plain
   * white snow is a worse plume than a well-shaded one and a much better plume
   * than one with rendering artefacts in it.
   */
  shadeChance: 0.25,
  /**
   * Seconds a particle survives after it has come to rest on the snow.
   *
   * The velocity integrator floors `y` at 0.02 and zeroes the fall, so a flake
   * that lands simply sits there for the remainder of its life - up to half a
   * second of stationary geometry lying flat on the piste, which is precisely
   * when a faceted sprite stops looking like snow in the air and starts looking
   * like a triangle somebody forgot to clear. Thrown snow settles into the
   * surface; it does not become litter.
   */
  settleSeconds: 0.12,
  /**
   * Fraction of the world's speed a particle gives up to the wake, per second
   * of its life, once it has left the board.
   *
   * Was 0.35, and that number is why there has never been a rooster tail:
   * keeping 65% of the world's forward speed means the plume travels *forward*
   * relative to the snow at about 14 units per second at the top of the ramp,
   * so it outruns the camera instead of streaming back past it. Snow that has
   * left the board is not attached to anything; it recedes at the full ground
   * speed like everything else in the world.
   */
  wake: 1.0,
  /** Seconds over which a particle's birth drift off the board decays away. */
  driftSeconds: 0.15,
  /**
   * Metres in front of the camera over which a particle's drawn scale collapses
   * to nothing.
   *
   * Mandatory companion to the larger `size`, not a polish item. A 0.3-radius
   * sprite two metres from the lens covers about a fifth of the screen and
   * translates a third of a metre per frame, so consecutive frames barely
   * overlap: it reads as a strobing dotted trail, and then it clips the near
   * plane at 0.5. Fading the scale out before it arrives is cheaper and looks
   * better than any amount of alpha.
   */
  nearCollapse: 2.5,
} as const;

/**
 * The ski patrol's placement and approach, all of it presentation.
 *
 * `ChaserState` carries a distance and a visibility flag and nothing else, and
 * `systems/collision.ts` never looks at the machine - it cannot touch the
 * player and must not be given a collider. Everything here decides where a
 * thing with no gameplay meaning is *drawn*.
 *
 * The machine sat at `player.z + 26` against a camera at about `z = 8.96`,
 * which is seventeen units behind the eye. It has been frustum-culled for
 * effectively every frame of every run: the game's only antagonist, and nobody
 * has ever seen it outside an avalanche.
 */
export const PATROL = {
  /**
   * World units of lateral bias off the player's spine.
   *
   * The machine goes over a shoulder, never behind the head. A tall pale-ish
   * mass at `x = 0` lands its readable bulk directly behind the one silhouette
   * in the game that already struggles to separate, which would make the fix
   * worse than the defect.
   */
  shoulderOffset: 0.9,
  /**
   * Fraction of the player's lane offset the machine tracks.
   *
   * Well under 1, for the same reason `TUNING.camera.laneFollow` is: a chaser
   * welded to the player's lane never appears to move, and this one wants to
   * sweep across the frame when the player crosses the track.
   */
  laneFollow: 0.45,
  /** Seconds over which the drawn machine eases in when pressure rises. */
  approachSeconds: 0.75,
  /** Seconds over which it eases back out. Slower - a threat leaves reluctantly. */
  releaseSeconds: 1.2,
  /**
   * Fraction by which the approach overshoots before settling.
   *
   * The simulation snaps `distance` from 26 to 5 on a single tick when an
   * avalanche starts, and that snap must stay exactly as it is - the avalanche
   * and caught tests depend on it. So the arrival is smoothed on the
   * presentation side only, and a small overshoot is what makes it read as
   * something closing in rather than something being switched on.
   */
  approachOvershoot: 0.12,
  /**
   * Drawn length and width of the machine, in metres.
   *
   * Capped, and the cap is not cosmetic. It is drawn at about `z = 5`, which is
   * inside the band where obstacles still exist, and it has no collider - so it
   * visibly drives through whatever the player just jumped and through the last
   * few metres of any rail they just left. A 2.9 m machine is intersecting
   * something 45% longer than a 2.0 m one is.
   */
  drawnLength: 2.4,
  drawnWidth: 1.1,

  /*
   * --- Framing ---
   *
   * The three numbers below **replace `FRAME_REACH`, `MIN_DEPTH` and
   * `MIN_DRAWN_Z` in `patrolGeometry.ts`**; delete those when this is wired up.
   * They lived there as locals because they read like geometry, and they are
   * not: they decide how much of the screen the game's only antagonist owns at
   * the moment of peak tension, which is the most consequential art-direction
   * call in the frame.
   */

  /**
   * How far past the edge of the frame the machine's outboard flank may reach,
   * as a fraction of the visible half width.
   *
   * Was 1.3, on the argument that being cropped is what a vehicle crowding your
   * shoulder looks like. That argument is sound and it went too far. At 1.3 the
   * framing solves to about 4.5 m in front of the lens on a portrait phone,
   * where a 2.4 m machine covers a fifth to a quarter of the frame **and is cut
   * by two edges at once** - and a mass cropped on two sides stops being a
   * snowmobile and becomes a stack of coloured boxes. Every panel authored in
   * `patrolGeometry.ts` is then detail nobody can assemble into an object.
   *
   * At 1.0 the outboard flank lands exactly on the frame edge: cropped by the
   * bottom edge only, which still reads as crowding, and solving to about 5.8 m
   * instead - a 41% increase in distance and therefore half the screen area.
   * The machine has to *resolve* before being close can mean anything.
   */
  frameReach: 1.0,
  /**
   * Closest the machine is ever drawn to the eye, in metres.
   *
   * Binds on wide screens, where there is so much horizontal room that the reach
   * rule alone would put the machine two and a half metres in front of the lens.
   * Raised with `frameReach` and for the same reason - at 3 m its 1.7 m of
   * height covers a little under half the frame, and half the frame is far more
   * than a thing with no gameplay meaning may own.
   */
  minDepth: 5,
  /**
   * Furthest the machine is drawn from the player, in metres of world Z.
   *
   * Its near end sits `drawnLength / 2` ahead of this, so at 2.2 the machine
   * stops 0.6 m short of the player's collider. Any closer and a thing with no
   * collider is visibly inside the one thing on screen that has one.
   *
   * This is also the hard ceiling on `minDepth`, and it is worth stating because
   * it is the reason the framing cannot simply be backed off until the problem
   * goes away: the camera sits at about `z = 8.96`, so a machine 6.7 m from the
   * lens is already here. There is about 1.5x of distance available in total and
   * `frameReach` spends most of it.
   */
  minDrawnZ: 2.2,

  /*
   * --- Livery ---
   *
   * Both of these are applied where the vertex colours are baked, in the
   * `IMPORT_SATURATION` idiom, so they cost nothing per frame.
   */

  /**
   * Saturation applied to the baked livery. Below 1: this *de*saturates.
   *
   * The machine measured as the most saturated, highest-contrast mass in the
   * frame - a red body against a near-white cross against a near-black track,
   * arriving at the one moment the player most needs to read the track instead.
   * Coins are meant to be the only warm accent in the play space and a red slab
   * covering a fifth of the screen takes that away from them.
   *
   * Deliberately not zero. The patrol has to stay identifiable as ski patrol,
   * and the red and the cross are how; this pulls them back into the palette
   * rather than out of it.
   */
  liverySaturation: 0.8,
  /**
   * The darkest albedo any livery panel may be authored at, applied through
   * {@link floorValue}.
   *
   * The tread and the track tunnel are authored at `#0c0f13` and `#151a1f`, and
   * under this rig those are not dark, they are *absent*: a panel facing the
   * camera receives neither the key nor `SKY.sunDirection`, only the fill and
   * the hemisphere, and ACES maps the result to literal `rgb(0, 0, 0)`. That is
   * the black crate in the critique, and it is a lighting fact rather than a
   * taste one - nothing on a snowfield under a bright sky is that dark, because
   * the snow alone bounces enough light back up to prevent it.
   *
   * Chosen so a camera-facing panel lands near 24 display luminance: still
   * unambiguously the darkest thing on the machine, still reading as a rubber
   * track, but with a value and a hue instead of a hole. Read as a *brightest
   * channel* rather than as a luminance - see {@link floorValue} for why that is
   * not a detail.
   */
  liveryFloor: '#4e6070',
} as const;

/**
 * The rider's pose, in radians and in fractions of the figure's height.
 *
 * Angles rather than positions throughout: the collider is a symmetric box the
 * figure sits inside, and nothing here may move the figure out of it.
 */
export const RIDER = {
  /**
   * Resting torso yaw across the board.
   *
   * The single largest authenticity error on the model was the stance - feet
   * side by side across the *narrow* axis of a 1.86 m snowboard, which is how
   * you stand on a skateboard. Standing along the board is also what gives the
   * camera a three-quarter silhouette instead of a flat back.
   */
  stanceYaw: 0.45,
  /** Radians of lean per metre-per-second of lateral velocity. */
  leanPerLateral: 0.55,
  /** Ceiling on the lean, about 28 degrees. */
  maxLean: 0.5,
  /** Board swing across the direction of travel, at full carve. */
  boardYaw: 0.3,
  /** Board across the rail in a boardslide, and the answering twist at the root. */
  grindBoardYaw: 1.35,
  grindRootYaw: 0.28,
  /** Fraction of torso height lost at the hardest landing, and gained off a lip. */
  landingCompress: 0.22,
  takeoffExtend: 0.18,
} as const;

/**
 * The carved groove left in the snow behind the rider.
 *
 * A ring of track-space samples pushed one per fixed step while grounded and
 * dropped while airborne, so a jump breaks the line rather than smearing it.
 */
export const TRAIL = {
  /**
   * Samples in the ring, and metres between them - about 25 m of ribbon.
   *
   * Deliberately half of what a trail this length suggests. The camera sits
   * around `z = +8.5` to `+11`, so everything past about `z = +9` is already
   * behind the eye: on a longer ribbon half the samples are never rasterised
   * and the buffer is paid for anyway.
   */
  samples: 140,
  spacing: 0.18,
  /**
   * Height above the snow, in metres.
   *
   * Above the lane guides at 0.012 and the ridges at 0.01, so the ordering is
   * decided by geometry rather than by depth-test luck at grazing angles.
   */
  y: 0.016,

  /*
   * --- The cross-section ---
   *
   * **None of these three are display values, whatever the comment in
   * `CarveTrail.tsx` currently says.** `meshBasicMaterial` has `toneMapped` on
   * by default, so an authored hex is decoded to scene-linear, run through ACES
   * at `ATMOSPHERE.exposure` and re-encoded like everything else: the old
   * `#3f6f9f` reaches the screen as `rgb(48, 112, 165)`, which is exactly the
   * `rgb(51, 113, 165)` a frame grab measured. Author these as *inputs to the
   * curve* and check them through it, or the trench will keep coming out more
   * saturated than it was written.
   *
   * The reference for all three is the rig's own shading, not a hue anybody
   * likes. A cast shadow on the untouched field renders at `rgb(49, 72, 82)` -
   * chroma 33 - and the lit piste at `rgb(113, 151, 173)` - chroma 60. Shadowed
   * snow in this scene is a desaturated blue-grey. The old trench was chroma
   * 117, half again as chromatic as anything the lighting can produce, which is
   * what made a groove in the snow read as a stripe of paint.
   */

  /**
   * The trench floor, and the darkest value on the play surface.
   *
   * Re-authored at the *same luminance* as the value it replaces - about 108
   * against the old 102 - and with 63% less chroma. That pairing is the whole
   * change and it is deliberate: the measured defect was saturation, not
   * darkness, and taking the value down as well would have been buying the
   * frame's contrast back from a decal, which is the thing this pass exists to
   * stop doing.
   */
  color: '#5b6f7e',
  /**
   * The trench wall, between the floor and the thrown lip.
   *
   * The third tone, and the reason it exists is that a cross-section measured
   * snow 165, lip 206, trench 104 **held bit-identical across 45 pixels**, lip
   * 206, snow - a flat fill between two hard steps. Real displaced snow has a
   * lit wall on the sun side and a shaded one on the lee, and nothing in the
   * frame has an edge five pixels wide.
   *
   * `CarveTrail.tsx` duplicates its across-track vertices today so the colour
   * break is hard, under a comment correctly arguing that a shared vertex would
   * blend the lip into the trench. With a wall strip in between, sharing is now
   * the point: floor and wall share an edge and wall and lip share an edge, so
   * the interpolator draws the gradient for free and the only hard break left is
   * the outer one against the snow, which is where a real lip does have one.
   */
  wallColor: '#8ea6b8',
  /**
   * The thrown lips either side, *above* the piste value.
   *
   * The lips are the entire reason the trail reads as displaced material rather
   * than as a decal painted on the snow. A dark stripe on its own is a skid
   * mark; a dark stripe between two bright ones is a groove.
   */
  lipColor: '#c2d8ee',
  lipWidth: 0.12,
  /**
   * Metres of wall between the trench floor and the lip.
   *
   * Fixed rather than a fraction of the carve, because it is a property of the
   * snow rather than of the turn: how far the material slumps back into a groove
   * does not depend on how wide the groove is. It also means a hard carve widens
   * the *floor* rather than the shoulder, which is what makes the trail read as
   * digging in rather than merely spreading out.
   */
  wallWidth: 0.1,
  /** Metres across, running and at full carve. */
  baseWidth: 0.45,
  carveWidth: 0.9,
  /** Seconds for a sample to fade out behind the rider. */
  fadeSeconds: 2.5,
} as const;

/**
 * Near-field marker poles beside the run.
 *
 * The only thing in the game that passes the camera. Everything else converges
 * on a vanishing point and leaves frame eight to eleven metres ahead, which is
 * why a still at 21 units per second is indistinguishable from one at 12.
 */
export const MARKERS = {
  /**
   * Metres either side of the centreline.
   *
   * Boxed in from both directions. Obstacles reach |x| = 3.3 (outer lane at 2.2
   * plus the widest obstacle half-width of 1.1), so anything nearer than that
   * would be read as an obstacle; the piste edge is at 4.6 and the fence at
   * 5.1. Four metres leaves 0.7 m of clearance on the side that matters. If a
   * device check finds them reading as hazards, 4.3 is the next stop.
   */
  x: 4.0,
  /**
   * Metres between poles: about six passing events a second at the opening
   * speed and ten at the top, an order of magnitude more near-field flow than
   * anything else in the frame.
   */
  spacing: 3.5,
  /**
   * Metres tall. Under anything that could be read as jumpable or duckable -
   * a decorative object the player tries to clear is a decorative object that
   * has become a gameplay lie.
   */
  height: 1.6,
  /** Pole radius, in metres. */
  radius: 0.06,
  /** The fence marker orange the player has already learnt means "boundary". */
  color: '#e8663c',
} as const;

/**
 * The longitudinal rhythm carried by the lane guides.
 *
 * The measured complaint is narrow and worth stating exactly: the lane guides
 * are unbroken continuous lines, identical at 21 and 40 units per second, so the
 * **only** repeating longitudinal features in the frame are the fence posts and
 * the marker poles at the extreme left and right. To feel speed the player has
 * to look away from the gameplay - and those edges also carry the frame's
 * highest contrast, so the eye is pulled off the track rather than led down it.
 *
 * A cadence *inside* the play space is what fixes that, and the lane guides are
 * the only thing already running down the fall line for its whole length.
 */
export const PISTE_CADENCE = {
  /**
   * Metres between repeats.
   *
   * Three constraints pick this number and only one of them is about feel.
   *
   *  - **It has to be phase-exact.** The surface mesh slides towards the camera
   *    and snaps back every `GROUND_PERIOD` (114 m), and the albedo map tiles
   *    every `ALBEDO_TILE_Z` (38 m). 9.5 is 38/4 and 38 is 114/3, so the cadence
   *    lands in the same phase after either wrap whether it is baked into vertex
   *    rows or into the texture. A period that does not divide both puts a
   *    visible jump across the slope every few seconds.
   *  - **It has to clear the temporal-aliasing floor.** A cadence edge is a
   *    *transverse* feature, and `snowSurface.ts` documents why anything under
   *    about 1.5 m strobes: the ground advances 0.6 m per frame at top speed. At
   *    9.5 m there are fifteen frames to a cycle.
   *  - **Then feel.** 2.2 Hz at the opening speed and 4.2 Hz at the top - a rate
   *    that visibly doubles across the run, which is the whole point, and well
   *    under the 6-11 Hz the near-field poles already flicker past at.
   */
  spacing: 9.5,
  /**
   * Fraction of each repeat spent on the bright half of the cycle.
   *
   * Above a half so the guide still reads as a continuous line at a glance. The
   * gap it leaves is 3.6 m, comfortably over the aliasing floor above.
   */
  duty: 0.62,
  /**
   * How far the guide's tone swings between the two halves of the cycle, as a
   * fraction of the way towards the piste it sits on.
   *
   * **A modulation, not a dash, and that is a gameplay constraint rather than an
   * aesthetic one.** The lane guides are what tell the player where the lanes
   * are; a guide broken into hard segments is a guide that stops existing at
   * intervals, and a gap in a line the player is steering by will eventually be
   * read as meaning something. Swinging the value while the line stays unbroken
   * gives the cadence without ever taking the information away.
   */
  contrast: 0.55,
} as const;

/**
 * The mark under an airborne player.
 *
 * **This exists because of a lighting fact that cannot be fixed in the light
 * rig.** The key sits at `[-46, 52, -20]`: 46 degrees of elevation over a
 * horizontal run of 50.2 m, so a cast shadow is displaced 0.96 m of ground per
 * metre of height, and 92% of that displacement is *across* the track. At a
 * 0.6 m hop the shadow lands half a metre out, which is under the player and
 * correct - it measured 56.6 display luminance and sat where it should. At the
 * 4 m top of a ramp arc it is 3.5 m across and 1.5 m back, which from the centre
 * lane is past the outer lane, past the piste edge and outside the frame: a
 * sampled grid over the lower frame with the player at 4 m came back uniform
 * snow, no shadow anywhere in it, at exactly the moment lane choice matters
 * most. That is a playability defect before it is a visual one.
 *
 * **The fix is not to raise the key.** The obstacle shadows this rig throws are
 * the strongest thing in the build and their length is what makes them read;
 * lifting the sun to keep an airborne shadow on screen would flatten every
 * chalet, fence and pine in the game to buy back one sprite. So the shadow stays
 * physical and a dedicated mark takes over where it leaves frame.
 *
 * Costs one draw call. There is no way round that - it is the one element in
 * this pass that cannot ride an existing mesh, because it has to be at the
 * player's lane and under the player alone.
 */
export const LANDING_MARK = {
  /**
   * Height above the snow, in metres.
   *
   * Above `TRAIL.y` at 0.016, which is above the lane guides at 0.012 and the
   * ridges at 0.01. A shadow falls on whatever is under it, including the
   * player's own carve trail, so it is last in that ordering - and the ordering
   * is decided by geometry rather than by depth-test luck at grazing angles.
   */
  y: 0.02,
  /**
   * Heights, in metres, over which the mark takes over from the real cast
   * shadow.
   *
   * It must be **absent on the ground**. A grounded player already has a
   * genuine contact shadow about 70 luminance levels deep and in the right
   * desaturated blue-grey; drawing a second one over it is not a stronger cue,
   * it is a rendering fault the player can see.
   *
   * Both ends are set against the lane spacing rather than against the frame,
   * because what is being replaced is a *lane* cue. At `fadeFrom` the real
   * shadow has moved 0.24 of a lane across the track - still unambiguously under
   * the player, so the mark starts before anything is lost. At `fadeTo` it has
   * moved 0.70 of a lane, which is more than half way to the wrong answer, and
   * a displaced shadow that could be read as either of two lanes is worse than
   * none. `fadeTo` is also under the 2.4 m jump peak, so an ordinary hop is
   * fully covered before its arc turns over.
   */
  fadeFrom: 0.55,
  fadeTo: 1.6,
  /**
   * Radius in metres at the ground and at `fadeTo` and above.
   *
   * It grows with height and it must, for the same reason a real penumbra does:
   * a mark that stays the same size as the player climbs reads as a decal
   * welded to their feet rather than as something on the snow underneath them.
   * Growth is also what stops it competing with the player's own silhouette -
   * bigger and fainter is further away.
   */
  groundRadius: 0.42,
  airRadius: 0.72,
  /**
   * How far the snow under the centre of the mark is taken towards {@link tint}
   * at full strength.
   *
   * Under 1 deliberately. This is standing in for a *soft* shadow at four metres
   * of separation, and a hard black disc at that distance is a worse lie than no
   * shadow at all - it says the player is on the ground.
   */
  strength: 0.62,
  /**
   * Fraction of the radius over which the mark fades to nothing at its rim.
   *
   * Large: the whole outer half of the disc is gradient. A shadow cast from four
   * metres up by a light of any real angular size is nearly all penumbra, and a
   * crisp circle is the single fastest way to make this read as a game UI
   * element rather than as light.
   */
  softness: 0.5,
  /**
   * What the snow under the mark is multiplied by at full strength.
   *
   * **A multiplier, and it must be drawn with `toneMapped` off.** Multiply
   * blending happens in the framebuffer, after tone mapping and after the sRGB
   * encode, so this hex is a literal display-space factor - the same class of
   * value as `PALETTE.fog` and for the same mechanical reason. Letting it
   * through the tone curve would silently change the factor.
   *
   * Multiplying rather than compositing a colour is what makes one constant
   * correct over both surfaces it has to land on: the piste is a mid blue and
   * the field beside it is near-white, and a fixed shadow colour that reads on
   * one is wrong on the other. Chosen so the piste lands close to where the
   * rig's own cast shadow on it lands, which is the only definition of "the
   * right colour" that cannot drift.
   */
  tint: '#87a1b0',
} as const;

/**
 * What the camera is allowed to do that the player did not ask for.
 *
 * Read the camera-shake paragraph in {@link FEEDBACK} before adding anything
 * here. The distinction this whole block turns on is *framing* against
 * *movement*: the field of view may change, because the edges of the frame
 * stretch while nothing the player is aiming at moves. The camera may not
 * translate, for anything, ever.
 */
export const CAMERA_FEEL = {
  /**
   * Degrees of additive field of view on a full-strength impulse.
   *
   * The one cue in the visual pass operating at a rate anybody can perceive:
   * five degrees over an 0.08 s attack is about 62 degrees a second, against
   * the speed ramp's 0.2. It is also monotonically safe for the outer-lane
   * framing guarantee, because visible half-width increases with fov, so a
   * widening punch can only ever show *more* of the track.
   *
   * **The dolly must read the speed-driven fov only, never the punched one.**
   * Wiring them together turns every punch into a camera lurch of over a metre,
   * which is the banned shake arriving through the back door. This is not
   * obvious from the code and somebody will do it.
   */
  punchDegrees: 5,
  /** Seconds for the punch to halve. */
  punchHalfLife: 0.12,
  /**
   * Degrees of camera roll at full lane travel. **Shipped at zero.**
   *
   * The recorded objection to camera motion is narrower than "the camera must
   * not move": shake was tried on crashes, landings, near misses and patrol
   * pressure - all things that happen *to* the player. A roll driven by the
   * lane change begins on the swipe, is proportional to the travel remaining,
   * and ends when the lane change does, so the player caused every degree of
   * it. That is a real distinction and it may well read fine.
   *
   * It is also, unambiguously, the camera moving, and this project has been
   * burnt by exactly that once already. So the mechanism ships and the value
   * does not: **2.0 is the number to try, on a device, before anyone defends
   * it.** If it reads wrong the fix is this line and nothing else.
   *
   * Note for whoever wires it: `CameraRig` calls `camera.lookAt` every frame,
   * which rebuilds the rotation from scratch and silently zeroes any roll
   * applied to it. The absence of roll today is a side effect of using
   * `lookAt`, not a decision. Set `camera.up` *before* the `lookAt`.
   */
  rollDegrees: 0,
} as const;

/**
 * The patrol's rooster tail, emitted into the {@link SPRAY} pool.
 *
 * It fills the band between the machine and the bottom edge of the frame -
 * the part of the screen a machine drawn at `z = 5` physically cannot occupy -
 * which is what makes the pressure legible without the machine having to be
 * any closer than the framing allows.
 */
export const CHASER_SPRAY = {
  /** Particles a second at full pressure. */
  rateAtFullPressure: 40,
  /** Metres a second of lateral spread. */
  spread: 2.2,
} as const;

/**
 * The falling snow field.
 */
export const SNOW_FIELD = {
  /**
   * Fraction of the world's speed the flakes recede at.
   *
   * Was 0.35, justified in a comment reading "it is in the air, not on the
   * slope". That reasoning is backwards: still air means the flakes have no
   * horizontal velocity of their own, so relative to a player moving down the
   * hill they recede at the *full* ground speed. Air is the one thing in the
   * scene that has no excuse to lag.
   */
  scrollFraction: 1.0,
  /**
   * Flakes drawn between the camera and the player, on top of the main field.
   *
   * The cheapest expensive-looking trick in the genre. It fakes a depth of
   * field the renderer cannot afford and gives the frame a foreground plane it
   * has at no speed - and it is the only continuous optic-flow cue that works
   * at the opening speed, where the fov kick contributes exactly nothing. Same
   * instanced mesh as the main field, so it costs no draw call.
   *
   * First thing to halve if the frame turns out not to be shadow-bound: this
   * and the larger spray are the two continuous fill adds in the pass.
   */
  nearCount: 40,
  nearAlpha: 0.32,
  /**
   * Radius of a near flake, in metres.
   *
   * Sized in pixels and converted back. At the base fov the frame is about
   * 1.11 m tall per metre of distance, so on an 812 px viewport 0.22 m spans
   * roughly 160 px at one metre out and 40 px at four - which puts the whole
   * near band in the 40 to 160 px range where a soft flake reads as
   * out-of-focus foreground rather than as a lump of snow.
   */
  nearSize: 0.22,
  /**
   * Shutter time the motion streak is drawn for, in seconds.
   *
   * One frame, and this is not a taste value. Streak length is velocity times
   * exposure, and one frame's worth is precisely what removes the temporal
   * aliasing that scrolling at the full ground speed introduces - a longer
   * streak is a smear and a shorter one strobes.
   */
  streakExposure: 1 / 60,
} as const;
