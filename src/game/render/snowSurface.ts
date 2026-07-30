/**
 * The one texture on the snow: a groomed-run albedo, generated into a canvas.
 *
 * `groundGeometry.ts` gives the surface tonal *bands*, but its finest feature is
 * ten metres long because a vertex grid fine enough for anything smaller would
 * cost tens of thousands of vertices. So the ground within ten metres of the
 * camera - the part the player actually looks at - is still a smooth gradient,
 * and the recorded complaint was "no texture of any kind". This is the answer
 * to that: one 512x1024 map multiplying the vertex colours, no extra draw call,
 * no extra material.
 *
 * Four things here are load-bearing and none are obvious:
 *
 *  - **The fine detail runs *along* the track, never across it.** At 36 units a
 *    second the ground advances 0.6 m per frame, so a transverse feature under
 *    about 1.5 m is sampled below twice per cycle and either strobes or crawls
 *    backwards; that constraint is the whole reason the vertex bands are as
 *    coarse as they are, and a texture does not escape it - mipmapping fixes
 *    *spatial* aliasing and does nothing at all for the temporal kind. A feature
 *    running down the fall line, however, is unchanged by the scroll: it can be
 *    two centimetres wide and it can never alias in time. Hence corduroy, wind
 *    lines and ski tracks for the detail, and a slow cross-slope drift for the
 *    only transverse content, floored well above 1.5 m.
 *  - **The map covers the run and nothing else.** The surface is one merged
 *    geometry with one material, so there is no second material to give the
 *    field - but there is a spare corner of the texture. Two columns at the
 *    right edge are held at pure white and every vertex off the run samples
 *    exactly those, at a constant UV whose screen-space derivative is zero, so
 *    it lands on mip 0 and reads white by construction rather than by luck. The
 *    untouched field keeps the near-white top end of the frame's histogram,
 *    which is the value the run was darkened to sit against.
 *  - **A `map` can only ever darken.** An eight-bit texture tops out at 1.0, so
 *    the mean of any albedo multiplier is below one and the surface it lands on
 *    gets darker overall. That is the right direction here - the run is meant to
 *    be the mid-tone the near-white rider stands against - but it is a fact to
 *    plan around rather than to discover, and it is why the authored range is
 *    0.6 to 1.0 rather than the 0.55 to 1.05 the brief asked for.
 *  - **It tiles on a divisor of the scroll period.** The surface mesh slides
 *    towards the camera and snaps back every `GROUND_PERIOD` metres. UVs are
 *    derived from the vertex's own Z, so the texture snaps with it, and the snap
 *    is invisible only if the tile length divides that period exactly.
 */

import * as THREE from 'three';
import { clamp } from '@/game/core/math';
import { createRng } from '@/game/core/rng';

/* ------------------------------------------------------------------ *
 * Layout.
 * ------------------------------------------------------------------ */

export const ALBEDO_WIDTH = 512;
export const ALBEDO_HEIGHT = 1024;

/**
 * Columns at the right edge held at pure white.
 *
 * Two rather than one so that a filtering rule nobody wrote down - a bilinear
 * tap landing half a texel past the edge, a driver that rounds the other way -
 * still reads white. It costs 0.4% of the texture.
 */
const WHITE_RESERVE = 2;

/** Columns carrying the run's pattern: everything left of the reserve. */
const RUN_COLUMNS = ALBEDO_WIDTH - WHITE_RESERVE;

/**
 * Metres of track per vertical repeat.
 *
 * Must divide `GROUND_PERIOD` (114 m) exactly, or the texture lands in a
 * different phase each time the surface mesh snaps back and a seam crosses the
 * slope every few seconds. 38 m is 114/3, and it is the largest of the available
 * divisors that still leaves useful resolution: at 1024 rows it is 3.7 cm a
 * texel. The smaller divisors were rejected on rate rather than resolution - a
 * 19 m tile repeats at 1.1-1.9 Hz across the speed ramp, which is close enough
 * to the 2.4-4.1 Hz band that made the old ridges lock to phase; 38 m repeats at
 * 0.55-0.95 Hz, comfortably below it.
 */
export const ALBEDO_TILE_Z = 38;

/**
 * Full width of the groomed run, in metres.
 *
 * Declared here rather than imported from `groundGeometry.ts` so the dependency
 * runs one way - the geometry knows about the texture, the texture knows nothing
 * about the geometry. `tests/ground.test.ts` asserts the two agree, because a
 * silent disagreement would stretch the corduroy without breaking anything.
 */
export const ALBEDO_RUN_WIDTH = 9.2;

/**
 * Ceiling on anisotropic filtering.
 *
 * The ground is viewed at a grazing angle - roughly 11:1 at forty metres from a
 * 3.2 m eye - so four taps, the usual hardcoded guess, recovers about a quarter
 * of the sharpness available. The device is asked what it can do and this caps
 * the answer: every tap is a full texture fetch on the largest fill in the
 * frame, and sixteen of them on a mid-range Adreno is not a free lunch. **If the
 * ground turns out to be fill-bound on a device, this is the first dial to
 * turn** - eight to four is a straight halving of the ground's texture
 * bandwidth and costs sharpness only past thirty metres, where the fog has
 * closed in anyway.
 */
export const ALBEDO_ANISOTROPY_CAP = 8;

export interface Uv {
  u: number;
  v: number;
}

/**
 * Where a point on the groomed run samples the map.
 *
 * Affine in both axes on purpose: the geometry's vertex rows are 2 m apart on
 * the run and 19 m apart under the lane grooves, and an affine UV interpolates
 * exactly, so the texture's detail is completely independent of how coarse the
 * mesh under it is.
 *
 * The run's two edges land on the *centres* of the first and last content
 * columns rather than on their outer boundaries. The obvious mapping - edge to
 * edge, 0 to `RUN_COLUMNS / ALBEDO_WIDTH` - puts the far edge of the piste
 * exactly on the boundary of the white reserve, where a bilinear tap averages
 * half a texel of pure white into it and lays a bright fringe down the outer
 * lane. Half a texel is 1.8 cm and it would have been found on a device.
 */
export function albedoRunUv(x: number, z: number): Uv {
  const column = (x / ALBEDO_RUN_WIDTH + 0.5) * (RUN_COLUMNS - 1);
  return { u: (column + 0.5) / ALBEDO_WIDTH, v: z / ALBEDO_TILE_Z };
}

/**
 * Where everything that is not the run samples it: the white reserve.
 *
 * Constant, which is the point. Three vertices with the same UV give a triangle
 * with no UV derivative, so the hardware picks the base mip level and the tap
 * cannot drift into the run's content at distance.
 */
export function albedoFieldUv(): Uv {
  return { u: 1, v: 0 };
}

/* ------------------------------------------------------------------ *
 * The pattern.
 * ------------------------------------------------------------------ */

/**
 * Pitch of the groomer's corduroy, in metres.
 *
 * Real winch-cat corduroy runs 20-40 cm and this sits in the middle of it. The
 * bottom of that range was rejected for a reason that is not about realism: the
 * ribs bend with the cross-slope drift below, so the finer the rib the shorter
 * the *transverse* period the drift gives it, and 20 cm ribs on this drift land
 * near 2.7 m - inside the margin the 1.5 m floor exists to protect.
 */
const CORDUROY_PITCH = 0.3;
const CORDUROY_AMPLITUDE = 0.85;

/**
 * Wind lines and ski tracks: longitudinal streaks over the corduroy.
 *
 * The corduroy alone is a perfectly regular comb, which reads as a printed
 * pattern rather than as snow. These break it up at four scales at once, from a
 * 3.4 m wide packed lane down to a 58 cm track. Nothing shorter than the rib
 * pitch, for the drift reason above.
 */
const LINE_WAVELENGTHS = [3.4, 1.9, 1.05, 0.58] as const;
const LINE_AMPLITUDES = [1, 0.72, 0.5, 0.34] as const;

/**
 * How far the whole line pattern wanders across the run, in metres, over one
 * tile.
 *
 * This is the only thing turning a set of perfectly straight lines into
 * something a machine drove, and it is also the one number in this file that can
 * reintroduce the strobe. A single harmonic of the tile, so its slope is bounded
 * in closed form: 2*pi*0.45/38 = 0.074 m across per metre along, which gives the
 * finest 58 cm streak a transverse period of about 7.8 m and the 30 cm rib about
 * 4 m. Both comfortably clear of the 1.5 m floor, and
 * `tests/ground.test.ts` measures it rather than trusting the arithmetic.
 */
const DRIFT_AMPLITUDE = 0.45;

/**
 * The transverse half: wind drift crossing the run.
 *
 * Harmonics of the tile, so periodicity in Z is exact by construction. 38, 19,
 * 12.7, 9.5 and 6.3 m - deliberately the band the vertex profile in
 * `groundGeometry.ts` does not cover, which bottoms out at 10.4 m. Together they
 * span 6 m to 38 m, which is the range that reads as *rate* rather than rhythm.
 */
const MOTTLE_HARMONICS = [1, 2, 3, 4, 6] as const;
const MOTTLE_AMPLITUDES = [1, 0.75, 0.55, 0.4, 0.26] as const;

/**
 * Metres of Z the drift bands are sheared by per metre of X.
 *
 * Without it every band is a line square across the run, which fights the lane
 * grooves for the same read and looks like the groomer's turn-around. Shearing
 * costs nothing - it is a phase shift, so it cannot add transverse frequency.
 */
const MOTTLE_SKEW = 0.5;

/** Split between the longitudinal detail and the transverse drift. */
const LINE_WEIGHT = 0.5;
const MOTTLE_WEIGHT = 0.5;

/**
 * Mean, swing and floor of the multiplier, all in linear light.
 *
 * Linear rather than display, because that is the space the sampled map is
 * multiplied in. A linear 0.6 is a display 0.8 - the eye reads roughly the 1/2.2
 * power - so this range is a 20% tonal swing on the run, not the 40% the numbers
 * suggest. Authoring it the other way round is the mistake that produces a
 * ground that looks filthy.
 */
const ALBEDO_MEAN = 0.81;
const ALBEDO_SWING = 0.25;
export const ALBEDO_FLOOR = 0.58;

/**
 * Fixed seed: the surface is decorative and identical in every run, exactly as
 * the treeline and the vertex bands are. Phases only - the amplitudes above are
 * authored, because a rolled spectrum is a spectrum nobody has looked at.
 */
const phases = ((): { line: number[]; corduroy: number; drift: number; mottle: number[] } => {
  const rng = createRng(0x5f0b);
  return {
    corduroy: rng.next(),
    line: LINE_WAVELENGTHS.map(() => rng.next()),
    drift: rng.next(),
    mottle: MOTTLE_HARMONICS.map(() => rng.next()),
  };
})();

/** How far the line pattern has wandered across the run at this point on it. */
function driftAt(z: number): number {
  return DRIFT_AMPLITUDE * Math.sin(2 * Math.PI * (z / ALBEDO_TILE_Z + phases.drift));
}

/** The longitudinal half, evaluated on the drifted cross-slope axis. */
function linesAt(s: number): number {
  let total = CORDUROY_AMPLITUDE * Math.cos(2 * Math.PI * (s / CORDUROY_PITCH + phases.corduroy));
  let scale = CORDUROY_AMPLITUDE;
  for (let i = 0; i < LINE_WAVELENGTHS.length; i++) {
    const amplitude = LINE_AMPLITUDES[i]!;
    total += amplitude * Math.sin(2 * Math.PI * (s / LINE_WAVELENGTHS[i]! + phases.line[i]!));
    scale += amplitude;
  }
  return total / scale;
}

/** The transverse half, evaluated on the sheared along-slope axis. */
function mottleAt(t: number): number {
  let total = 0;
  let scale = 0;
  for (let i = 0; i < MOTTLE_HARMONICS.length; i++) {
    const amplitude = MOTTLE_AMPLITUDES[i]!;
    total +=
      amplitude *
      Math.sin(2 * Math.PI * (MOTTLE_HARMONICS[i]! * (t / ALBEDO_TILE_Z) + phases.mottle[i]!));
    scale += amplitude;
  }
  return total / scale;
}

/**
 * Pushes a near-Gaussian sum out towards its extremes.
 *
 * The same shaping `groundGeometry.ts` applies to its band profile, and for the
 * same reason: a sum of sinusoids spends most of its time near zero, so used raw
 * it would leave nearly all of the run at one value - which is the defect this
 * whole pass exists to fix. An exponent below one flattens the middle and widens
 * the tails without moving a single extremum, so every wavelength guarantee
 * above survives it untouched.
 */
function widen(value: number): number {
  return Math.sign(value) * Math.pow(Math.abs(value), 0.7);
}

/**
 * The albedo multiplier at a point on the run, in linear light.
 *
 * `x` is metres from the centreline and `z` metres along the track; the result
 * is exactly `ALBEDO_TILE_Z`-periodic in Z. This is the definition of the
 * pattern - the rasteriser below approximates it through lookup tables and
 * `tests/ground.test.ts` holds the two to within a byte of each other.
 */
export function snowAlbedoAt(x: number, z: number): number {
  const raw = LINE_WEIGHT * linesAt(x + driftAt(z)) + MOTTLE_WEIGHT * mottleAt(z + x * MOTTLE_SKEW);
  return clamp(ALBEDO_MEAN + widen(raw) * ALBEDO_SWING, ALBEDO_FLOOR, 1);
}

/* ------------------------------------------------------------------ *
 * Rasterisation.
 * ------------------------------------------------------------------ */

/**
 * The pattern is two one-dimensional functions read along shifted axes, and the
 * rasteriser exploits that rather than evaluating it.
 *
 * Half a million texels times ten sinusoids is five million transcendentals, a
 * second of dead time on a phone at a point in startup where nothing else is
 * happening. Tabulating each half once and interpolating turns the inner loop
 * into two array reads whose indices *increment* - the drifted axis and the
 * sheared axis are both affine in X along a row - and the whole map falls out in
 * a few milliseconds.
 *
 * Fine enough that the piecewise-linear reconstruction is well inside the eight
 * bits it is quantised to: 1.2 mm against a 30 cm rib, and 3.7 cm against a 6 m
 * drift band.
 */
const LINE_TABLE_SIZE = 8192;
const MOTTLE_TABLE_SIZE = 2048;

/** Half-width of the tabulated cross-slope axis: the run plus the drift. */
const LINE_TABLE_HALF = ALBEDO_RUN_WIDTH / 2 + DRIFT_AMPLITUDE;

const lineTable = ((): Float32Array => {
  const table = new Float32Array(LINE_TABLE_SIZE + 1);
  for (let i = 0; i <= LINE_TABLE_SIZE; i++) {
    table[i] = linesAt(-LINE_TABLE_HALF + (2 * LINE_TABLE_HALF * i) / LINE_TABLE_SIZE);
  }
  return table;
})();

const mottleTable = ((): Float32Array => {
  // One extra entry holding the wrap-around value, so the interpolation in the
  // final cell needs no branch and no modulo of the index.
  const table = new Float32Array(MOTTLE_TABLE_SIZE + 1);
  for (let i = 0; i <= MOTTLE_TABLE_SIZE; i++) {
    table[i] = mottleAt((ALBEDO_TILE_Z * i) / MOTTLE_TABLE_SIZE);
  }
  return table;
})();

function readTable(table: Float32Array, position: number, last: number): number {
  const index = clamp(Math.floor(position), 0, last - 1);
  const fraction = position - index;
  const low = table[index]!;
  return low + (table[index + 1]! - low) * fraction;
}

/**
 * sRGB transfer function.
 *
 * The canvas is uploaded as an sRGB texture and three linearises it on sample,
 * so the byte written here is the *display* encoding of the linear multiplier
 * the pattern authored. Eight bits of sRGB over a 0.6-1.0 linear range is about
 * 45 distinct steps, which is a step every 0.9% of the swing - below the
 * threshold at which a gradient bands on a phone panel.
 */
function linearToSrgb(value: number): number {
  return value <= 0.0031308 ? 12.92 * value : 1.055 * Math.pow(value, 1 / 2.4) - 0.055;
}

/**
 * Everything between the summed pattern and the byte, in one table.
 *
 * `widen` and the sRGB encode are a `Math.pow` each, and per texel that is a
 * million transcendentals which dominated the rasteriser by a factor of six.
 * They are both pure functions of the summed pattern, which is bounded on
 * [-1, 1] by construction - the two halves are normalised and their weights sum
 * to one - so the whole tail collapses into a lookup. Sampled finely enough that
 * the nearest entry is within a tenth of a byte of the exact value even where
 * the shaping curve is at its steepest, near zero.
 */
const TONE_TABLE_SIZE = 8192;

const toneTable = ((): Uint8Array => {
  const table = new Uint8Array(TONE_TABLE_SIZE + 1);
  for (let i = 0; i <= TONE_TABLE_SIZE; i++) {
    const raw = -1 + (2 * i) / TONE_TABLE_SIZE;
    const linear = clamp(ALBEDO_MEAN + widen(raw) * ALBEDO_SWING, ALBEDO_FLOOR, 1);
    table[i] = Math.round(255 * linearToSrgb(linear));
  }
  return table;
})();

/**
 * The map as raw RGBA bytes.
 *
 * Split out from the texture below so the whole pattern path is testable in
 * node: no canvas, no DOM, no WebGL, exactly as `tests/models.test.ts` builds
 * real geometry without a renderer.
 */
export function rasteriseSnowAlbedo(): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(ALBEDO_WIDTH * ALBEDO_HEIGHT * 4);

  const lineScale = LINE_TABLE_SIZE / (2 * LINE_TABLE_HALF);
  const mottleScale = MOTTLE_TABLE_SIZE / ALBEDO_TILE_Z;
  // The inverse of `albedoRunUv`: the first and last content columns *are* the
  // two edges of the run, so there are one fewer gaps than columns.
  const metresPerColumn = ALBEDO_RUN_WIDTH / (RUN_COLUMNS - 1);
  const firstX = -ALBEDO_RUN_WIDTH / 2;
  // Rows are a repeating tile rather than a mapped span, so they take the
  // ordinary texel-centre convention.
  const metresPerRow = ALBEDO_TILE_Z / ALBEDO_HEIGHT;

  for (let row = 0; row < ALBEDO_HEIGHT; row++) {
    const z = (row + 0.5) * metresPerRow;
    const drift = driftAt(z);

    // Both axes are affine in X along the row, so the two table positions step
    // by a constant and the loop never touches a transcendental.
    let linePosition = (firstX + drift + LINE_TABLE_HALF) * lineScale;
    const lineStep = metresPerColumn * lineScale;
    // Double modulo, the same guard `wrapZ` carries: the shear runs the axis
    // negative at the left edge of the run for the first few rows, and a single
    // `%` would hand back a negative offset that silently clamps to the start of
    // the table and flattens a strip of the map.
    const mottleStart = (((z + firstX * MOTTLE_SKEW) % ALBEDO_TILE_Z) + ALBEDO_TILE_Z) % ALBEDO_TILE_Z;
    let mottlePosition = mottleStart * mottleScale;
    const mottleStep = metresPerColumn * MOTTLE_SKEW * mottleScale;

    for (let column = 0; column < ALBEDO_WIDTH; column++) {
      let byte = 255;
      if (column < RUN_COLUMNS) {
        const raw =
          LINE_WEIGHT * readTable(lineTable, linePosition, LINE_TABLE_SIZE) +
          MOTTLE_WEIGHT * readTable(mottleTable, mottlePosition, MOTTLE_TABLE_SIZE);
        byte = toneTable[clamp(Math.round((raw + 1) * (TONE_TABLE_SIZE / 2)), 0, TONE_TABLE_SIZE)]!;
      }

      const i = (row * ALBEDO_WIDTH + column) * 4;
      pixels[i] = byte;
      pixels[i + 1] = byte;
      pixels[i + 2] = byte;
      pixels[i + 3] = 255;

      linePosition += lineStep;
      mottlePosition += mottleStep;
      // The mottle axis is periodic and the table holds exactly one period, so
      // the shear has to be folded back rather than allowed to run off the end.
      if (mottlePosition >= MOTTLE_TABLE_SIZE) mottlePosition -= MOTTLE_TABLE_SIZE;
      else if (mottlePosition < 0) mottlePosition += MOTTLE_TABLE_SIZE;
    }
  }

  return pixels;
}

/**
 * Built once for the session, like the surface it sits on.
 *
 * Module-level rather than a `useMemo` for the same reason: a development-mode
 * double render would otherwise leave a second two-megabyte upload on the GPU.
 */
let albedo: THREE.CanvasTexture | undefined;

/**
 * The map, ready to hang on the ground material.
 *
 * `maxAnisotropy` comes from the live renderer's capabilities rather than a
 * guess - the answer ranges from 1 to 16 across the devices this ships to, and
 * asking is one call at startup.
 */
export function snowAlbedoTexture(maxAnisotropy: number): THREE.CanvasTexture {
  if (albedo) return albedo;

  const canvas = document.createElement('canvas');
  canvas.width = ALBEDO_WIDTH;
  canvas.height = ALBEDO_HEIGHT;

  const context = canvas.getContext('2d');
  if (context) {
    const image = context.createImageData(ALBEDO_WIDTH, ALBEDO_HEIGHT);
    image.data.set(rasteriseSnowAlbedo());
    context.putImageData(image, 0, 0);
  }

  albedo = new THREE.CanvasTexture(canvas);
  // The horizontal axis is the run's own width plus a white margin, so it must
  // *not* repeat: wrapping it would fold the far edge of the piste back onto
  // the reserve and put a bright seam down the outer lane.
  albedo.wrapS = THREE.ClampToEdgeWrapping;
  albedo.wrapT = THREE.RepeatWrapping;
  albedo.colorSpace = THREE.SRGBColorSpace;
  albedo.anisotropy = Math.min(ALBEDO_ANISOTROPY_CAP, Math.max(1, maxAnisotropy));
  return albedo;
}
