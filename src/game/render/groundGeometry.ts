/**
 * The snow surface: the whole slope, its groomed run and its lane grooves, as
 * one vertex-coloured geometry.
 *
 * This used to be five draw calls - a 300 m field plane, a piste plane laid on
 * top of it, two lane-guide boxes and an instanced strip of ridges - for a flat
 * surface with two stripes on it. That is 8% of a ~60 call budget spent on the
 * largest and least interesting thing in every frame. Merging them is free in
 * quality terms and is what pays for the near-field work elsewhere in the pass.
 *
 * The second-order win is bigger than the saving. Once the surface is geometry
 * with a colour per vertex rather than four flat planes, *tonal variation is
 * free*: packed and wind-scoured bands running across the slope, a warm
 * sun-facing lift down the left of the run and a cool fall to the right, and a
 * field that breaks up instead of reading as one sheet of off-white. Measured
 * over a real capture, 70% of the play space sat inside a single 10% luminance
 * band; the piste is the largest surface in that measurement, so spreading its
 * value is the cheapest range the frame can buy.
 *
 * Three things here are load-bearing and none are obvious:
 *
 *  - **The field and the run abut rather than overlap.** The old pair was two
 *    full-width planes stacked 4 mm apart, so every pixel of the run was shaded
 *    twice. Sharing an edge at `PISTE_HALF_WIDTH` removes that overdraw on the
 *    biggest surface in the frame and removes the z-fight risk with it, while
 *    keeping the piste edge exactly as crisp - the two strips simply carry
 *    different colours at coincident vertices.
 *  - **The surface scrolls, and the pattern is periodic so the wrap cannot be
 *    seen.** A merged surface is static geometry, and static tonal bands under
 *    a moving player read as the ground standing still - which is worse than
 *    the flat plane it replaced. So the whole mesh translates by
 *    `distance mod GROUND_PERIOD` and every colour function is exactly
 *    `GROUND_PERIOD`-periodic. `GROUND_PERIOD` is an integer multiple of the
 *    vertex spacing for the same reason: the *interpolated* field only repeats
 *    if the sample grid repeats with it.
 *  - **The UVs are a per-strip choice, not a function of position.** The one
 *    texture on the snow (`snowSurface.ts`) covers the groomed run and nothing
 *    else, because there is no second material to give the field once the whole
 *    surface is one merged draw. So the run and the grooves read the map and
 *    every field strip reads a white reserve at a constant UV. Deriving the UV
 *    from X alone would be the obvious simplification and would corduroy the
 *    open snow either side of the piste.
 *  - **The lane grooves carry the frame's only longitudinal rhythm.** The guides
 *    were unbroken continuous lines, identical at 21 and 40 units per second, so
 *    the only repeating features going past were the fence posts and marker
 *    poles at the extreme left and right of the frame - the player had to look
 *    away from the gameplay to feel speed, towards the highest-contrast edges in
 *    the image at that. `PISTE_CADENCE` swings the groove core's value along the
 *    track instead. It rides the existing merged geometry, so it costs no draw
 *    call, and it is sampled eight times a repeat, which is what the vertex
 *    budget in `stays cheap enough to be worth merging` was rebalanced to pay
 *    for.
 *  - **Colours are authored in display space and converted once.** Halving a
 *    linear value is not halving a tone - the eye reads roughly the 1/2.2 power
 *    of it - so a "10% darker band" written as a linear multiply comes out at
 *    about 4%. Every modulation below is a fraction of a *display* value, which
 *    is also the space `PALETTE` is authored in, and the sRGB encode happens
 *    once at the point the number becomes a vertex.
 */

import * as THREE from 'three';
import { LANES } from '@/game/config/tuning';
import { GLOSS, PISTE_CADENCE } from '@/game/config/visuals';
import { clamp01 } from '@/game/core/math';
import { createRng } from '@/game/core/rng';
import { albedoFieldUv, albedoRunUv, type Uv } from '@/game/render/snowSurface';
import { RECYCLE_Z, TRACK_COLORS } from '@/game/render/trackLayout';

/**
 * Half-width of the groomed run.
 *
 * The one number in this file the player can feel: it is where the colour
 * changes, and the colour change is what tells them how much track there is.
 * Matches the 9.2 m plane it replaces exactly.
 *
 * `ALBEDO_RUN_WIDTH` in `snowSurface.ts` is the same width declared again, so
 * the dependency between the geometry and the texture runs one way.
 * `tests/ground.test.ts` holds the two together: a silent disagreement would
 * stretch the corduroy across the run without breaking anything else.
 */
export const PISTE_HALF_WIDTH = 4.6;

/**
 * Metres of travel after which the surface pattern repeats and the mesh snaps
 * back.
 *
 * Long enough that the repeat is not a rhythm - three to five seconds across
 * the speed ramp, well under a hertz - and short enough that the geometry does
 * not have to be that much longer than the visible band. Nothing about the wrap
 * is visible provided the colour functions are periodic in it, which
 * `tests/ground.test.ts` asserts rather than trusts.
 */
export const GROUND_PERIOD = 114;

/**
 * Metres between vertex rows across the readable part of the surface.
 *
 * Two constraints meet here. It has to divide `GROUND_PERIOD` exactly, or the
 * sample grid does not repeat when the mesh snaps back and a seam pops across
 * the slope every few seconds. And it has to resolve the shortest wavelength in
 * the band profile several times over, or the geometry aliases the very pattern
 * it is drawing.
 */
export const GROUND_Z_STATION = 2;

/** Just past the recycle line, so the surface does not end under the camera. */
export const GROUND_NEAR_Z = RECYCLE_Z + 20;

/**
 * Total length of the strip, and it is `4 * GROUND_PERIOD` on purpose: an exact
 * multiple keeps the far edge on a pattern boundary as well as the near one.
 *
 * The far edge lands at about 300 m ahead of the recycle line, where
 * `ATMOSPHERE.fogDensity` has closed the world to better than 99%. The old
 * plane stopped at 230 m and was only 94% hazed, which put a faintly visible
 * horizon *below* the real one.
 */
const GROUND_LENGTH = GROUND_PERIOD * 4;
export const GROUND_FAR_Z = GROUND_NEAR_Z - GROUND_LENGTH;

/** Where the field stops carrying detail: past this it is fog with a tint. */
const FIELD_DETAIL_X = 12;
/**
 * Metres beyond the piste edge over which the field settles to its far tone.
 *
 * Deliberately longer than `FIELD_DETAIL_X` and named separately: the *detail*
 * fades where the geometry goes coarse, but the *value* keeps falling well past
 * that, which is what aerial perspective does. Tying the two together would put
 * a visible step at the strip join.
 */
const FIELD_HAZE_RUN = 24;
/** Wide enough that a tablet's horizontal field of view never sees the edge. */
const FIELD_EDGE_X = 150;

/** Height of the lane grooves. Below `TRAIL.y` and above the surface. */
export const LANE_GUIDE_Y = 0.012;

/**
 * Total width of a lane groove, and the width of the raised lip either side.
 *
 * Widened from 9 cm, which at 40 m was less than a pixel. These are the only
 * pair of continuous converging lines in the play space, and converging lines
 * are what make lanes unambiguous at speed - the genre leans on them heavily.
 * Widened and *not* softened: a wide faint line is a smudge.
 *
 * The lip is what stops it reading as a stripe painted on the snow. A dark band
 * is a skid mark; a dark band between two bright ones is a groove.
 */
export const LANE_GUIDE_WIDTH = 0.35;
const LANE_GUIDE_LIP = 0.055;

/**
 * Metres between vertex rows along a groove *core*, where the cadence lives.
 *
 * The cadence is baked into vertex colours, so this spacing is the only thing
 * deciding how much of the authored waveform survives, and two divisibility
 * constraints fix it with no freedom left over. It has to divide
 * `GROUND_PERIOD`, or the sample grid does not repeat when the mesh snaps back
 * and the rhythm jumps every few seconds; and it has to divide
 * `PISTE_CADENCE.spacing`, or consecutive repeats are sampled in different
 * phases and the cadence beats against its own grid instead of ticking.
 *
 * An eighth of a repeat is what those two allow: 9.5/8 is 1.1875 and 114/1.1875
 * is 96. It is also a *dyadic* fraction, which matters more than it looks - row
 * positions are read back out of a `Float32Array`, and a row spacing that is not
 * exactly representable makes `z` and `z + GROUND_PERIOD` land one bit apart, so
 * the closure the wrap depends on stops being checkable. A fifth of a repeat
 * (1.9 m) satisfies both divisibility rules and fails that one.
 *
 * Eight rows is also what it takes to place a trapezoid's four corners: sampled
 * on this grid the gap measures 3.60 m against the 3.61 m `PISTE_CADENCE.duty`
 * asks for. Four rows a repeat lands it at 3.94 m - a duty of 0.585 rather than
 * 0.62 - because the crossings can then only fall on grid midpoints.
 */
export const GUIDE_CORE_Z_STATION = PISTE_CADENCE.spacing / 8;

/**
 * Metres between vertex rows across the *inner field* either side of the run.
 *
 * Was the same 2 m grid the piste uses, which was nineteen samples across the
 * shortest wave `FIELD_HARMONICS` contains (114/3 = 38 m) and the second largest
 * vertex count in the file. Three metres is still twelve samples across it, and
 * the 3,648 vertices that frees are most of what pays for the cadence grid
 * above. It divides `GROUND_PERIOD` for the same reason everything else here
 * does.
 *
 * The field and the run therefore no longer share vertex rows along their common
 * edge. That is safe and only because the seam is a straight line at y = 0 on
 * both sides: a T-junction can crack when the two edges are interpolating
 * different surfaces, and here they are interpolating the same one. The colours
 * either side were always independent - that is the hard piste edge.
 */
const FIELD_Z_STATION = 3;

/* ------------------------------------------------------------------ *
 * Tones: display-space colour arithmetic.
 * ------------------------------------------------------------------ */

/** An sRGB display colour, 0-1 per channel - the space `PALETTE` is written in. */
export interface Tone {
  r: number;
  g: number;
  b: number;
}

export function tone(hex: string): Tone {
  const value = hex.replace('#', '');
  return {
    r: parseInt(value.slice(0, 2), 16) / 255,
    g: parseInt(value.slice(2, 4), 16) / 255,
    b: parseInt(value.slice(4, 6), 16) / 255,
  };
}

function mixTone(from: Tone, to: Tone, amount: number): Tone {
  const t = clamp01(amount);
  return {
    r: from.r + (to.r - from.r) * t,
    g: from.g + (to.g - from.g) * t,
    b: from.b + (to.b - from.b) * t,
  };
}

function scaleTone(source: Tone, factor: number): Tone {
  return {
    r: clamp01(source.r * factor),
    g: clamp01(source.g * factor),
    b: clamp01(source.b * factor),
  };
}

/** Rec. 709 luminance, the same weighting `visuals.ts` and its tests use. */
export function toneLuma(colour: Tone): number {
  return 0.2126 * colour.r + 0.7152 * colour.g + 0.0722 * colour.b;
}

/*
 * The authored surface tones.
 *
 * Taken straight from `TRACK_COLORS` and deliberately *not* passed through
 * `saturate()` again. Everything in `PALETTE` that reaches this file is already
 * saturated at its declaration, and the merged-prop path in `mergeParts.ts`
 * saturates at bake time - so routing the ground through `assemble()`, which is
 * the obvious way to build a merged geometry, would push the chroma of the
 * largest surface in the game twice and nothing would say so.
 */
const FIELD_TONE = tone(TRACK_COLORS.snow);
const PISTE_TONE = tone(TRACK_COLORS.piste);
const SHADE_TONE = tone(TRACK_COLORS.snowShade);
const GUIDE_TONE = tone(TRACK_COLORS.laneGuide);

/** Wind-packed snow: brighter, and colder than the run it sits on. */
const PACKED_TONE = tone('#c6dbf0');
/** Scoured to the blue underneath. The darkest tone on the open surface. */
const SCOURED_TONE = tone('#456d95');
/** The sun side of the run, matching the warm key over at -X. */
const SUNLIT_TONE = tone('#f2e2c6');
/** The lee side, where the light rakes away and the cast shadows land. */
const LEE_TONE = tone('#4f7ba8');

/* ------------------------------------------------------------------ *
 * The band profile.
 * ------------------------------------------------------------------ */

/**
 * Harmonics of `GROUND_PERIOD` the transverse banding is built from, and their
 * relative strengths.
 *
 * A sum of harmonics rather than a repeating feature, and the reason is the
 * defect this replaces. The old ridges were a single hard band every 8.85 m:
 * a strictly periodic 2.4-4.1 Hz signal across the speed ramp, which is above
 * the rate at which the visual system stops integrating position and locks on
 * to phase instead. A locked signal carries *phase* and discards *rate*, which
 * is exactly why a still at 21 units a second looked the same as one at 12.
 *
 * Four components at 38, 23, 16 and 10 m span 0.55 Hz to 3.6 Hz across the
 * ramp: the long ones stay integrable and give the speed away, the short ones
 * give the surface texture. Every wavelength divides `GROUND_PERIOD`, so the
 * whole profile is periodic in it by construction rather than by tuning.
 *
 * The floor on the shortest wavelength is a hard one. At 36 units a second the
 * ground advances 0.6 m per frame, so anything under about 1.5 m strobes or
 * runs backwards and no amount of filtering saves it. The shortest here is
 * 10.4 m, and `tests/ground.test.ts` measures the profile rather than trusting
 * this paragraph.
 */
const BAND_HARMONICS = [3, 5, 7, 11] as const;
const BAND_AMPLITUDES = [1, 0.7, 0.5, 0.34] as const;

/**
 * Metres the bands slew across the run per metre of X.
 *
 * Without it every band is a line drawn square across the track, which is
 * corduroy - a groomer's signature, at the wrong scale, and it fights the lane
 * guides for the same read. A slew of a third turns them into drift, which is
 * what actually lies on an open slope.
 */
const BAND_SKEW = 0.35;

/** Larger, slower harmonics for the untouched field either side of the run. */
const FIELD_HARMONICS = [1, 2, 3] as const;
const FIELD_AMPLITUDES = [1, 0.62, 0.4] as const;

/**
 * Fixed seed: the surface is decorative and identical in every run, exactly as
 * the treeline is. Phases only - the amplitudes are authored, because a rolled
 * spectrum is a spectrum nobody has looked at.
 */
const surfacePhases = ((): { band: number[]; field: number[] } => {
  const rng = createRng(0x5f0a);
  return {
    band: BAND_HARMONICS.map(() => rng.next()),
    field: FIELD_HARMONICS.map(() => rng.next()),
  };
})();

function harmonicSum(
  position: number,
  harmonics: readonly number[],
  amplitudes: readonly number[],
  phases: readonly number[],
): number {
  let total = 0;
  let scale = 0;
  for (let i = 0; i < harmonics.length; i++) {
    const k = harmonics[i]!;
    const amplitude = amplitudes[i]!;
    total +=
      amplitude * Math.sin(2 * Math.PI * (k * (position / GROUND_PERIOD) + phases[i]!));
    scale += amplitude;
  }
  return total / scale;
}

/**
 * Pushes a near-Gaussian sum out towards its extremes.
 *
 * A sum of four sinusoids spends most of its time near zero, so a band profile
 * used raw leaves nearly all of the piste at its base value and buys almost no
 * range - which is the whole point of the exercise. An exponent below one
 * flattens the middle and widens the tails without moving a single extremum, so
 * the shortest-period guarantee is untouched.
 */
function widen(value: number): number {
  return Math.sign(value) * Math.pow(Math.abs(value), 0.65);
}

/**
 * Packed (positive) to wind-scoured (negative) snow at a point on the run.
 *
 * Exactly `GROUND_PERIOD`-periodic in Z, which is what makes the scroll wrap
 * invisible. X only shifts the phase, so the period is the same in every lane.
 */
export function snowBandAt(z: number, x: number = 0): number {
  return widen(harmonicSum(z + x * BAND_SKEW, BAND_HARMONICS, BAND_AMPLITUDES, surfacePhases.band));
}

/** The same, at the coarser scale the untouched field either side is drawn at. */
export function fieldPatchAt(z: number, x: number = 0): number {
  return widen(
    harmonicSum(z + x * 1.7, FIELD_HARMONICS, FIELD_AMPLITUDES, surfacePhases.field),
  );
}

/* ------------------------------------------------------------------ *
 * Surface colours.
 * ------------------------------------------------------------------ */

/**
 * Strength of the packed/scoured swing on the run, as a lerp towards a tone.
 *
 * **Asymmetric, and the asymmetry is a fairness rule rather than a taste one.**
 * A drift measured 3.2 display luminance levels above the snow it sits on and a
 * boulder 8.0 - the player cannot see what is going to kill them. Part of that
 * is the obstacles' own albedo and is fixed where those are authored, but part
 * of it is here: everything the player has to read on the run is *brighter* than
 * the run, so every point the piste climbs is a point of silhouette taken off a
 * white obstacle. `PACK_STRENGTH` is therefore a legibility budget, not a
 * gradient - the run may fall a long way and may rise only a little.
 *
 * Cut from the 0.45 the two directions used to share, which put the brightest
 * lane at 0.76 display albedo against a snow-pile drift at about 0.93. Both of
 * those are up in the ACES shoulder, where the curve compresses hardest, which
 * is the mechanical reason a 45% albedo difference arrived as three levels. At
 * 0.16 the ceiling comes down to 0.72 and the spread the run was darkened to buy
 * survives intact, because none of it came from the bright half: the scoured
 * direction is untouched at 0.45.
 *
 * The scoured direction is where it is because of the lane guides, not because
 * of the bands. `laneGuideTone` has to stay a clear step below the run at the
 * *darkest* the run gets, and that margin is already thin - see the groove
 * assertions in `tests/ground.test.ts`. Deepening the scour without darkening
 * the grooves to match closes it.
 */
const PACK_STRENGTH = 0.16;
const SCOUR_STRENGTH = 0.45;
/** Strength of the sun-side lift and the lee-side fall. */
const SUN_STRENGTH = 0.13;
const LEE_STRENGTH = 0.15;

/**
 * The groomed run.
 *
 * Two independent modulations, and they are independent on purpose. The bands
 * run down the track and are what make the speed legible; the sun gradient runs
 * across it and is what stops a flat plane reading as flat. Folding them into
 * one term would tie the brightest snow to one side of the run for ever.
 */
export function pisteTone(x: number, z: number): Tone {
  const band = snowBandAt(z, x);
  let colour = mixTone(
    PISTE_TONE,
    band > 0 ? PACKED_TONE : SCOURED_TONE,
    Math.abs(band) * (band > 0 ? PACK_STRENGTH : SCOUR_STRENGTH),
  );

  // +1 at the sun-facing edge, -1 at the lee edge. The key sits at [-46, 52,
  // -20], so the light comes from -X and this cannot be flipped without also
  // flipping every cast shadow in the scene.
  const across = clamp01((x + PISTE_HALF_WIDTH) / (2 * PISTE_HALF_WIDTH));
  const sun = 1 - 2 * across;
  colour =
    sun > 0
      ? mixTone(colour, SUNLIT_TONE, sun * SUN_STRENGTH)
      : mixTone(colour, LEE_TONE, -sun * LEE_STRENGTH);

  return colour;
}

/**
 * The untouched field either side.
 *
 * Stays near-white close to the run - it is the contrast the mid-tone piste was
 * darkened to sit against, and the frame's top end lives here - and falls away
 * with distance, where aerial perspective and the treeline's half-light would
 * take it anyway. The patch term fades out completely by `FIELD_DETAIL_X`, so
 * the coarse outer strip and the fine inner one agree exactly where they meet
 * and no seam can appear along the join.
 */
export function fieldTone(x: number, z: number): Tone {
  const distance = clamp01((Math.abs(x) - PISTE_HALF_WIDTH) / FIELD_HAZE_RUN);
  const detail = 1 - clamp01((Math.abs(x) - PISTE_HALF_WIDTH) / (FIELD_DETAIL_X - PISTE_HALF_WIDTH));
  const patch = fieldPatchAt(z, x) * detail;

  // Towards the cool shade tone, harder the further out and harder in the
  // hollows. Never past halfway: this is the surface that has to stay bright.
  return mixTone(FIELD_TONE, SHADE_TONE, 0.08 + 0.34 * distance + 0.18 * (0.5 - 0.5 * patch));
}

/**
 * How far through the faint half of the cadence a point on the track is: 0 along
 * the strong run of a groove, 1 in the middle of a gap.
 *
 * **A trapezoid, not a sinusoid, and not a dash.** A sinusoid has no duty at
 * all, and `PISTE_CADENCE.duty` is asymmetric on purpose - the guide is a line
 * for two thirds of every repeat and a fade for the other third. The plateaux
 * are what let it still read as a continuous line between the gaps, which is a
 * gameplay constraint: the guides are what tell the player where the lanes are,
 * and a line that stops existing at intervals is a line whose gaps will
 * eventually be read as meaning something.
 *
 * The half-amplitude points are what `duty` names, rather than the corners of
 * the plateau, so the gap measures what it says it does whatever edge width the
 * grid can carry. The edge is exactly one vertex station wide because that is
 * the sharpest edge this grid can *place*: authored any sharper it is not drawn
 * sharper, it is drawn in whatever phase the rows happen to fall in, and the
 * duty comes out wrong by up to a whole station.
 *
 * Periodic in `PISTE_CADENCE.spacing`, which divides `GROUND_PERIOD` exactly
 * twelve times, so the scroll wrap can never show a seam in it.
 */
export function guideCadenceAt(z: number): number {
  const { spacing, duty } = PISTE_CADENCE;

  // Centre of the gap, which runs from `duty` to the end of the repeat.
  const centre = (spacing * (1 + duty)) / 2;
  const phase = ((z % spacing) + spacing) % spacing;
  // Measured the short way round, so the gap straddling the repeat boundary is
  // one gap rather than two half ones.
  const offset = Math.abs(phase - centre);
  const distance = Math.min(offset, spacing - offset);

  const half = (spacing * (1 - duty)) / 2;
  return clamp01((half + GUIDE_CORE_Z_STATION / 2 - distance) / GUIDE_CORE_Z_STATION);
}

/**
 * The dark core of a lane groove, and the one thing in the play space carrying a
 * longitudinal rhythm.
 *
 * Darkened well below `PALETTE.snowShadow`, which at 55% luminance sits inside
 * the crowded band this whole pass is emptying. A groove is a hole in the snow
 * and the one place on the play surface that can carry a genuinely deep value
 * without costing an obstacle any legibility - nothing is ever read *against*
 * a 24 cm stripe.
 *
 * It used to be constant along the track, on the argument that the bands are
 * texture and these two lines are information. The measurement that overturned
 * that: the guides are *unbroken continuous lines, identical at 21 and 40 units
 * per second*, so the only repeating longitudinal features in the frame were the
 * fence posts and marker poles at the extreme left and right - to feel speed the
 * player had to look away from the gameplay, and towards the highest-contrast
 * edges of the frame at that. The guides are the only thing already running down
 * the fall line for its whole length, so they are where a cadence goes.
 *
 * It fades *towards the run it is cut into*, never away from it, and never all
 * the way. A groove that darkened on the beat would read as a second set of
 * markings; one that vanished would be information taken away. At
 * `PISTE_CADENCE.contrast` the faint phase keeps 45% of its step below the snow,
 * which is still a line.
 */
export function laneGuideTone(x: number, z: number): Tone {
  const core = scaleTone(GUIDE_TONE, 0.8);
  return mixTone(core, pisteTone(x, z), guideCadenceAt(z) * PISTE_CADENCE.contrast);
}

/** The thrown lip either side of the groove, above the run it sits on. */
export function laneGuideLipTone(x: number, z: number): Tone {
  return scaleTone(pisteTone(x, z), 1.16);
}

/* ------------------------------------------------------------------ *
 * Geometry.
 * ------------------------------------------------------------------ */

/**
 * Accumulates flat quad strips into one interleaved-by-attribute buffer set.
 *
 * Written out directly rather than assembled with `mergeGeometries`, which is
 * the idiom everywhere else in this folder. The props there are dozens of
 * three primitives that genuinely need merging; this is a handful of grids that
 * already share one attribute layout, so merging them would allocate every
 * strip twice and reintroduce the one failure mode `assemble()` exists to
 * paper over - a mismatched attribute set silently returning null.
 */
class SurfaceBuilder {
  private readonly position: number[] = [];
  private readonly normal: number[] = [];
  private readonly colour: number[] = [];
  private readonly uv: number[] = [];
  /** Reused: converting display to working space allocates otherwise. */
  private readonly scratch = new THREE.Color();

  /**
   * One grid of quads on the horizontal plane at `y`.
   *
   * `xs` and `zs` must both be increasing. The triangle winding below is what
   * makes the surface face +Y - the obvious corner order faces the ground, and
   * a back-facing slope is invisible rather than obviously wrong.
   *
   * `uvAt` decides which part of the snow albedo the strip reads. It is a
   * per-strip choice rather than a global function of position because the map
   * covers the groomed run and *only* the groomed run - see `snowSurface.ts`.
   */
  grid(
    xs: readonly number[],
    zs: readonly number[],
    y: number,
    colourAt: (x: number, z: number) => Tone,
    uvAt: (x: number, z: number) => Uv,
  ): void {
    for (let ix = 0; ix < xs.length - 1; ix++) {
      const x0 = xs[ix]!;
      const x1 = xs[ix + 1]!;
      for (let iz = 0; iz < zs.length - 1; iz++) {
        const z0 = zs[iz]!;
        const z1 = zs[iz + 1]!;
        this.triangle(x0, z0, x1, z1, x1, z0, y, colourAt, uvAt);
        this.triangle(x0, z0, x0, z1, x1, z1, y, colourAt, uvAt);
      }
    }
  }

  private triangle(
    ax: number,
    az: number,
    bx: number,
    bz: number,
    cx: number,
    cz: number,
    y: number,
    colourAt: (x: number, z: number) => Tone,
    uvAt: (x: number, z: number) => Uv,
  ): void {
    this.vertex(ax, az, y, colourAt, uvAt);
    this.vertex(bx, bz, y, colourAt, uvAt);
    this.vertex(cx, cz, y, colourAt, uvAt);
  }

  private vertex(
    x: number,
    z: number,
    y: number,
    colourAt: (x: number, z: number) => Tone,
    uvAt: (x: number, z: number) => Uv,
  ): void {
    this.position.push(x, y, z);
    // Authored rather than computed: the surface is flat, so `computeVertexNormals`
    // would walk fifteen thousand vertices to write (0, 1, 0) into all of them.
    this.normal.push(0, 1, 0);

    const display = colourAt(x, z);
    // The one place display values become renderer values. Vertex colours are
    // consumed in the working (linear) space, so the encode happens here and
    // nowhere else.
    this.scratch.setRGB(display.r, display.g, display.b, THREE.SRGBColorSpace);
    this.colour.push(this.scratch.r, this.scratch.g, this.scratch.b);

    const { u, v } = uvAt(x, z);
    this.uv.push(u, v);
  }

  build(): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.position, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(this.normal, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(this.colour, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return geometry;
  }
}

/** Evenly spaced stations from `from` to `to` inclusive, at most `step` apart. */
function stations(from: number, to: number, step: number): number[] {
  const spans = Math.max(1, Math.round((to - from) / step));
  const out: number[] = [];
  for (let i = 0; i <= spans; i++) out.push(from + ((to - from) * i) / spans);
  return out;
}

/** The X boundary between two lanes - where a groove runs. */
export function laneBoundaries(): number[] {
  const out: number[] = [];
  for (let i = 0; i < LANES.length - 1; i++) out.push((LANES[i]! + LANES[i + 1]!) / 2);
  return out;
}

export interface GroundSurface {
  geometry: THREE.BufferGeometry;
  material: THREE.MeshPhongMaterial;
}

export function buildGroundSurface(): GroundSurface {
  const builder = new SurfaceBuilder();

  const fine = stations(GROUND_FAR_Z, GROUND_NEAR_Z, GROUND_Z_STATION);
  // The inner field's harmonics are three times longer than the run's, so it
  // does not need the run's grid - see `FIELD_Z_STATION`.
  const field = stations(GROUND_FAR_Z, GROUND_NEAR_Z, FIELD_Z_STATION);
  // The outer field is fully hazed and carries no detail, so it is drawn at a
  // thirtieth of the resolution. The step still divides `GROUND_PERIOD`, which
  // is the only property the scroll wrap needs of it.
  const coarse = stations(GROUND_FAR_Z, GROUND_NEAR_Z, GROUND_PERIOD / 3);

  // Six columns across the run: enough to carry the sun gradient smoothly and
  // to keep the skewed bands from stepping across the width.
  const pisteXs = stations(-PISTE_HALF_WIDTH, PISTE_HALF_WIDTH, (2 * PISTE_HALF_WIDTH) / 6);
  builder.grid(pisteXs, fine, 0, pisteTone, albedoRunUv);

  // The field abuts the run at exactly +/-PISTE_HALF_WIDTH. Coincident
  // vertices with different colours is what keeps the edge a hard line without
  // a second plane laid over the first.
  const innerLeft = [-FIELD_DETAIL_X, -8.3, -PISTE_HALF_WIDTH];
  const innerRight = [PISTE_HALF_WIDTH, 8.3, FIELD_DETAIL_X];
  builder.grid(innerLeft, field, 0, fieldTone, albedoFieldUv);
  builder.grid(innerRight, field, 0, fieldTone, albedoFieldUv);

  const outerLeft = [-FIELD_EDGE_X, -60, -26, -FIELD_DETAIL_X];
  const outerRight = [FIELD_DETAIL_X, 26, 60, FIELD_EDGE_X];
  builder.grid(outerLeft, coarse, 0, fieldTone, albedoFieldUv);
  builder.grid(outerRight, coarse, 0, fieldTone, albedoFieldUv);

  /*
   * The grooves, and the two halves of one are sampled at very different rates.
   *
   * The **lips** are cut from the run's own colour and only have to follow its
   * banding, whose shortest wave is 10.4 m - a 19 m grid is coarse against that
   * and always was, and it is deliberately not paid for twice. What they must
   * not do is drift brighter and darker independently of the snow they were
   * thrown out of, which is a question of tracking the same function, not of
   * sampling it densely.
   *
   * The **core** carries the cadence, so it is sampled eight times a repeat.
   * That is 4,608 vertices against the lips' 576, and it is the whole reason the
   * inner field was coarsened above: the cadence has to live somewhere the eye
   * already is, and this is the only geometry in the play space that runs the
   * length of the fall line.
   *
   * Both read the albedo along with the run rather than taking the flat white
   * the field gets. A groove filled with untextured snow would sit at a fixed
   * fraction of a surface that is being modulated around it, so the pair of
   * lines would brighten and darken relative to the piste as the corduroy passed
   * under them - and these two lines are the only continuous converging cue in
   * the play space. Better that they carry the same grain as the snow they are
   * cut into.
   */
  const lipZs = stations(GROUND_FAR_Z, GROUND_NEAR_Z, GROUND_PERIOD / 6);
  const coreZs = stations(GROUND_FAR_Z, GROUND_NEAR_Z, GUIDE_CORE_Z_STATION);
  const half = LANE_GUIDE_WIDTH / 2;
  for (const centre of laneBoundaries()) {
    const core = half - LANE_GUIDE_LIP;
    builder.grid(
      [centre - half, centre - core],
      lipZs,
      LANE_GUIDE_Y,
      laneGuideLipTone,
      albedoRunUv,
    );
    builder.grid([centre - core, centre + core], coreZs, LANE_GUIDE_Y, laneGuideTone, albedoRunUv);
    builder.grid(
      [centre + core, centre + half],
      lipZs,
      LANE_GUIDE_Y,
      laneGuideLipTone,
      albedoRunUv,
    );
  }

  return { geometry: builder.build(), material: groundMaterial() };
}

/**
 * Phong to match every other surface in the scene, and **not** flat-shaded,
 * which is the one place this departs from `vertexColorMaterial`.
 *
 * Flat shading reconstructs the normal per fragment from screen-space
 * derivatives. On geometry whose normals are all (0, 1, 0) that produces a
 * byte-identical image while spending a derivative pair, a cross product and a
 * normalise on every ground fragment in the frame - and the ground is the
 * largest fill in it. Faceting is worth paying for on a boulder; there are no
 * facets here to pick out.
 */
export function groundMaterial(): THREE.MeshPhongMaterial {
  return new THREE.MeshPhongMaterial({
    vertexColors: true,
    specular: new THREE.Color(GLOSS.snow.specular),
    shininess: GLOSS.snow.shininess,
  });
}

/**
 * Built once for the session.
 *
 * The Canvas mounts once and never unmounts, so this is a singleton in
 * practice; module-level rather than a `useMemo` so a development-mode double
 * render cannot leave a second copy of a 14,000-vertex buffer on the GPU.
 */
let surface: GroundSurface | undefined;

export function groundSurface(): GroundSurface {
  surface ??= buildGroundSurface();
  return surface;
}

/**
 * Where the surface sits this frame.
 *
 * The world scrolls towards the camera as distance grows, exactly as `wrapZ`
 * does for everything else, and snaps back a whole period at a time. The double
 * modulo is the same guard `wrapZ` carries: it costs nothing and it is the
 * difference between a correct wrap and a surface that vanishes.
 */
export function groundScrollZ(distance: number): number {
  return ((distance % GROUND_PERIOD) + GROUND_PERIOD) % GROUND_PERIOD;
}
