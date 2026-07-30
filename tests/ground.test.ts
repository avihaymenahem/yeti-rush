/**
 * The snow surface and the treeline.
 *
 * Two things here are geometry and one is a signal, and the signal is the
 * interesting half. The old ridges were a single hard band every 8.85 m, which
 * at 21 to 36 units a second is a strictly periodic 2.4-4.1 Hz stimulus - above
 * the rate at which the visual system stops integrating position and locks on
 * to phase, so it carried phase and threw the *rate* away. Replacing it with a
 * sum of harmonics is only a fix if the replacement is genuinely broadband and
 * genuinely coarse, and neither of those is visible in a diff.
 *
 * Pure logic throughout: real three.js geometry built in node, as
 * `tests/models.test.ts` does, no DOM and no WebGL.
 */

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { OBSTACLE_MODELS, PINE_MODELS } from '@/game/content/models';
import { OBSTACLE_KINDS, obstacleDef } from '@/game/content/obstacles';
import { LANES, TUNING } from '@/game/config/tuning';
import { MARKERS, PALETTE, PISTE_CADENCE, TRAIL } from '@/game/config/visuals';
import {
  buildGroundSurface,
  fieldPatchAt,
  fieldTone,
  GROUND_FAR_Z,
  GROUND_NEAR_Z,
  GROUND_PERIOD,
  GROUND_Z_STATION,
  guideCadenceAt,
  GUIDE_CORE_Z_STATION,
  laneBoundaries,
  laneGuideTone,
  LANE_GUIDE_WIDTH,
  LANE_GUIDE_Y,
  PISTE_HALF_WIDTH,
  pisteTone,
  snowBandAt,
  tone,
  toneLuma,
  type Tone,
} from '@/game/render/groundGeometry';
import { PROP_BUILDERS, propGeometry, type PropKind } from '@/game/render/propGeometry';
import {
  ALBEDO_FLOOR,
  ALBEDO_HEIGHT,
  ALBEDO_RUN_WIDTH,
  ALBEDO_TILE_Z,
  ALBEDO_WIDTH,
  albedoFieldUv,
  albedoRunUv,
  rasteriseSnowAlbedo,
  snowAlbedoAt,
} from '@/game/render/snowSurface';
import {
  PINE_FAR_X,
  PINE_NEAR_X,
  pineLayout,
  pineScaleFor,
  RECYCLE_Z,
  SPAWN_Z,
  TRACK_COLORS,
} from '@/game/render/trackLayout';

/* ------------------------------------------------------------------ *
 * The band profile.
 * ------------------------------------------------------------------ */

/**
 * Shortest full period present in a profile, in metres.
 *
 * Measured rather than derived from the harmonic list, because the harmonics
 * are summed and a sum can put two extrema closer together than any single
 * component's half-wavelength. Extrema are located by sign changes of the
 * discrete slope; the shortest period is twice the closest pair of them.
 */
function shortestPeriodOf(sample: (z: number) => number): number {
  const step = 0.01;
  let previousSlope = sample(step) - sample(0);
  let lastExtremum: number | undefined;
  let shortest = Infinity;

  for (let z = step; z < GROUND_PERIOD; z += step) {
    const slope = sample(z + step) - sample(z);
    if (slope !== 0 && Math.sign(slope) !== Math.sign(previousSlope)) {
      if (lastExtremum !== undefined) shortest = Math.min(shortest, 2 * (z - lastExtremum));
      lastExtremum = z;
    }
    if (slope !== 0) previousSlope = slope;
  }

  return shortest;
}

/** How many turning points a profile has over one period. */
function extremaOver(sample: (z: number) => number, span: number): number {
  const step = 0.01;
  let previousSlope = sample(step) - sample(0);
  let count = 0;
  for (let z = step; z < span; z += step) {
    const slope = sample(z + step) - sample(z);
    if (slope !== 0 && Math.sign(slope) !== Math.sign(previousSlope)) count++;
    if (slope !== 0) previousSlope = slope;
  }
  return count;
}

function rangeOf(sample: (z: number) => number, span: number): [number, number] {
  let low = Infinity;
  let high = -Infinity;
  for (let z = 0; z < span; z += 0.05) {
    const value = sample(z);
    low = Math.min(low, value);
    high = Math.max(high, value);
  }
  return [low, high];
}

describe('the snow bands carry rate rather than phase', () => {
  it('never puts a feature under the distance a frame advances', () => {
    /*
     * The hard floor, and it is arithmetic rather than taste: at the top speed
     * of 36 units a second the ground moves 0.6 m in a 60 Hz frame, so a
     * pattern with a period under about 1.5 m is sampled below twice per cycle
     * and either strobes or runs backwards. Mipmapping does not save it -
     * there is no texture here to mip - and neither does drawing it softer.
     *
     * The profile actually lands near 5.8 m. The bound is where the physics
     * puts it, not where the content happens to sit, so tightening the
     * harmonics later still has room before it fails.
     */
    expect(shortestPeriodOf((z) => snowBandAt(z))).toBeGreaterThanOrEqual(1.5);
    expect(shortestPeriodOf((z) => fieldPatchAt(z))).toBeGreaterThanOrEqual(1.5);
  });

  it('and that bound is one a fine feature actually fails', () => {
    // The mutation, kept rather than run once by hand. A threshold that has
    // never been seen to fail is not known to discriminate - and this one
    // guards against a change (adding one more harmonic) that looks entirely
    // reasonable in a diff. Thirty centimetres is half of what a frame moves.
    const strobing = (z: number): number => snowBandAt(z) + 0.05 * Math.sin((2 * Math.PI * z) / 0.3);
    expect(shortestPeriodOf(strobing)).toBeLessThan(1.5);
  });

  it('is broadband rather than one long wave', () => {
    /*
     * The counterweight, and it is the one that matters: "no feature shorter
     * than 1.5 m" is trivially and perfectly satisfied by a constant, which is
     * exactly the flat plane this whole package exists to replace. A speed cue
     * needs turning points going past the eye, so the profile has to have
     * several of them per period and has to swing most of its available range.
     *
     * Eighteen extrema over 114 m is a feature roughly every 6 m: about 3.5 a
     * second at the opening speed and 6 at the top, which is a *rate* the eye
     * can integrate rather than a rhythm it locks to.
     */
    expect(extremaOver((z) => snowBandAt(z), GROUND_PERIOD)).toBeGreaterThanOrEqual(10);

    const [low, high] = rangeOf((z) => snowBandAt(z), GROUND_PERIOD);
    expect(high - low).toBeGreaterThan(1.4);
  });

  it('repeats exactly on the scroll period, so the wrap cannot be seen', () => {
    /*
     * The surface is one static mesh that slides towards the camera and snaps
     * back a period at a time. Every colour on it is a function of the vertex's
     * own Z, so the snap is invisible if and only if that function repeats on
     * exactly `GROUND_PERIOD` - and "roughly repeats" is not good enough, since
     * the discontinuity would land on the largest surface in the frame, every
     * three to five seconds, for the whole run.
     */
    for (let z = -200; z < 200; z += 0.37) {
      expect(snowBandAt(z, 2.1)).toBeCloseTo(snowBandAt(z + GROUND_PERIOD, 2.1), 9);
      expect(fieldPatchAt(z, -7)).toBeCloseTo(fieldPatchAt(z + GROUND_PERIOD, -7), 9);
    }
  });

  it('slews across the run instead of drawing lines square across it', () => {
    // Without the skew every band is a straight line across the track, which is
    // corduroy at the wrong scale and competes with the lane guides for the
    // same read. The two edges of the run must be visibly out of phase.
    let biggest = 0;
    for (let z = 0; z < GROUND_PERIOD; z += 0.5) {
      biggest = Math.max(
        biggest,
        Math.abs(snowBandAt(z, -PISTE_HALF_WIDTH) - snowBandAt(z, PISTE_HALF_WIDTH)),
      );
    }
    expect(biggest).toBeGreaterThan(0.5);
  });
});

/* ------------------------------------------------------------------ *
 * The authored tones.
 * ------------------------------------------------------------------ */

/**
 * Lowest and highest display luminance the groomed run reaches anywhere.
 *
 * The run's *vertex* tone, before the albedo map, which only ever darkens it -
 * so anything compared against this range is compared conservatively.
 */
function pisteLumaRange(): [number, number] {
  let low = 1;
  let high = 0;
  for (let z = 0; z < GROUND_PERIOD; z += 0.5) {
    for (let x = -PISTE_HALF_WIDTH; x <= PISTE_HALF_WIDTH; x += 0.2) {
      const value = toneLuma(pisteTone(x, z));
      low = Math.min(low, value);
      high = Math.max(high, value);
    }
  }
  return [low, high];
}

describe('the surface spends the value range it was given', () => {
  it('spreads the largest surface in the frame across several deciles', () => {
    /*
     * The measured defect this package is aimed at: 70% of the play space sat
     * inside a single 10% luminance band, and the groomed run is the biggest
     * single contributor to that measurement. A flat plane at one value cannot
     * be fixed by choosing a better single value; it has to stop being one
     * value. Two deciles of spread is the minimum that reads as tonal
     * variation rather than as a gradient artefact.
     */
    const [low, high] = pisteLumaRange();
    expect(high - low).toBeGreaterThan(0.15);
    // And the bottom of that spread has to leave the crowded 70-80% band
    // outright, not merely lean out of it.
    expect(low).toBeLessThan(0.62);
  });

  it('keeps the run darker than the field it is cut into', () => {
    // The piste edge is the only thing telling the player how much track there
    // is, and the mid-tone run is what gives a near-white yeti a silhouette.
    // Checked at the join, where the two are hardest to tell apart.
    for (let z = 0; z < GROUND_PERIOD; z += 1.3) {
      const field = toneLuma(fieldTone(PISTE_HALF_WIDTH, z));
      const piste = toneLuma(pisteTone(PISTE_HALF_WIDTH, z));
      expect(field - piste).toBeGreaterThan(0.15);
    }
  });

  it('keeps the field as the frame top end', () => {
    // The counterweight to darkening the run: the near field is where the
    // bright end of the histogram lives, and the whole reason the piste was
    // taken down was to sit against it. Dragging everything dark would satisfy
    // the spread assertion above and lose the contrast it was bought for.
    expect(toneLuma(fieldTone(PISTE_HALF_WIDTH + 0.3, 0))).toBeGreaterThan(0.85);
  });

  it('puts a genuinely deep value in the lane grooves', () => {
    /*
     * `PALETTE.snowShadow` is 55% luminance, which is inside the band this pass
     * is emptying, so the groove core is taken well below it. A groove is the
     * one place on the play surface that can carry a deep value at no cost to
     * legibility - nothing is ever read *against* a 24 cm stripe.
     *
     * Measured on the strong half of the cadence, which is what the guide is
     * for two thirds of every repeat. The faint half is a separate guarantee
     * below, and conflating the two would let a cadence that erased the line
     * pass by averaging.
     */
    let deepest = 1;
    let worst = 1;
    let strongSamples = 0;
    for (let z = 0; z < GROUND_PERIOD; z += 0.05) {
      if (guideCadenceAt(z) !== 0) continue;
      for (const centre of laneBoundaries()) {
        deepest = Math.min(deepest, toneLuma(laneGuideTone(centre, z)));
        // And it has to be dark *relative to the run*, at the darkest the run
        // gets, or the lines vanish inside a scoured band.
        worst = Math.min(
          worst,
          toneLuma(pisteTone(centre, z)) - toneLuma(laneGuideTone(centre, z)),
        );
        strongSamples++;
      }
    }

    // Stated, because the two bounds below mean nothing without it: the strong
    // plateau has to be most of the track, not a handful of rows.
    expect(strongSamples).toBeGreaterThan(1000);
    expect(deepest).toBeLessThan(0.5);
    expect(worst).toBeGreaterThan(0.12);
  });

  it('widens the grooves enough to survive the distance', () => {
    // Nine centimetres was under a pixel at forty metres. Widened and not
    // softened: a wide faint line is a smudge, which is why the core stays at
    // full strength and only the width changed.
    expect(LANE_GUIDE_WIDTH).toBeGreaterThan(0.3);
    // But never wide enough to be mistaken for a lane's worth of anything.
    expect(LANE_GUIDE_WIDTH).toBeLessThan(0.6);
  });
});

/* ------------------------------------------------------------------ *
 * Headroom above the run: what the player has to read against it.
 * ------------------------------------------------------------------ */

/**
 * Mean of the corduroy albedo across the run.
 *
 * The **mean**, not the floor, and the distinction decides whether this
 * measurement is usable. The map bottoms out near 0.61, but it gets there in
 * individual 15 cm corduroy lines; an obstacle is read against the snow *around*
 * it, which is the average, not the darkest texel a winch cat left. Judging the
 * palette against the floor rejects two thirds of it to guard against a feature
 * narrower than the thing standing on it.
 */
let albedoMeanCache: number | undefined;
function albedoMean(): number {
  if (albedoMeanCache !== undefined) return albedoMeanCache;
  let sum = 0;
  let samples = 0;
  for (let z = 0; z < ALBEDO_TILE_Z; z += 0.19) {
    for (let x = -PISTE_HALF_WIDTH; x <= PISTE_HALF_WIDTH; x += 0.05) {
      sum += snowAlbedoAt(x, z);
      samples++;
    }
  }
  albedoMeanCache = sum / samples;
  return albedoMeanCache;
}

const albedoScratch = new THREE.Color();
const albedoDisplay = { r: 0, g: 0, b: 0 };

/**
 * A surface tone taken through the albedo map, in display luminance.
 *
 * The round trip is not decoration. The map multiplies in the *linear* space it
 * is sampled in, and these tones are authored in display space: 0.81 linear is
 * 0.91 display, so doing it in the wrong space moves the run's floor by five
 * levels - which is most of the margin the palette below is judged on.
 */
function throughAlbedo(colour: Tone, map: number): number {
  albedoScratch.setRGB(colour.r, colour.g, colour.b, THREE.SRGBColorSpace);
  albedoScratch.multiplyScalar(map);
  albedoScratch.getRGB(albedoDisplay, THREE.SRGBColorSpace);
  return 0.2126 * albedoDisplay.r + 0.7152 * albedoDisplay.g + 0.0722 * albedoDisplay.b;
}

/**
 * The value band the run actually occupies: its brightest vertex tone down to
 * its darkest one once the corduroy has taken its share.
 *
 * **Not `pisteLumaRange()`, and the difference was hiding a real defect.** The
 * vertex tone is the run *before* the map, and the map only ever darkens - which
 * the previous version of this file read as "so an obstacle clearing the vertex
 * range clears the rendered one by more". That is true above the band and
 * exactly backwards below it, where the map is closing the gap rather than
 * widening it. Measured, the mean takes 0.053 off the floor, which is larger
 * than `OBSTACLE_CLEARANCE`: every below-band margin in the old measurement was
 * overstated by more than the whole threshold, and one kind was sitting inside
 * the run while the test called it clear.
 */
function runBand(): [number, number] {
  const mean = albedoMean();
  let low = 1;
  let high = 0;
  for (let z = 0; z < GROUND_PERIOD; z += 0.5) {
    for (let x = -PISTE_HALF_WIDTH; x <= PISTE_HALF_WIDTH; x += 0.2) {
      const colour = pisteTone(x, z);
      low = Math.min(low, throughAlbedo(colour, mean));
      // The map cannot exceed 1, so the bright edge is the vertex tone itself.
      high = Math.max(high, toneLuma(colour));
    }
  }
  return [low, high];
}

/** Warm against a cold run - the other way an obstacle can separate. */
function isWarm(hex: string): boolean {
  const colour = tone(hex);
  return colour.r > colour.b;
}

describe('the run leaves room above it for the things read against it', () => {
  /*
   * The measured defect: a drift read 3.2 display luminance levels above the
   * snow beside it and a boulder 8.0, where the log reads 63 below. That is a
   * fairness problem - the player cannot see what is going to kill them - and it
   * has two halves. The obstacles' own albedo is one and lives in
   * `content/obstacles.ts`; the *value band of the surface they are read
   * against* is the other and lives here.
   */

  /*
   * The ceiling, named once because the guarantee and its mutation have to move
   * together and did not: it was written as a bare `0.74` in both, and when
   * `PALETTE.piste` came down from `#aecce9` to `#8fb2d4` in this same pass the
   * run's peak fell to 0.7250 while the symmetric band it is meant to reject
   * fell to 0.7385. A ceiling above *both* still passes the guarantee and stops
   * discriminating, which is exactly what the mutation caught.
   *
   * 0.73 is where it has to sit: above what the shipped asymmetric band reaches
   * and below what the symmetric one it replaced would. Tightening, not
   * loosening - the run is now held 1.3 display levels under where it was
   * allowed to go before, and the pair of assertions below is what proves the
   * number still separates the two designs rather than merely sitting above the
   * current one.
   */
  const PISTE_CEILING = 0.73;

  /**
   * How far an obstacle's value has to sit outside the run's own range before it
   * counts as having a silhouette against it.
   *
   * Named and shared for the same reason the ceiling is: the guarantee below and
   * the mutation that proves it discriminates have to be measuring the identical
   * predicate, or the mutation is testing a copy of the rule rather than the
   * rule.
   */
  const OBSTACLE_CLEARANCE = 0.05;

  /** Distance from the run's rendered value band - zero anywhere inside it. */
  function clearanceOf(value: number): number {
    const [low, high] = runBand();
    return value < low ? low - value : Math.max(0, value - high);
  }

  const clearanceFor = (kind: (typeof OBSTACLE_KINDS)[number]): number =>
    clearanceOf(toneLuma(tone(obstacleDef(kind).color)));

  it('caps how bright the piste is allowed to get', () => {
    // Everything the player must parse at speed used to be brighter than the
    // run, so every point the run climbed was a point of silhouette taken off a
    // white obstacle. The packed bands are the only thing that lifts it.
    const [, high] = pisteLumaRange();
    expect(high).toBeLessThan(PISTE_CEILING);
  });

  it('and the symmetric band it replaced is what that rejects', () => {
    /*
     * The mutation, and it is the exact edit this replaced: one strength shared
     * by both directions. `PACKED_TONE` is restated rather than exported - if it
     * ever moves far enough that a 0.45 lift no longer breaches the ceiling,
     * this assertion fails and says so, which is the behaviour wanted from a
     * copy of a constant.
     */
    const base = toneLuma(tone(TRACK_COLORS.piste));
    const packed = toneLuma(tone('#c6dbf0'));

    let strongest = 0;
    for (let z = 0; z < GROUND_PERIOD; z += 0.25) {
      for (let x = -PISTE_HALF_WIDTH; x <= PISTE_HALF_WIDTH; x += 0.2) {
        strongest = Math.max(strongest, snowBandAt(z, x));
      }
    }
    // Luminance is linear in the channels, so the luma of a mix is the mix of
    // the lumas exactly - no need to rebuild the tone to measure it.
    expect(base + strongest * 0.45 * (packed - base)).toBeGreaterThan(PISTE_CEILING);
  });

  it('without giving back the range the darkening bought', () => {
    // The counterweight, and the failure mode a ceiling invites: "the run is
    // never bright" is perfectly satisfied by a run with no banding at all,
    // which is the flat plane this whole file replaced. The spread has to
    // survive the cap, and it has to survive it downwards.
    const [low, high] = pisteLumaRange();
    expect(high - low).toBeGreaterThan(0.15);
    expect(low).toBeLessThan(0.62);
  });

  it('measures the run where the corduroy leaves it, not where the vertices do', () => {
    /*
     * The correction this section turns on. The albedo map only darkens, and
     * that was read as making a vertex-tone comparison conservative - true for
     * an obstacle brighter than the run, and precisely backwards for one darker
     * than it, which is seven of the eight kinds.
     *
     * The bite has to be larger than the threshold for the distinction to have
     * cost anything, and it is: 0.053 against 0.05.
     */
    const [low] = runBand();
    const [vertexLow] = pisteLumaRange();
    expect(vertexLow - low).toBeGreaterThan(OBSTACLE_CLEARANCE);

    /*
     * And the counterweight, because "the run is darker than it looks" is
     * perfectly satisfied by a map that drags it to black - which would hand
     * every obstacle a clearance it has not earnt while turning the largest
     * surface in the frame into the darkest. Pinned to real content: the run's
     * floor has to stay clear of the darkest kind in the game.
     */
    expect(low).toBeGreaterThan(
      toneLuma(tone(obstacleDef('log').color)) + OBSTACLE_CLEARANCE,
    );
  });

  it('gives every obstacle kind a value or a hue that separates it from the run', () => {
    /*
     * The guarantee this whole section exists for, and it lives in the ground
     * tests because it is a *relationship* between two files: the obstacle
     * palette is only legible relative to the surface it is read against, and
     * that surface's band is computed here.
     *
     * Value **or** hue, because value alone is not what the art direction
     * actually claims. The run is a cold blue; the slalom banner is the hot
     * orange the player has already learnt means "boundary", and it separates by
     * being the opposite side of the wheel rather than by being darker. Making
     * it darker to satisfy a luminance rule would take away the one thing that
     * makes it readable in a fifth of a second.
     */
    // Collected rather than asserted one at a time, so a failure names the kind
    // that went invisible instead of reporting two numbers.
    const invisible = OBSTACLE_KINDS.filter(
      (kind) =>
        clearanceFor(kind) <= OBSTACLE_CLEARANCE && !isWarm(obstacleDef(kind).color),
    );
    expect(invisible).toEqual([]);
  });

  it('spends the hue exemption on exactly one kind', () => {
    /*
     * The counterweight, and the failure mode "or hue" invites: it is an excuse
     * that costs nothing to claim, so a palette can drift into the run one kind
     * at a time and every one of them can point at the banner. A hard list is
     * what stops that - a second kind arriving here names itself.
     *
     * The banner is at 0.014 of value clearance, which is nothing, and it is the
     * only one under the threshold. `tunnelRock` is the binding *value* case at
     * 0.052 and its geometry is what carries it - see the prop measurement
     * below, where it clears on all of its drawn area rather than on one hex.
     */
    const byHue = OBSTACLE_KINDS.filter((kind) => clearanceFor(kind) <= OBSTACLE_CLEARANCE);
    expect(byHue).toEqual(['banner']);

    // And the exemption has to be real: warm against a run that is genuinely
    // cold, not two neighbouring blues one of which happens to be redder.
    const banner = tone(obstacleDef('banner').color);
    const run = pisteTone(0, 0);
    expect(banner.r - banner.b).toBeGreaterThan(0.4);
    expect(run.r - run.b).toBeLessThan(-0.2);
  });

  it('sends the drift above the run and every other kind below it', () => {
    /*
     * Direction, not just distance, and it is the half the previous round got
     * wrong. The drift is the only kind made of the ground's own material, so it
     * cannot separate by hue and it cannot separate by being *something else* -
     * it has one axis, and now that the run is a mid-tone the range on that axis
     * is upwards. Every other kind is a made or a natural object that is not
     * snow, and all of them go down, where the room is.
     */
    const [low, high] = runBand();
    expect(toneLuma(tone(obstacleDef('drift').color))).toBeGreaterThan(
      high + OBSTACLE_CLEARANCE,
    );
    for (const kind of OBSTACLE_KINDS) {
      if (kind === 'drift') continue;
      expect(
        toneLuma(tone(obstacleDef(kind).color)),
        `${kind} is brighter than the run it stands on`,
      ).toBeLessThan(low);
    }
  });

  it('and the mid-grey drift the vertex band would have allowed is what that rejects', () => {
    /*
     * The mutation, and it is not hypothetical - `#6d8598` is the value this file
     * shipped with one round ago, authored as "wind-packed snow in its own
     * shade". It passes the old rule and fails the real one, which is the whole
     * argument for both changes in one assertion: 0.057 clear of the vertex tone,
     * 0.004 clear of the run as the corduroy actually leaves it.
     *
     * A drift sitting on the run's own floor is lighter than the snow on a
     * scoured band and darker on a packed one. That is not a read, it is a coin
     * flip - the exact defect the mid-grey was chosen to avoid.
     */
    const midGrey = toneLuma(tone('#6d8598'));
    const [vertexLow] = pisteLumaRange();

    expect(vertexLow - midGrey).toBeGreaterThan(OBSTACLE_CLEARANCE);
    expect(clearanceOf(midGrey)).toBeLessThan(0.01);
  });

  it('keeps the drift on the run, which is the only reason it may be near-white', () => {
    /*
     * The counterweight to letting one kind go up instead of down, and the
     * danger is real rather than theoretical: the untouched field either side
     * runs 0.84 to 0.93 and this drift is 0.93, so out there it would be
     * genuinely invisible - the very defect being fixed, moved sideways.
     *
     * What makes it safe is geometry, not colour. The outer lane sits at 2.2 and
     * the drift reaches 0.9 either side of it, against a piste edge at 4.6.
     */
    const outerLane = Math.max(...LANES.map(Math.abs));
    expect(outerLane + obstacleDef('drift').halfWidth).toBeLessThan(PISTE_HALF_WIDTH);

    // The danger, asserted rather than described: on the field this colour has
    // no silhouette at all.
    const drift = toneLuma(tone(obstacleDef('drift').color));
    expect(Math.abs(drift - toneLuma(fieldTone(PISTE_HALF_WIDTH + 0.3, 0)))).toBeLessThan(
      OBSTACLE_CLEARANCE,
    );
  });

  it('and an obstacle carrying the run’s own value is what that rejects', () => {
    /*
     * An obstacle carrying the surface's own value has no silhouette against it
     * whatever that surface is currently painted, so the probes are taken from
     * the palette rather than frozen as hexes - which is what keeps this testing
     * white-on-white the next time the run moves. A frozen literal goes stale:
     * this test used to assert `#e2eef6`, and once `PALETTE.piste` came down ten
     * points of value that colour was 0.20 clear of the band and mutating
     * nothing.
     *
     * Neither probe is the band edge plus a fraction of the threshold. An offset
     * constructed from `OBSTACLE_CLEARANCE` is caught by `OBSTACLE_CLEARANCE`
     * for arithmetical reasons and would pass at any threshold at all, which is a
     * tautology wearing a mutation's clothes. `snowShadow` is the one with teeth:
     * it is a real authoring choice - "paint the drift as snow in shade" - and it
     * lands inside the band rather than beside it.
     */
    const invisible = {
      'the run’s own snow': TRACK_COLORS.piste,
      'snow in shade': PALETTE.snowShadow,
    };

    const missed = Object.entries(invisible).filter(
      ([, hex]) => clearanceOf(toneLuma(tone(hex))) > OBSTACLE_CLEARANCE,
    );
    expect(missed.map(([name]) => name)).toEqual([]);
  });

  it('and takes nothing below the darkest kind that already reads', () => {
    /*
     * The counterweight to darkening obstacles, and the one that matters:
     * "clear of the run's range" is trivially satisfied by painting everything
     * black, which under this rig is not a dark surface but a hole - a
     * camera-facing face receives neither the key nor the sun, only the fill and
     * the hemisphere. The reference is the fallen log at 0.33, which measures 63
     * levels below the snow and has never read as a hole.
     */
    const holes = OBSTACLE_KINDS.filter(
      (kind) => toneLuma(tone(obstacleDef(kind).color)) <= 0.3,
    );
    expect(holes).toEqual([]);
  });

  it('and keeps the obstacle set from collapsing into one cold palette', () => {
    // The second counterweight. Two of the three dodges were already cold grey
    // and blue, and an obstacle the player has a fifth of a second to spot
    // should not have to be picked out of a snowfield by silhouette alone -
    // which taking the drift and the boulder down would quietly undo.
    const warm = OBSTACLE_KINDS.filter((kind) => isWarm(obstacleDef(kind).color));
    expect(warm.length).toBeGreaterThanOrEqual(3);
  });
});

/* ------------------------------------------------------------------ *
 * What is drawn, rather than what is authored.
 * ------------------------------------------------------------------ */

describe('the obstacle palette reaches the screen', () => {
  /*
   * Everything above measures `ObstacleDef.color`, and **nothing renders it.**
   * `Obstacles.tsx` reads it in `BoxObstacleLayer` alone and no kind reaches
   * that path: all eight have either a model in `content/models.ts` or a builder
   * in `render/propGeometry.ts`, and each of those restates its own colour. That
   * duplication is the reason two measured legibility defects survived a whole
   * palette pass with a green suite - the tests were asserting properties of a
   * field the renderer never reads.
   *
   * So this block closes the loop from both ends. A model that recolours has to
   * recolour to the value its kind is authored at; a built prop is measured on
   * its actual baked vertex colours.
   */

  const [low, high] = runBand();

  it('requires a recoloured model to reach the value its kind is authored at', () => {
    /*
     * `useModel` lerps the pack's own material colour towards `recolor.color` by
     * `recolor.amount`, and the Nature Kit rock's body material is
     * `_defaultMat` - pure white. So the amount is not a taste dial, it is how
     * much of a white base survives into an obstacle that is meant to be wet
     * slate: at 0.72 the body renders at L=170 against a run whose maximum is
     * 171, which is the measured +8.0 still on screen. At full strength it lands
     * at 71, clear below the darkest snow on the slope and still lighter than
     * the log.
     *
     * Both halves are asserted because either one alone passes while the
     * obstacle stays invisible - the right target at a partial amount lands at
     * 147, inside the run.
     */
    for (const [kind, specs] of Object.entries(OBSTACLE_MODELS)) {
      for (const spec of specs ?? []) {
        if (!spec.recolor) continue;
        const authored = obstacleDef(kind as (typeof OBSTACLE_KINDS)[number]).color;
        expect(
          spec.recolor.color,
          `${kind}'s model recolours to ${spec.recolor.color}, not the ${authored} it is authored at`,
        ).toBe(authored);
        expect(
          spec.recolor.amount,
          `${kind}'s recolour leaves ${Math.round((1 - spec.recolor.amount) * 100)}% of a white base material in it`,
        ).toBe(1);
      }
    }
  });

  /**
   * Fraction of a built prop's surface area whose baked colour clears the run.
   *
   * Area-weighted rather than counted per vertex, because vertices are not
   * surface: a chalet's window is four of them and its roof is four of them, and
   * the roof is thirty times the area. What is being asked is how much of the
   * shape the player actually sees stands off the snow.
   */
  function clearAreaFraction(kind: PropKind, override?: number): number {
    const geometry = propGeometry(kind);
    const positions = geometry.getAttribute('position');
    const colours = geometry.getAttribute('color');
    const index = geometry.index;
    const count = index ? index.count : positions.count;

    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    const edge = new THREE.Vector3();
    const readback = new THREE.Color();
    const display = { r: 0, g: 0, b: 0 };

    let total = 0;
    let clear = 0;
    for (let i = 0; i < count; i += 3) {
      const [i0, i1, i2] = [0, 1, 2].map((o) => (index ? index.getX(i + o) : i + o)) as [
        number,
        number,
        number,
      ];
      a.fromBufferAttribute(positions, i0);
      b.fromBufferAttribute(positions, i1);
      c.fromBufferAttribute(positions, i2);
      const area = edge.subVectors(b, a).cross(c.clone().sub(a)).length() / 2;

      let value = override;
      if (value === undefined) {
        readback.setRGB(colours.getX(i0), colours.getY(i0), colours.getZ(i0));
        readback.getRGB(display, THREE.SRGBColorSpace);
        value = 0.2126 * display.r + 0.7152 * display.g + 0.0722 * display.b;
      }

      total += area;
      if (value < low || value > high) clear += area;
    }
    return total === 0 ? 0 : clear / total;
  }

  it('lands most of every built prop clear of the run', () => {
    /*
     * The end-to-end half, and the only assertion in the file that reads the
     * colours the GPU will actually receive - `assemble()` bakes them through
     * `saturate()` into a vertex attribute, so a prop palette that drifts into
     * the run's band is visible here and nowhere else.
     *
     * Half the area is the rule: a prop is legible when the majority of it reads
     * against the snow, not when one panel does. The woodpile is the binding case
     * at 0.64 - its `barkLight` sits inside the band, which is exactly what a
     * sawn log's lit face looks like and exactly why the rule is a majority
     * rather than all of it.
     */
    const buried = (Object.keys(PROP_BUILDERS) as PropKind[]).filter(
      (kind) => clearAreaFraction(kind) < 0.5,
    );
    expect(buried).toEqual([]);
  });

  it('and a prop painted the run’s own colour is what that rejects', () => {
    // The mutation. Every prop palette here is several colours, so "some of it
    // clears" is easy; the thing that must fail is a prop whose whole surface
    // carries the value of the snow it stands on, which is the defect the drift
    // and the boulder both had.
    const midRun = (low + high) / 2;
    for (const kind of Object.keys(PROP_BUILDERS) as PropKind[]) {
      expect(clearAreaFraction(kind, midRun)).toBe(0);
    }
  });
});

/* ------------------------------------------------------------------ *
 * The cadence in the lane grooves.
 * ------------------------------------------------------------------ */

/**
 * Fraction of a repeat the cadence spends on its strong half, reconstructed from
 * a vertex grid rather than from the analytic function.
 *
 * That distinction is the whole point of measuring it. The waveform is baked
 * into vertex colours and drawn by linear interpolation between rows, so what
 * reaches the screen is the *sampled* trapezoid, and its duty can differ from
 * the authored one by up to a whole station if the grid is too coarse to place
 * the corners.
 */
function sampledDuty(step: number): number {
  let faint = 0;
  let span = 0;

  // Anchored where the surface is anchored, since the phase of the grid against
  // the waveform is exactly what is being measured.
  for (let i = 0; i < 240; i++) {
    const z0 = GROUND_NEAR_Z - step * i;
    const z1 = z0 - step;
    const v0 = guideCadenceAt(z0);
    const v1 = guideCadenceAt(z1);
    span += step;

    if (v0 > 0.5 && v1 > 0.5) faint += step;
    else if (v0 > 0.5 || v1 > 0.5) {
      const t = (0.5 - v0) / (v1 - v0);
      faint += step * (v0 > 0.5 ? t : 1 - t);
    }
  }

  return 1 - faint / span;
}

describe('the lane grooves tick instead of running continuous', () => {
  const centre = laneBoundaries()[0]!;

  it('repeats exactly on the scroll period, so the wrap cannot be seen', () => {
    // The same closure the bands need, and it is not automatic: 9.5 was chosen
    // to divide 114 twelve times. A spacing that did not would put a jump in the
    // rhythm every three to five seconds for the whole run.
    expect(GROUND_PERIOD % PISTE_CADENCE.spacing).toBe(0);
    for (let z = -200; z < 200; z += 0.37) {
      expect(guideCadenceAt(z)).toBeCloseTo(guideCadenceAt(z + GROUND_PERIOD), 9);
    }
  });

  it('swings the guide by a value that can be seen from the middle of the frame', () => {
    let low = 1;
    let high = 0;
    for (let z = 0; z < GROUND_PERIOD; z += 0.05) {
      const value = toneLuma(laneGuideTone(centre, z));
      low = Math.min(low, value);
      high = Math.max(high, value);
    }
    // About a tenth of the display range, on the one feature that runs the whole
    // length of the fall line. Less than this and it is a gradient nobody reads
    // as a rhythm.
    expect(high - low).toBeGreaterThan(0.08);
  });

  it('but never lets the line stop being a line', () => {
    /*
     * The counterweight, and it is a gameplay constraint rather than an
     * aesthetic one. The guides are what tell the player where the lanes are; a
     * guide broken into segments is a guide that stops existing at intervals,
     * and a gap in a line somebody is steering by will eventually be read as
     * meaning something. So the faint phase is a fade, never a break.
     */
    let worst = 1;
    for (let z = 0; z < GROUND_PERIOD; z += 0.05) {
      for (const boundary of laneBoundaries()) {
        worst = Math.min(
          worst,
          toneLuma(pisteTone(boundary, z)) - toneLuma(laneGuideTone(boundary, z)),
        );
      }
    }
    expect(worst).toBeGreaterThan(0.04);
  });

  it('and a guide that faded all the way to the snow is what that rejects', () => {
    // The mutation: `PISTE_CADENCE.contrast` at 1 rather than 0.55, which is the
    // obvious "make the cadence stronger" edit and erases the lane markings for
    // a third of every repeat.
    // Luminance is linear in the channels, so the groove core's own value is
    // just the guide tone's, scaled - no need to rebuild the tone to model it.
    const core = 0.8 * toneLuma(tone(TRACK_COLORS.laneGuide));

    let worst = 1;
    for (let z = 0; z < GROUND_PERIOD; z += 0.05) {
      const gap = guideCadenceAt(z);
      const piste = toneLuma(pisteTone(centre, z));
      worst = Math.min(worst, piste - (core + gap * (piste - core)));
    }
    expect(worst).toBeLessThan(0.001);
  });

  it('is sampled finely enough to draw the duty it was authored with', () => {
    /*
     * The waveform is drawn by interpolating between vertex rows, so the grid is
     * not an implementation detail - it is the reconstruction filter. Eight rows
     * a repeat puts the half-amplitude crossings within 1% of
     * `PISTE_CADENCE.duty`.
     */
    expect(PISTE_CADENCE.spacing % GUIDE_CORE_Z_STATION).toBeCloseTo(0, 9);
    expect(sampledDuty(GUIDE_CORE_Z_STATION)).toBeCloseTo(PISTE_CADENCE.duty, 2);
  });

  it('and four rows a repeat is what that rejects', () => {
    // The mutation, and it is the edit somebody will make: halving the station
    // saves 2,300 vertices and looks free in a diff. It cannot place a corner
    // between two rows, so the crossings snap to grid midpoints and the gap
    // comes out most of a metre wide of what it was authored to be.
    expect(Math.abs(sampledDuty(PISTE_CADENCE.spacing / 4) - PISTE_CADENCE.duty)).toBeGreaterThan(
      0.02,
    );
  });

  it('puts the rhythm in the play space rather than at the frame edges', () => {
    /*
     * The measured complaint, restated exactly: the *only* repeating
     * longitudinal features in the frame were the fence posts at 5.1 and the
     * marker poles at `MARKERS.x`, both at the extreme left and right - so to
     * feel speed the player had to look away from the gameplay, towards the
     * highest-contrast edges in the image at that.
     *
     * The grooves run at the lane boundaries, which is where the eye already is:
     * inside the outermost lane the player ever occupies, not outside it. Pinned
     * here because widening `LANES` would quietly move the cadence back out
     * towards the edges it was brought in from.
     */
    const outermostGroove = Math.max(...laneBoundaries().map(Math.abs));
    expect(outermostGroove).toBeLessThan(Math.max(...LANES.map(Math.abs)));
    expect(outermostGroove).toBeLessThan(MARKERS.x);
  });

  it('ticks often enough to be a rhythm and rarely enough not to be a flicker', () => {
    /*
     * The cadence is fixed in *track space*, so its rate is the speed divided by
     * the spacing and it doubles as the run does - which is the whole point, and
     * the reason it is authored in metres rather than seconds.
     *
     * The floor is that a rhythm has to repeat inside the time anyone would call
     * a rhythm: 2.2 a second at the opening speed and 3.8 at the top.
     */
    const atStart = TUNING.speed.start / PISTE_CADENCE.spacing;
    const atTop = TUNING.speed.max / PISTE_CADENCE.spacing;
    expect(atStart).toBeGreaterThan(2);
    expect(atTop).toBeGreaterThan(3.5);

    /*
     * And the ceiling, which is the counterweight and is not the aliasing floor
     * below - this is about the frame having *two* rhythms rather than one. The
     * near-field poles already flick past at up to 10 a second; a cadence
     * approaching that rate would beat against them and read as a rendering
     * artefact rather than as ground going by. Held under half their rate.
     */
    expect(atTop).toBeLessThan(TUNING.speed.max / MARKERS.spacing / 2);
  });

  it('keeps both halves of the repeat clear of the temporal aliasing floor', () => {
    // The same 1.5 m bound the bands are held to: the ground advances 0.6 m in a
    // 60 Hz frame at top speed, and a feature shorter than that strobes or runs
    // backwards. The gap is the shorter of the two halves.
    expect(PISTE_CADENCE.spacing * (1 - PISTE_CADENCE.duty)).toBeGreaterThan(1.5);
    expect(PISTE_CADENCE.spacing * PISTE_CADENCE.duty).toBeGreaterThan(1.5);
  });

  it('lays the groove core on the grid the cadence needs', () => {
    /*
     * The end-to-end check: the tone function can be as finely shaped as it
     * likes and none of it reaches the screen unless the geometry samples it
     * there. Every vertex at the guide height, lips included, has to sit on the
     * cadence grid - the lips are drawn at a sixteenth of the density, which is
     * only safe because 19 is a whole number of stations.
     */
    const { geometry } = buildGroundSurface();
    const positions = geometry.getAttribute('position');

    const rows = new Set<number>();
    for (let i = 0; i < positions.count; i++) {
      if (Math.abs(positions.getY(i) - LANE_GUIDE_Y) > 1e-6) continue;
      rows.add(positions.getZ(i));
    }

    expect(rows.size).toBe((GROUND_NEAR_Z - GROUND_FAR_Z) / GUIDE_CORE_Z_STATION + 1);
    for (const z of rows) {
      // Exact, not approximate: the station is a dyadic fraction precisely so
      // that a Float32 row and the grid it came from agree bit for bit. A
      // spacing like 1.9 divides both periods and fails here.
      expect((GROUND_NEAR_Z - z) % GUIDE_CORE_Z_STATION).toBe(0);
    }
  });
});

/* ------------------------------------------------------------------ *
 * The merged geometry.
 * ------------------------------------------------------------------ */

describe('the merged snow surface', () => {
  const { geometry } = buildGroundSurface();
  const positions = geometry.getAttribute('position');
  const normals = geometry.getAttribute('normal');
  const colours = geometry.getAttribute('color');

  const readback = new THREE.Color();
  const display = { r: 0, g: 0, b: 0 };

  /** Display-space luminance of a vertex, undoing the sRGB encode. */
  function vertexLuma(i: number): number {
    readback.setRGB(colours.getX(i), colours.getY(i), colours.getZ(i));
    readback.getRGB(display, THREE.SRGBColorSpace);
    return 0.2126 * display.r + 0.7152 * display.g + 0.0722 * display.b;
  }

  it('is one draw call - no groups, one material', () => {
    // The whole point of the merge. `mergeGeometries` with `useGroups` would
    // produce a geometry that still costs one call per group, which would look
    // identical and save nothing.
    expect(geometry.groups.length).toBe(0);
    expect(colours).toBeDefined();
    expect(geometry.index).toBeNull();
  });

  it('stays cheap enough to be worth merging', () => {
    // A merged surface can be given arbitrary detail for free in draw calls and
    // not for free in anything else. Fourteen thousand vertices is a fifth of a
    // millisecond of vertex work and about 600 kB resident.
    expect(positions.count).toBeLessThan(20000);
    expect(positions.count).toBeGreaterThan(2000);
  });

  it('faces the sky', () => {
    // The obvious corner ordering for a quad on the XZ plane faces the ground,
    // and a back-facing slope is invisible rather than obviously wrong - it
    // would look exactly like the sky bleeding through.
    for (let i = 0; i < normals.count; i++) {
      expect(normals.getY(i)).toBe(1);
    }
  });

  it('stays under the carve trail', () => {
    /*
     * The one ordering that crosses a package boundary. `TRAIL.y` is documented
     * as sitting "above the lane guides at 0.012", so the grooves may not drift
     * up: at grazing angles two hundred metres down the track, a millimetre of
     * the wrong sign is a trail that flickers in and out of the snow.
     */
    let highest = -Infinity;
    for (let i = 0; i < positions.count; i++) highest = Math.max(highest, positions.getY(i));
    // Read back out of a Float32 attribute, so compared to a tolerance finer
    // than the millimetre the ordering turns on rather than for equality.
    expect(highest).toBeCloseTo(LANE_GUIDE_Y, 6);
    expect(highest).toBeLessThan(TRAIL.y);
  });

  it('keeps a hard edge at the piste boundary', () => {
    /*
     * The field and the run abut rather than overlap - the old pair were two
     * full-width planes stacked 4 mm apart, so every pixel of the run was
     * shaded twice. Abutting only works if the two strips carry different
     * colours at coincident vertices; if a future edit blends them, the piste
     * edge softens into a gradient and the player loses the only cue for how
     * much track there is.
     */
    let low = 1;
    let high = 0;
    let seen = 0;
    for (let i = 0; i < positions.count; i++) {
      // Float32 storage: 4.6 comes back as 4.599999904632568, so the boundary
      // is matched to a tenth of a millimetre rather than exactly.
      if (Math.abs(positions.getX(i) + PISTE_HALF_WIDTH) > 1e-4) continue;
      if (positions.getY(i) !== 0) continue;
      seen++;
      const value = vertexLuma(i);
      low = Math.min(low, value);
      high = Math.max(high, value);
    }

    expect(seen).toBeGreaterThan(100);
    expect(high - low).toBeGreaterThan(0.15);
  });

  it('carries the groove core and its lips at the same height', () => {
    // A groove that is only a dark stripe is a skid mark. The lips either side
    // are what make it read as displaced material, and they have to sit in the
    // same plane as the core or they self-shadow at a grazing angle.
    let darkest = 1;
    let brightest = 0;
    for (let i = 0; i < positions.count; i++) {
      if (Math.abs(positions.getY(i) - LANE_GUIDE_Y) > 1e-6) continue;
      const value = vertexLuma(i);
      darkest = Math.min(darkest, value);
      brightest = Math.max(brightest, value);
    }

    expect(darkest).toBeLessThan(0.5);
    expect(brightest).toBeGreaterThan(0.7);
  });
});

/* ------------------------------------------------------------------ *
 * The scroll.
 * ------------------------------------------------------------------ */

describe('the surface scrolls without showing its seams', () => {
  const { geometry } = buildGroundSurface();
  const positions = geometry.getAttribute('position');

  it('covers the whole visible band at every scroll offset', () => {
    /*
     * The mesh slides from 0 to `GROUND_PERIOD` and back, so the far edge is at
     * its nearest when the offset is largest. That is the case that has to
     * still reach past the spawn line - miss it and the world ends in a hard
     * horizon a few metres in front of where obstacles appear.
     */
    expect(GROUND_FAR_Z + GROUND_PERIOD).toBeLessThan(SPAWN_Z);
    expect(GROUND_NEAR_Z).toBeGreaterThan(RECYCLE_Z);

    // The mutation: the plane this replaced ran from -230 to +40, which is
    // 20 m short of the spawn line once the scroll is added.
    expect(-230 + GROUND_PERIOD).toBeGreaterThan(SPAWN_Z);
  });

  it('lays its vertex rows on a grid that repeats with the period', () => {
    /*
     * The subtle half of the wrap. A periodic *colour function* is not enough:
     * the colours are sampled at vertices and interpolated between them, so
     * the interpolated field only repeats if the sample rows repeat too. With
     * a station spacing that does not divide `GROUND_PERIOD`, the whole surface
     * shifts by a fraction of a row every wrap and the bands jitter.
     */
    expect(GROUND_PERIOD % GROUND_Z_STATION).toBe(0);

    const rows = new Set<number>();
    for (let i = 0; i < positions.count; i++) rows.add(positions.getZ(i));

    let checked = 0;
    for (const z of rows) {
      if (z + GROUND_PERIOD > GROUND_NEAR_Z) continue;
      expect(rows.has(z + GROUND_PERIOD)).toBe(true);
      checked++;
    }
    expect(checked).toBeGreaterThan(100);
  });

  it('and a spacing that does not divide the period breaks that', () => {
    // The mutation, on the same closure property. 2.5 m looks every bit as
    // reasonable as 2 m and silently costs the guarantee above.
    const span = GROUND_NEAR_Z - GROUND_FAR_Z;
    const spans = Math.round(span / 2.5);
    const rows = new Set<number>();
    for (let i = 0; i <= spans; i++) rows.add(GROUND_FAR_Z + (span * i) / spans);

    const closed = [...rows].every(
      (z) => z + GROUND_PERIOD > GROUND_NEAR_Z || rows.has(z + GROUND_PERIOD),
    );
    expect(closed).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * The groomed-run albedo.
 * ------------------------------------------------------------------ */

/**
 * Fraction of a track-wise profile's energy sitting above a cutoff wavelength.
 *
 * Measured spectrally rather than by extremum spacing, and the reason is
 * specific to this pattern rather than a preference. The vertex band profile is
 * one sum of sinusoids and its turning points are all real features; the albedo
 * is *two* signals added - longitudinal lines read along a drifting axis, plus a
 * transverse drift - and wherever their slopes nearly cancel the sum acquires
 * turning points a few millimetres apart with a swing of zero. Counting those
 * measures floating-point noise. Energy above the cutoff measures the thing the
 * guarantee is actually about: how much of what the eye sees is moving too fast
 * to be sampled by a 60 Hz frame.
 */
function fineEnergyFraction(sample: (z: number) => number, cutoff: number): number {
  const n = 1024;
  const values: number[] = [];
  for (let i = 0; i < n; i++) values.push(sample((ALBEDO_TILE_Z * i) / n));
  const mean = values.reduce((a, b) => a + b, 0) / n;

  let total = 0;
  let fine = 0;
  for (let k = 1; k < n / 2; k++) {
    let re = 0;
    let im = 0;
    for (let i = 0; i < n; i++) {
      const angle = (-2 * Math.PI * k * i) / n;
      re += (values[i]! - mean) * Math.cos(angle);
      im += (values[i]! - mean) * Math.sin(angle);
    }
    const power = re * re + im * im;
    total += power;
    if (ALBEDO_TILE_Z / k < cutoff) fine += power;
  }
  return total === 0 ? 0 : fine / total;
}

describe('the snow albedo', () => {
  it('puts no meaningful transverse energy where a frame could alias it', () => {
    /*
     * The same 1.5 m floor the vertex bands are held to, and a texture does not
     * escape it: mipmapping fixes spatial aliasing and does nothing at all for
     * the temporal kind, so a 30 cm feature crossing the track still strobes at
     * 0.6 m of ground per frame. What makes the map legitimate is that its fine
     * detail runs *down* the fall line, where the scroll cannot change it - the
     * only transverse content is a slow cross-slope drift, and it must stay
     * that way.
     *
     * Under a thousandth of the profile's energy is above the floor. The
     * threshold is set at half a percent, an order of magnitude clear either
     * side, so tightening the corduroy later has room before it fails.
     */
    for (let x = -4.6; x <= 4.6; x += 0.46) {
      expect(fineEnergyFraction((z) => snowAlbedoAt(x, z), 1.5)).toBeLessThan(0.005);
    }
  });

  it('and a 40 cm ripple across the track is what that rejects', () => {
    // The mutation, kept rather than run once by hand: a small transverse
    // component of exactly the kind a "bit more surface detail" edit would add.
    // 1.5% of the swing, which is barely visible standing still and is the
    // whole defect in motion.
    const strobing = (z: number): number =>
      snowAlbedoAt(1.1, z) + 0.015 * Math.sin((2 * Math.PI * z) / 0.4);
    expect(fineEnergyFraction(strobing, 1.5)).toBeGreaterThan(0.005);
  });

  it('carries detail far finer than the geometry under it could', () => {
    /*
     * The counterweight, and the one that matters: "no fast transverse content"
     * is perfectly satisfied by a flat white map, which is the smooth gradient
     * this exists to break up. The whole point of paying for a texture is the
     * detail a vertex grid cannot afford - the surface mesh has a vertex every
     * 1.5 m across the run, so anything under that has to come from here.
     *
     * Sixty turning points across 9.2 m is a feature every 15 cm, which is
     * corduroy at the pitch a winch cat actually leaves.
     */
    let extrema = 0;
    let previous = snowAlbedoAt(-4.6 + 0.005, 3) - snowAlbedoAt(-4.6, 3);
    for (let x = -4.6; x < 4.6; x += 0.005) {
      const slope = snowAlbedoAt(x + 0.005, 3) - snowAlbedoAt(x, 3);
      if (slope !== 0 && Math.sign(slope) !== Math.sign(previous)) extrema++;
      if (slope !== 0) previous = slope;
    }
    expect(extrema).toBeGreaterThan(40);
  });

  it('spends a real value range without dragging the run into the dark', () => {
    let low = 1;
    let high = 0;
    let sum = 0;
    let samples = 0;
    for (let z = 0; z < ALBEDO_TILE_Z; z += 0.19) {
      for (let x = -4.6; x <= 4.6; x += 0.05) {
        const value = snowAlbedoAt(x, z);
        low = Math.min(low, value);
        high = Math.max(high, value);
        sum += value;
        samples++;
      }
    }

    expect(samples).toBeGreaterThan(30000);
    // A third of a stop of swing on the largest surface in the frame. In
    // display terms - the eye reads roughly the 1/2.2 power - that is 0.81 to
    // 1.0, a fifth of the range, which is what the map is for.
    expect(high - low).toBeGreaterThan(0.3);
    expect(low).toBeGreaterThanOrEqual(ALBEDO_FLOOR);
    expect(high).toBeLessThanOrEqual(1);
    /*
     * And the counterweight to the swing. An eight-bit map cannot exceed one,
     * so its mean is below one by construction and everything it touches gets
     * darker - which is the right direction for the run and would be the wrong
     * one anywhere else. Held near 0.8 linear, an 8% darkening in display: past
     * about 0.75 the run stops being a mid-tone and starts competing with the
     * obstacles that have to read against it.
     */
    expect(sum / samples).toBeGreaterThan(0.75);
    expect(sum / samples).toBeLessThan(0.86);
  });

  it('repeats on a tile that divides the scroll period exactly', () => {
    /*
     * The surface mesh snaps back a whole `GROUND_PERIOD` at a time and the UVs
     * come from the vertex's own Z, so the texture snaps with it. The snap is
     * invisible only if the tile divides that period - otherwise the map lands
     * in a new phase after every wrap and a seam crosses the slope every three
     * to five seconds, on the biggest thing in the frame.
     */
    expect(GROUND_PERIOD % ALBEDO_TILE_Z).toBe(0);
    for (let z = -100; z < 100; z += 0.31) {
      expect(snowAlbedoAt(1.1, z)).toBeCloseTo(snowAlbedoAt(1.1, z + ALBEDO_TILE_Z), 9);
      expect(snowAlbedoAt(-3.7, z)).toBeCloseTo(snowAlbedoAt(-3.7, z + ALBEDO_TILE_Z), 9);
    }
  });

  it('agrees with the geometry about how wide the run is', () => {
    // Declared in both files so the dependency runs one way, which means
    // nothing but this catches them drifting apart - and the failure would be
    // a stretched corduroy, which looks deliberate.
    expect(ALBEDO_RUN_WIDTH).toBeCloseTo(2 * PISTE_HALF_WIDTH, 9);
  });

  it('is rasterised faithfully enough to be worth tabulating', () => {
    /*
     * The rasteriser reads two lookup tables where `snowAlbedoAt` evaluates ten
     * sinusoids, because half a million texels of the honest version is a
     * second of dead startup on a phone. That is only a fair trade if the fast
     * path is indistinguishable, so the two are held to within one count of
     * eight bits - which is the quantisation itself, not a tolerance.
     *
     * Sampled through `albedoRunUv`, so this covers the mapping as well as the
     * pattern: a texel-centre convention that disagreed between the two would
     * shift the whole map half a texel and show up nowhere else.
     */
    const pixels = rasteriseSnowAlbedo();
    const runColumns = ALBEDO_WIDTH - 2;
    let worst = 0;
    let checked = 0;

    for (let row = 0; row < ALBEDO_HEIGHT; row += 7) {
      const z = ((row + 0.5) * ALBEDO_TILE_Z) / ALBEDO_HEIGHT;
      for (let column = 0; column < runColumns; column += 3) {
        // The inverse of `albedoRunUv`, worked out here rather than exported:
        // the world point a texel *centre* stands for. Sampling anywhere else
        // would compare the pattern against a neighbouring texel and measure
        // the corduroy's slope rather than the table's error.
        const x = (column / (runColumns - 1) - 0.5) * ALBEDO_RUN_WIDTH;

        // The round trip, which is the half of this that catches a convention
        // drifting: the point that texel stands for must map back into it.
        const { u, v } = albedoRunUv(x, z);
        expect(u * ALBEDO_WIDTH - (column + 0.5)).toBeCloseTo(0, 6);
        expect(v * ALBEDO_HEIGHT - (row + 0.5)).toBeCloseTo(0, 6);

        const byte = pixels[(row * ALBEDO_WIDTH + column) * 4]!;
        const encoded = 1.055 * Math.pow(snowAlbedoAt(x, z), 1 / 2.4) - 0.055;
        worst = Math.max(worst, Math.abs(byte - Math.round(255 * encoded)));
        checked++;
      }
    }

    expect(checked).toBeGreaterThan(20000);
    expect(worst).toBeLessThanOrEqual(1);
  });

  it('reserves a white margin that everything off the run reads', () => {
    /*
     * The surface is one merged geometry with one material, so the field cannot
     * simply be given a different map. It is given a different *corner*: two
     * columns held at pure white, sampled at a constant UV whose screen-space
     * derivative is zero, which pins it to mip 0 and makes the white a property
     * of the mapping rather than of the filtering.
     */
    const pixels = rasteriseSnowAlbedo();
    const { u, v } = albedoFieldUv();
    expect(v).toBe(0);

    // Every row of the reserve, not a sample: a single stray texel would show
    // up as a line down the open snow the length of the track.
    for (let row = 0; row < ALBEDO_HEIGHT; row++) {
      for (let column = ALBEDO_WIDTH - 2; column < ALBEDO_WIDTH; column++) {
        expect(pixels[(row * ALBEDO_WIDTH + column) * 4]).toBe(255);
      }
    }

    // And the tap really lands in it, at both ends of the filtering: `u` is
    // clamped rather than wrapped, so 1 addresses the final texel.
    expect(Math.min(ALBEDO_WIDTH - 1, Math.floor(u * ALBEDO_WIDTH))).toBe(ALBEDO_WIDTH - 1);
  });

  it('keeps the run clear of the reserve at both edges', () => {
    // The failure this guards is a bright fringe down the outer lane: map the
    // run edge-to-edge instead of centre-to-centre and the far edge lands
    // exactly on the reserve boundary, where a bilinear tap averages half a
    // texel of white into the snow.
    for (const x of [-PISTE_HALF_WIDTH, PISTE_HALF_WIDTH]) {
      const column = Math.floor(albedoRunUv(x, 7).u * ALBEDO_WIDTH);
      expect(column).toBeGreaterThanOrEqual(0);
      expect(column).toBeLessThanOrEqual(ALBEDO_WIDTH - 3);
    }
  });
});

describe('the surface reads the albedo only where it is groomed', () => {
  const { geometry } = buildGroundSurface();
  const positions = geometry.getAttribute('position');
  const uvs = geometry.getAttribute('uv');
  const field = albedoFieldUv();

  function isField(i: number): boolean {
    return uvs.getX(i) === field.u && uvs.getY(i) === field.v;
  }

  it('gives every vertex off the run the white reserve', () => {
    /*
     * The corduroy is a groomer's signature and the field either side has never
     * been groomed, so a map that reached it would be wrong in a way that is
     * hard to unsee. It is also the surface carrying the bright end of the
     * frame's histogram, and the map can only darken.
     */
    let counted = 0;
    for (let i = 0; i < positions.count; i++) {
      if (Math.abs(positions.getX(i)) <= PISTE_HALF_WIDTH + 1e-4) continue;
      expect(isField(i)).toBe(true);
      counted++;
    }
    expect(counted).toBeGreaterThan(1000);
  });

  it('and gives every vertex on it the map', () => {
    // The counterweight: "no corduroy off the run" is trivially satisfied by no
    // corduroy anywhere, which is the flat gradient this package is replacing.
    let counted = 0;
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i);
      if (Math.abs(x) > PISTE_HALF_WIDTH - 1e-4) continue;
      expect(isField(i)).toBe(false);
      expect(uvs.getX(i)).toBeCloseTo(albedoRunUv(x, positions.getZ(i)).u, 5);
      counted++;
    }
    expect(counted).toBeGreaterThan(1000);
  });

  it('and a UV derived from X alone is what that rejects', () => {
    // The mutation, and it is the obvious simplification: one expression for
    // the whole surface instead of a choice per strip. It corduroys the open
    // snow out to a hundred and fifty metres.
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i);
      if (Math.abs(x) <= PISTE_HALF_WIDTH + 1e-4) continue;
      expect(albedoRunUv(x, positions.getZ(i)).u).not.toBe(field.u);
    }
  });
});

/* ------------------------------------------------------------------ *
 * The treeline.
 * ------------------------------------------------------------------ */

/** Spearman's rank correlation - monotone rather than linear, which is what
 *  "further out means bigger" actually claims. */
function spearman(a: readonly number[], b: readonly number[]): number {
  const rank = (values: readonly number[]): number[] => {
    const order = values.map((value, index) => [value, index] as const).sort((x, y) => x[0] - y[0]);
    const ranks = new Array<number>(values.length);
    order.forEach(([, index], position) => {
      ranks[index] = position;
    });
    return ranks;
  };

  const ra = rank(a);
  const rb = rank(b);
  const n = a.length;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += (ra[i]! - rb[i]!) ** 2;
  return 1 - (6 * sum) / (n * (n * n - 1));
}

describe('the treeline is a wood rather than a pattern', () => {
  const COUNT = 48;
  const layout = pineLayout(COUNT);

  it('lays out the whole treeline deterministically', () => {
    // Sample size stated, because every rate below is meaningless without it -
    // and the layout is rebuilt on every mount, so two builds disagreeing would
    // move the scenery between runs.
    expect(layout.length).toBe(COUNT);
    expect(pineLayout(COUNT)).toEqual(layout);
  });

  it('grows the trees with their distance from the run', () => {
    /*
     * The only thing in the visual pass that puts vertical mass in the
     * mid-ground. At a flat roll the far treeline topped out around 6 m and
     * read as a smudge at 50 m; correlating size with distance turns it into a
     * wooded flank rising away from the piste.
     */
    const correlation = spearman(
      layout.map((pine) => Math.abs(pine.x)),
      layout.map((pine) => pine.scale),
    );
    expect(correlation).toBeGreaterThan(0.5);
  });

  it('and a free roll is what that threshold rejects', () => {
    // The mutation: the rule this replaced drew scale from `rng.range(0.75,
    // 1.35)` with no reference to X at all.
    const free = layout.map((_, i) => 0.75 + ((i * 0.618033) % 1) * 0.6);
    expect(Math.abs(spearman(layout.map((pine) => Math.abs(pine.x)), free))).toBeLessThan(0.4);
  });

  it('reaches a real height far out and stays modest by the fence', () => {
    /*
     * The counterweight to the correlation, which is satisfied perfectly by a
     * treeline that grows from tiny to slightly less tiny. Stated in metres of
     * tree rather than in multipliers, because the multiplier means nothing
     * without the model it is applied to.
     */
    const tallest = Math.max(...PINE_MODELS.map((spec) => spec.fitHeight ?? 0));
    const shortest = Math.min(...PINE_MODELS.map((spec) => spec.fitHeight ?? 0));

    expect(tallest * pineScaleFor(PINE_FAR_X, 1)).toBeGreaterThan(10);
    expect(shortest * pineScaleFor(PINE_NEAR_X, 0)).toBeGreaterThan(2.8);
    expect(tallest * pineScaleFor(PINE_NEAR_X, 1)).toBeLessThan(5.5);
  });

  it('never rolls a fence-adjacent tree as large as the old rule could', () => {
    /*
     * A straight win that falls out of the correlation. Scenery starts 5.5 m
     * out and the old ceiling was 1.35, which hung a canopy over the piste edge
     * at 4.6 - and nothing checked it, because `tests/models.test.ts` measures
     * the fitted model at scale 1.
     */
    expect(pineScaleFor(PINE_NEAR_X, 1)).toBeLessThan(1.35);
    for (const pine of layout) {
      expect(pine.scale).toBeLessThanOrEqual(pineScaleFor(Math.abs(pine.x), 1) + 1e-9);
    }
  });

  it('clumps the sides instead of alternating them', () => {
    /*
     * `i % 2` gave perfect bilateral symmetry at a 4.79 m pitch: the single
     * strongest procedural tell in the game, and free to remove. What replaces
     * it has to actually produce stands - a hash that merely scrambles the
     * order would score the same on "not alternating" and look identical.
     */
    const sides = layout.map((pine) => Math.sign(pine.x));

    let runs = 0;
    for (let i = 1; i < sides.length; i++) {
      if (sides[i] === sides[i - 1]) runs++;
    }
    expect(runs).toBeGreaterThanOrEqual(20);

    // And the mutation on the same measure: strict alternation scores zero.
    const alternating = layout.map((_, i) => (i % 2 === 0 ? -1 : 1));
    let alternatingRuns = 0;
    for (let i = 1; i < alternating.length; i++) {
      if (alternating[i] === alternating[i - 1]) alternatingRuns++;
    }
    expect(alternatingRuns).toBe(0);
  });

  it('still lines both sides of the run', () => {
    // The counterweight, and the failure mode clumping invites: "not
    // alternating" is trivially satisfied by putting every tree on one side,
    // which would leave one flank of the run bare for its whole length.
    const left = layout.filter((pine) => pine.x < 0).length;
    expect(Math.min(left, COUNT - left)).toBeGreaterThan(COUNT * 0.3);
  });

  it('keeps every tree off the run', () => {
    // Trees have no collider, so nothing else in the project would notice a
    // treeline that wandered onto the piste.
    for (const pine of layout) {
      expect(Math.abs(pine.x)).toBeGreaterThanOrEqual(PINE_NEAR_X);
      expect(Math.abs(pine.x)).toBeLessThanOrEqual(PINE_FAR_X);
    }
  });
});
