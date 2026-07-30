/**
 * Near-field motion.
 *
 * The package this guards exists because a still frame at 21 units per second
 * was indistinguishable from one at 12: everything in the scene converged on a
 * vanishing point and left frame eight metres ahead, so there was no rate
 * anywhere in the image. Four things now carry one - streaked flakes, a
 * foreground snow band, a plume that streams back past the lens, and marker
 * poles that sweep by - and every one of them is trivially satisfiable by
 * something that draws nothing.
 *
 * So each guarantee here comes with its counterweight. "The near band is in
 * front of the player" is satisfied by forty flakes lost in a box the size of a
 * street, so the density is asserted too. "A jump breaks the trail" is satisfied
 * by a trail that is never laid, so the grounded case is asserted alongside it.
 * "The spray collapses before the near plane" is satisfied by a collapse that
 * swallows the whole flight, so the far end is pinned as well.
 *
 * Pure logic throughout - real three.js geometry built in node, no DOM and no
 * GL context, following `tests/models.test.ts`.
 */

import { describe, expect, it } from 'vitest';
import { LANES, TUNING } from '@/game/config/tuning';
import { CHASER_SPRAY, LIGHTING, MARKERS, SPRAY, SNOW_FIELD, TRAIL } from '@/game/config/visuals';
import { lerp } from '@/game/core/math';
import {
  advanceTrail,
  buildCarveRibbon,
  buildSnowField,
  carve01,
  carveSection,
  createTrail,
  DIG_STEPS,
  lateralSpeed,
  LENS_FADE,
  markerLayout,
  mixHex,
  NEAR_FIELD,
  proximityFade,
  resetTrail,
  settleLife,
  sprayFade,
  sprayTumble,
  SUN_SIDE,
  trenchDepth01,
  wakeVelocity,
  type CarveVertex,
  type TrailRing,
} from '@/game/render/nearField';
import { TRACK_SPAN } from '@/game/render/trackLayout';
import type { LaneState } from '@/game/systems/lanes';

/**
 * The camera's near plane, declared on the `<Canvas>` in `src/app/App.tsx`.
 *
 * Repeated here rather than imported because it lives in a JSX prop, and this
 * file is the only thing in the project that puts geometry between the lens and
 * the player - the assumption its comment records ("nothing is ever closer than
 * the player") stopped being true when the near snow band landed.
 */
const CAMERA_NEAR = 0.5;

/** Channels of an authored hex, 0-255. */
function rgb(hex: string): [number, number, number] {
  return [0, 2, 4].map((i) => parseInt(hex.replace('#', '').slice(i, i + 2), 16)) as [
    number,
    number,
    number,
  ];
}

/** Rec. 709 luminance of an authored hex, on the same 0-255 scale a frame grab reports. */
function luma(hex: string): number {
  const [r, g, b] = rgb(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Crude chroma: the spread between the strongest and weakest channel. */
function chroma(hex: string): number {
  const channels = rgb(hex);
  return Math.max(...channels) - Math.min(...channels);
}

/**
 * The most chromatic anything standing in for snow may be *authored* at.
 *
 * Stated as an authored value because that is what these files hold, and the
 * measurement that set it was made on pixels: the old trench was authored
 * `#3f6f9f` - chroma 96 - and a frame grab measured it at chroma 114, so ACES
 * at `ATMOSPHERE.exposure` pushes chroma by about 1.19 down in the toe rather
 * than draining it. The lit piste, the most saturated surface the lighting
 * itself can produce, displays at chroma 60. So an authored 50 arrives at about
 * 60 and anything above it puts a decal back on top of the most colourful thing
 * the rig can light - which is how a groove in the snow came to read as a
 * stripe of paint.
 */
const MAX_SNOW_CHROMA = 50;

describe('falling snow', () => {
  const geometry = buildSnowField();
  const total = TUNING.snow.count + SNOW_FIELD.nearCount;

  it('draws every flake in both bands from one geometry', () => {
    // Four vertices and two triangles each. The whole point of the rebuild is
    // that a streak needs a quad and a quad is still one draw call.
    expect(geometry.getAttribute('position').count).toBe(total * 4);
    expect(geometry.getIndex()!.count).toBe(total * 6);
  });

  it('flags exactly the near band, and nothing else, as near', () => {
    const near = geometry.getAttribute('aNear');
    let flagged = 0;
    for (let i = 0; i < near.count; i++) flagged += near.getX(i);
    expect(flagged).toBe(SNOW_FIELD.nearCount * 4);
  });

  it('seeds every flake inside the unit box the shader scales', () => {
    // The seed is normalised so one attribute layout serves two differently
    // sized boxes. A seed outside [-0.5, 0.5] would land outside its own field
    // and then be wrapped somewhere arbitrary by the shader's `mod`.
    const position = geometry.getAttribute('position');
    for (let i = 0; i < position.count; i++) {
      expect(Math.abs(position.getX(i))).toBeLessThanOrEqual(0.5);
      expect(Math.abs(position.getY(i))).toBeLessThanOrEqual(0.5);
      expect(Math.abs(position.getZ(i))).toBeLessThanOrEqual(0.5);
    }
  });

  it('lays the field out identically on every build', () => {
    // Decorative, but seeded - the same rule the treeline follows. A field that
    // differed per build would make any visual regression unreproducible.
    expect(buildSnowField().getAttribute('position').array).toEqual(
      geometry.getAttribute('position').array,
    );
  });

  it('keeps the near band a divisor of the main field, so the scroll wrap is invisible', () => {
    /*
     * `uScroll` is reduced modulo the main field's depth on the CPU, to stop a
     * kilometres-long run quantising a 32-bit uniform into a visible judder.
     * Every flake then wraps against that already-reduced value. If the near
     * box's depth were not a divisor, the reduction would shift the foreground
     * layer by a fraction of a box once every 90 m - a jump in the one part of
     * the frame the eye is most sensitive to, appearing minutes into a run.
     */
    const remainder = TUNING.snow.fieldDepth % NEAR_FIELD.depth;
    expect(
      remainder,
      `NEAR_FIELD.depth (${NEAR_FIELD.depth}) must divide TUNING.snow.fieldDepth ` +
        `(${TUNING.snow.fieldDepth}) or the CPU-side scroll wrap teleports the near band`,
    ).toBeCloseTo(0, 6);
  });

  it('puts the near band between the player and the lens', () => {
    const farFace = NEAR_FIELD.centre[2] - NEAR_FIELD.depth / 2;
    const nearFace = NEAR_FIELD.centre[2] + NEAR_FIELD.depth / 2;

    // Reaches past the rider: a foreground that stops short of the subject is
    // not in front of anything.
    expect(farFace).toBeLessThanOrEqual(TUNING.player.z);
    // And stops short of the closest the camera ever gets, which is the wide
    // screen case where `cameraDistanceFor` bottoms out.
    expect(nearFace).toBeLessThan(TUNING.camera.minDistance);
  });

  it('fades a flake out before the near plane can slice it', () => {
    /*
     * The worst case is the whole band at once: camera pulled all the way in to
     * `minDistance`, flake sitting on the band's near face. If that gap is not
     * already inside the fade's lower stop, a flake covering a third of the
     * screen gets cut in half by a straight line.
     */
    const nearFace = NEAR_FIELD.centre[2] + NEAR_FIELD.depth / 2;
    const worstGap = TUNING.camera.minDistance - nearFace;
    expect(worstGap).toBeLessThanOrEqual(LENS_FADE[0]);
    // And the fade must finish outside the near plane, not at it.
    expect(LENS_FADE[0]).toBeGreaterThanOrEqual(CAMERA_NEAR);
  });

  it('actually concentrates the near band, rather than sprinkling it', () => {
    /*
     * The counterweight. "There is a foreground layer" is satisfied by forty
     * flakes spread through the 87,000 cubic metres the main field occupies,
     * where they would be invisible - the whole effect is that the near band is
     * *dense* over a few metres.
     */
    const mainVolume = TUNING.snow.fieldWidth * TUNING.snow.fieldHeight * TUNING.snow.fieldDepth;
    const nearVolume = NEAR_FIELD.width * NEAR_FIELD.height * NEAR_FIELD.depth;

    const mainDensity = TUNING.snow.count / mainVolume;
    const nearDensity = SNOW_FIELD.nearCount / nearVolume;
    expect(nearDensity / mainDensity).toBeGreaterThan(5);
  });

  it('scrolls the air at the full ground speed', () => {
    // The flakes are in still air, so relative to a rider going down the hill
    // they recede exactly as fast as the ground does. Anything under 1 puts the
    // snow on a different treadmill from the world it is falling through.
    expect(SNOW_FIELD.scrollFraction).toBe(1);
  });
});

describe('board spray', () => {
  it('abandons a particle to the wake, so it falls behind the rider', () => {
    /*
     * The bug this file was written around. At the old wake of 0.35 a particle
     * that had left the board kept 65% of the world's forward speed, which is
     * snow travelling downhill through the snow at over twenty units a second:
     * it outran the camera and no rooster tail could ever form. Once the drift
     * has decayed the particle is inert, so its residual speed *through the
     * ground* has to be zero.
     */
    const residual = TUNING.speed.max - wakeVelocity(0, TUNING.speed.max, 0);
    expect(residual, 'snow that has left the board must not travel forward through it').toBeCloseTo(
      0,
      6,
    );
  });

  it('lets it leave the board with the rider, not ripped backwards', () => {
    // The other half, and the reason for the drift at all: at birth the snow is
    // still moving with the rider, so it leaves the board rather than being
    // snatched away from it on the frame it is emitted.
    expect(wakeVelocity(0, TUNING.speed.max, 1)).toBe(0);
    // And the hand-off is monotone in between.
    let previous = -Infinity;
    for (let i = 10; i >= 0; i--) {
      const value = wakeVelocity(0, TUNING.speed.max, i / 10);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
  });

  it('collapses a sprite to nothing before it reaches the near plane', () => {
    // Zero at the plane itself, and everywhere inside it - a sprite clipped in
    // half by the near plane is a hard straight edge through a snowflake.
    expect(proximityFade(CAMERA_NEAR, CAMERA_NEAR)).toBe(0);
    expect(proximityFade(0, CAMERA_NEAR)).toBe(0);
    expect(proximityFade(-3, CAMERA_NEAR)).toBe(0);
  });

  it('confines the collapse to the last stretch, not the whole flight', () => {
    /*
     * The counterweight. "It vanishes before the near plane" is satisfied
     * perfectly by a sprite that is never drawn at all, which would delete the
     * plume this package exists to create. Full size has to be reached by the
     * authored collapse distance, and it must not start collapsing before it.
     */
    expect(proximityFade(SPRAY.nearCollapse, CAMERA_NEAR)).toBe(1);
    expect(proximityFade(SPRAY.nearCollapse * 4, CAMERA_NEAR)).toBe(1);
    expect(proximityFade(SPRAY.nearCollapse * 0.5, CAMERA_NEAR)).toBeLessThan(1);
  });

  it('ramps monotonically across the collapse', () => {
    let previous = -1;
    for (let i = 0; i <= 100; i++) {
      const value = proximityFade((i / 100) * (SPRAY.nearCollapse + 1), CAMERA_NEAR);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
  });

  it('keeps both emitters inside one pool', () => {
    /*
     * The patrol's rooster tail is a second source into these particles, which
     * is the only reason it costs no draw call. Worst case is a slide (2.6x)
     * at top speed with a full carve running flat out while the patrol is on
     * the player's shoulder; sustained population is rate times lifetime.
     */
    const boardRate = 26 * 1 * (1 + 1.2) * 2.6;
    const sustained = (boardRate + CHASER_SPRAY.rateAtFullPressure) * SPRAY.life;
    expect(sustained).toBeLessThan(SPRAY.count);
  });
});

describe('snow that has landed', () => {
  /**
   * The longest life `claim` can roll. The settle has to hold for the whole
   * range, and the worst case for a flake lying about is the longest-lived one.
   */
  const LONGEST = SPRAY.life * 1.2;

  it('never extends a life', () => {
    // The landing branch fires with whatever life the flake had left, including
    // a flake about to expire anyway. Written as an assignment rather than a
    // minimum it would *lengthen* those - and the whole complaint was flakes
    // lying on the piste for longer than they should.
    for (let i = 0; i <= 40; i++) {
      const life = (i / 40) * LONGEST;
      expect(settleLife(life), 'touching down must not lengthen a flake').toBeLessThanOrEqual(life);
    }
  });

  it('lets a resting flake die instead of pinning it there', () => {
    /*
     * The integrator's floor re-fires on every frame a flake spends on the
     * snow: gravity pulls it back through and `y` is clamped again. So the cut
     * has to be safe to apply repeatedly - written as an assignment it would
     * rewrite the life to `settleSeconds` every frame and the flake would be
     * immortal, a stationary shard on the piste, which is the exact defect
     * being fixed arriving out of the fix.
     */
    const dt = 1 / 60;
    let life = LONGEST;
    let elapsed = 0;
    while (life > 0 && elapsed < 5) {
      life = settleLife(life - dt);
      elapsed += dt;
    }
    expect(life, 'a settled flake must reach the end of its life').toBeLessThanOrEqual(0);
    expect(elapsed).toBeLessThanOrEqual(SPRAY.settleSeconds + dt * 2);
  });

  it('hands the collapse over without a jump in drawn size', () => {
    /*
     * Cutting the life alone would be enough to stop a flake lingering, and it
     * would look worse: the drawn scale is a fraction of `SPRAY.life`, so a
     * flake landing with half a second in hand would shrink to a quarter of its
     * size between one frame and the next. The banked arrival life is what makes
     * the hand-off continuous, and it has to hold at both ends of the range -
     * the ground sheet is emitted at 5 cm and lands almost at once, so a flake
     * arriving with a twentieth of a second left is the common case rather than
     * the corner.
     */
    for (let i = 1; i <= 40; i++) {
      const life = (i / 40) * LONGEST;
      expect(
        sprayFade(settleLife(life), life),
        'the settle must start from the size the flake was drawn at',
      ).toBeCloseTo(sprayFade(life, 0), 6);
    }
  });

  it('collapses to nothing over what is left of the life, and monotonically', () => {
    // Both cases: a flake with more life left than the settle window, whose life
    // is cut, and one with less, whose is not.
    for (const arrival of [LONGEST, SPRAY.settleSeconds / 4]) {
      const remaining = settleLife(arrival);
      const landed = sprayFade(remaining, arrival);
      expect(landed).toBeGreaterThan(0);
      expect(sprayFade(0, arrival)).toBe(0);

      let previous = -1;
      for (let i = 0; i <= 100; i++) {
        const value = sprayFade((i / 100) * remaining, arrival);
        expect(value).toBeGreaterThanOrEqual(previous);
        previous = value;
      }
      expect(previous).toBeCloseTo(landed, 6);
      // And it is gone within the settle window however it arrived, which is
      // the whole point: no flake outlives `settleSeconds` on the snow.
      expect(remaining).toBeLessThanOrEqual(SPRAY.settleSeconds);
    }
  });

  it('does not snap a flake into another orientation as it lands', () => {
    /*
     * The trap in cutting a life: the tumble angle is `spin` times the life
     * remaining, so anything that shortens the life rotates the sprite. A flake
     * landing with half a second in hand would turn by up to two radians on the
     * frame it touched down - a sprite teleporting into another orientation,
     * which is the same class of artefact as the one being fixed.
     */
    const spin = 6;
    for (let i = 1; i <= 40; i++) {
      const life = (i / 40) * LONGEST;
      expect(
        sprayTumble(spin, settleLife(life), life),
        'the tumble must not jump when the life is cut',
      ).toBeCloseTo(sprayTumble(spin, life, 0), 9);
    }

    // And a flake at rest stops turning, because snow that has landed is still.
    const arrival = LONGEST;
    const held = sprayTumble(spin, settleLife(arrival), arrival);
    expect(sprayTumble(spin, settleLife(arrival) / 2, arrival)).toBe(held);
    expect(sprayTumble(spin, 0, arrival)).toBe(held);
  });

  it('leaves a flake in the air at full size', () => {
    /*
     * The counterweight, and not a formality. "Nothing lies about on the snow"
     * is satisfied perfectly by a plume drawn at no size at all, which would
     * delete the effect rather than fix it. An airborne flake has to be
     * untouched by any of this.
     */
    expect(sprayFade(SPRAY.life, 0)).toBe(1);
    expect(sprayFade(LONGEST, 0)).toBe(1);
    expect(sprayFade(SPRAY.life / 2, 0)).toBeCloseTo(0.5, 6);
  });

  it('keeps the darker birth tint a minority, and a tint of snow', () => {
    /*
     * Both halves of "45% of the plume read as stray polygons".
     *
     * The share is the first half: at nearly a half it was not a variation, it
     * was a second plume in another colour, and the justification for a dark
     * tint at all is that it breaks up an otherwise uniform white mass.
     *
     * The distance is the second, and it is what the old `#6589ac` failed. Both
     * of these are Lambert albedos of the same material under the same light -
     * snow, lit and shaded - so they may differ by a good deal and not by
     * everything. The old pair were 123 luminance levels apart, which is not one
     * material in two lights, it is snow and slate; the pair here are 51 apart.
     */
    expect(SPRAY.shadeChance, 'the dark tint is a variation, not a second plume').toBeLessThan(0.5);
    expect(Math.abs(luma(SPRAY.color) - luma(SPRAY.shadeColor))).toBeLessThan(60);
    expect(chroma(SPRAY.shadeColor)).toBeLessThan(MAX_SNOW_CHROMA);
  });
});

/** A lane transition frozen part-way, for the carve maths. */
function midChange(t: number, startX: number, targetLane: 0 | 1 | 2): LaneState {
  return { x: startX, targetLane, startX, t };
}

describe('the carve', () => {
  const pitch = Math.abs(LANES[1] - LANES[0]);
  const duration = TUNING.player.laneChangeDuration;

  it('is zero at rest and at both ends of a change', () => {
    expect(lateralSpeed(midChange(1, 0, 2))).toBe(0);
    expect(lateralSpeed(midChange(0, 0, 2))).toBe(0);
    expect(lateralSpeed(midChange(0.999999, LANES[0], 2))).toBeCloseTo(0, 3);
  });

  it('peaks at exactly the analytic derivative of the ease', () => {
    // `stepLane` interpolates with `smoothstep`, whose derivative peaks at 1.5.
    // Anything else here means the width of the trench disagrees with how fast
    // the board is actually moving.
    expect(lateralSpeed(midChange(0.5, 0, 2))).toBeCloseTo((1.5 * pitch) / duration, 6);
  });

  it('integrates to the average lateral speed, which is what proves the shape', () => {
    /*
     * The strongest available check on `6t(1-t)`, and the one a wrong constant
     * fails: the mean of the derivative over a transition must be the total
     * travel divided by the duration, whatever the shape of the ease.
     */
    const steps = 20000;
    let sum = 0;
    for (let i = 0; i < steps; i++) sum += lateralSpeed(midChange((i + 0.5) / steps, 0, 2));
    expect(sum / steps).toBeCloseTo(pitch / duration, 3);
  });

  it('is a function of progress alone, so a dropped frame cannot stutter it', () => {
    // The reason this is not a difference of `lane.x` between frames: the sim
    // runs on a fixed-step accumulator, so a frame with no due tick would
    // report zero lateral speed and a catch-up frame would report double.
    expect(lateralSpeed(midChange(0.3, 0, 2))).toBe(lateralSpeed(midChange(0.3, 0, 2)));
    expect(lateralSpeed(midChange(0.3, 0, 2))).toBeCloseTo(lateralSpeed(midChange(0.7, 0, 2)), 6);
  });

  it('saturates rather than overflowing on a double swipe or a fast board', () => {
    expect(carve01(midChange(0.5, 0, 2))).toBeCloseTo(1, 6);
    // Two lanes in one motion, and a board that steers half again as fast.
    expect(carve01(midChange(0.5, LANES[0], 2))).toBe(1);
    expect(carve01(midChange(0.5, 0, 2), 1.5)).toBe(1);
    expect(carve01(midChange(1, 0, 2))).toBe(0);
  });
});

describe('the carve trail', () => {
  /** Runs `metres` of track past the ring in `steps` frames. */
  function run(
    trail: TrailRing,
    metres: number,
    steps: number,
    grounded: boolean,
    from = 0,
  ): number {
    let laid = 0;
    for (let i = 1; i <= steps; i++) {
      const distance = from + (metres * i) / steps;
      laid += advanceTrail(trail, distance, 0, TRAIL.baseWidth / 2, grounded, i / 60);
    }
    return laid;
  }

  it('lays one sample per spacing, whatever the frame rate', () => {
    const coarse = createTrail();
    const fine = createTrail();
    // Ten metres delivered in four frames and in four hundred. Sample count is
    // a property of the ground covered, not of how often anyone looked.
    expect(run(coarse, 10, 4, true)).toBe(run(fine, 10, 400, true));
    expect(run(createTrail(), 10, 4, true)).toBe(Math.floor(10 / TRAIL.spacing));
  });

  it('never allocates once it is built', () => {
    const trail = createTrail();
    const buffers = [trail.x, trail.halfWidth, trail.laidAt, trail.bornAt, trail.live];

    // Ten times round the ring.
    run(trail, TRAIL.samples * TRAIL.spacing * 10, 3000, true);

    expect(trail.x).toBe(buffers[0]);
    expect(trail.halfWidth).toBe(buffers[1]);
    expect(trail.laidAt).toBe(buffers[2]);
    expect(trail.bornAt).toBe(buffers[3]);
    expect(trail.live).toBe(buffers[4]);
    expect(trail.x.length).toBe(TRAIL.samples);
  });

  it('bounds one frame to a single pass of the ring', () => {
    // A device resumed from the background hands over an enormous delta. There
    // is no point laying a sample the same loop is about to overwrite, and a
    // hundred thousand iterations inside `useFrame` is a dropped frame.
    const trail = createTrail();
    expect(advanceTrail(trail, 100000, 0, 0.2, true, 1)).toBe(TRAIL.samples);
    // And the head must not be left owing the world a debt it never repays.
    expect(trail.head).toBe(100000);
  });

  it('breaks the line for a jump', () => {
    const trail = createTrail();
    run(trail, TRAIL.samples * TRAIL.spacing, 600, false);
    expect(Array.from(trail.live).every((live) => live === 0)).toBe(true);
  });

  it('draws it the rest of the time', () => {
    /*
     * The counterweight to the test above, and not a formality: "a jump breaks
     * the line" is satisfied completely by a ribbon that is never drawn, and
     * that failure would look exactly like this package working.
     */
    const trail = createTrail();
    run(trail, TRAIL.samples * TRAIL.spacing, 600, true);
    expect(Array.from(trail.live).every((live) => live === 1)).toBe(true);
  });

  it('leaves a genuine hole where the flight was', () => {
    const trail = createTrail();
    const leg = 20 * TRAIL.spacing;
    run(trail, leg, 60, true, 0);
    run(trail, leg, 60, false, leg);
    run(trail, leg, 60, true, leg * 2);

    const live = Array.from(trail.live);
    expect(live.filter((v) => v === 0).length).toBeGreaterThanOrEqual(19);
    expect(live.filter((v) => v === 1).length).toBeGreaterThanOrEqual(38);
  });

  it('drops the ribbon when a restart rewinds the track', () => {
    const trail = createTrail();
    run(trail, 40, 200, true);
    expect(Array.from(trail.live).some((live) => live === 1)).toBe(true);

    // `runtime.distance` goes back to zero on a restart. Left alone, the old
    // ribbon would be strung out across the new run.
    advanceTrail(trail, 0, 0, 0.2, true, 99);
    expect(Array.from(trail.live).every((live) => live === 0)).toBe(true);
    expect(trail.head).toBe(0);
  });

  it('resets to a clean ring', () => {
    const trail = createTrail();
    run(trail, 40, 200, true);
    resetTrail(trail, 7);
    expect(trail.cursor).toBe(0);
    expect(trail.head).toBe(7);
    expect(Array.from(trail.laidAt).every((at) => at === 7)).toBe(true);
  });

  it('sits above everything else painted on the snow', () => {
    // Lane guides are at 0.012 and the ridges at 0.01. Ordering by geometry
    // rather than by depth-test luck at a grazing angle.
    expect(TRAIL.y).toBeGreaterThan(0.012);
  });
});

/**
 * The ribbon's across-track section.
 *
 * What this guards is a measurement: a cross-section of the shipped trail read
 * snow 165, lip 206, trench 104 **held bit-identical across 45 pixels**, lip
 * 206, snow. Three true strips, and still a painted stripe - a flat fill of one
 * saturated tone between two hard steps, symmetrical about its own centre. A
 * groove under a raking key is none of those things, so each of them gets an
 * assertion and each assertion gets its counterweight: "nothing is flat" is
 * satisfied by a ribbon that dissolves everywhere, and "the walls differ" by one
 * that has simply been darkened.
 */
describe('the carve trail cross-section', () => {
  const section = carveSection();
  /** Across-track positions for a given trench half width. */
  const offsets = (halfWidth: number): number[] =>
    section.map((vertex) => vertex.side * (halfWidth + vertex.out));
  /** The one vertex on `side` sitting `out` metres outboard of the floor edge. */
  const at = (side: -1 | 1, out: number) =>
    section.find((vertex) => vertex.side === side && vertex.out === out)!;

  const walls = [at(-1, TRAIL.wallWidth / 2), at(1, TRAIL.wallWidth / 2)];
  const floors = [at(-1, 0), at(1, 0)];

  it('sweeps across the groove without folding a quad', () => {
    /*
     * Consecutive entries are stitched into a strip, so a section that is not
     * monotonic in offset winds one quad backwards and draws it inside out.
     * Checked at both ends of the carve, which is the only thing that moves:
     * the floor never closes, because `baseWidth` is its width at zero carve.
     */
    for (const halfWidth of [TRAIL.baseWidth / 2, TRAIL.carveWidth / 2]) {
      const across = offsets(halfWidth);
      for (let i = 1; i < across.length; i++) {
        expect(across[i]!, `section is not monotonic at ${i}`).toBeGreaterThan(across[i - 1]!);
      }
    }
  });

  it('mirrors the geometry and nothing else', () => {
    /*
     * The groove is symmetrical because the board is; the *light* is not, and
     * that split is the entire fix. Every mirrored pair has to sit at mirrored
     * offsets and carry a different value.
     */
    const across = offsets(TRAIL.baseWidth / 2);
    for (let i = 0; i < section.length; i++) {
      const mirror = section.length - 1 - i;
      expect(across[i]!).toBeCloseTo(-across[mirror]!, 9);
      if (i === mirror) continue;
      expect(
        section[i]!.tone,
        'a mirrored pair sharing a tone is a painted band, not a groove',
      ).not.toBe(section[mirror]!.tone);
    }
  });

  it("puts the shaded wall on the key light's side of the groove", () => {
    /*
     * The wall on the sun's side of the trench faces back across the track,
     * away from the light, and the far one is tipped into it - 0.06 against
     * 0.95 of the cosine, with flat snow at 0.72 between them. Derived from
     * `LIGHTING.key` rather than hard-coded, so moving the key moves the
     * shading with it instead of leaving a decal that used to agree.
     */
    expect(SUN_SIDE).toBe(Math.sign(LIGHTING.key.position[0]));

    const sunward = walls.find((wall) => wall.side === SUN_SIDE)!;
    const lee = walls.find((wall) => wall.side !== SUN_SIDE)!;
    expect(luma(sunward.tone), 'the wall facing the key must be the dark one').toBeLessThan(
      luma(lee.tone),
    );

    // And the lips are the same two numbers the other way round, because a
    // lip's outer slope faces outboard where a wall's faces inboard.
    expect(luma(at(SUN_SIDE, TRAIL.wallWidth).tone)).toBeGreaterThan(
      luma(at(SUN_SIDE === -1 ? 1 : -1, TRAIL.wallWidth).tone),
    );
  });

  it('splits the walls about the authored tone rather than darkening the groove', () => {
    /*
     * The counterweight to the test above, and the one that matters most.
     * "The walls differ" is satisfied by taking both of them down, which is
     * buying frame contrast from a decal laid on pale snow - the exact thing
     * this pass exists to stop doing, and the reason the old histogram target
     * was retired. The two walls must average to what was authored.
     *
     * Within a level and a half, because each channel is rounded to 8 bits
     * twice on the way here.
     */
    const mean = (luma(walls[0]!.tone) + luma(walls[1]!.tone)) / 2;
    expect(
      Math.abs(mean - luma(TRAIL.wallColor)),
      'the wall split must be a split, not a darkening',
    ).toBeLessThan(1.5);
  });

  it('never invents a value outside the three authored tones', () => {
    // The derived tones are blends of the authored ones, so the darkest thing
    // in the section is still exactly the trench and the brightest still
    // exactly the lip. A section that reached past either end would be making
    // an art-direction decision that is not in `visuals.ts`.
    const values = section.map((vertex) => luma(vertex.tone));
    expect(Math.min(...values)).toBeCloseTo(luma(TRAIL.color), 6);
    expect(Math.max(...values)).toBeCloseTo(luma(TRAIL.lipColor), 6);
  });

  it('keeps the whole section inside the chroma snow shadow can reach', () => {
    // Shadowed snow in this scene is a desaturated blue-grey: the rig's own
    // cast shadow renders at chroma 33 and its lit piste at 60. The old trench
    // was authored at 96 and displayed at 114 - half again as chromatic as
    // anything the lighting can produce, which is what made it read as paint.
    for (const vertex of section) {
      expect(chroma(vertex.tone), `${vertex.tone} is more saturated than snow gets`).toBeLessThan(
        MAX_SNOW_CHROMA,
      );
    }
  });

  it('leaves no flat fill and no hard step anywhere across it', () => {
    /*
     * Every vertex is shared by the two strips meeting at it, so each strip is
     * a gradient in value, in alpha, or in both - and the 45 px of identical
     * pixels cannot come back. The outermost pair dissolves instead of
     * stepping, which is the only place the ribbon meets untouched snow.
     */
    for (let i = 1; i < section.length; i++) {
      const previous = section[i - 1]!;
      const vertex = section[i]!;
      expect(
        vertex.tone !== previous.tone || vertex.alpha !== previous.alpha,
        `strip ${i - 1} is a flat fill`,
      ).toBe(true);
    }

    expect(section[0]!.alpha).toBe(0);
    expect(section[section.length - 1]!.alpha).toBe(0);
  });

  it('still draws a trench, rather than dissolving the whole ribbon', () => {
    // The counterweight to the soft edge: fading everything satisfies "no hard
    // step" perfectly and deletes the effect. Only the two outer vertices may
    // carry any transparency of their own.
    for (const vertex of section.slice(1, -1)) expect(vertex.alpha).toBe(1);
    expect(floors.every((floor) => floor.alpha === 1)).toBe(true);
  });

  it('keeps the floor below both walls, so it reads as a groove', () => {
    // The floor is lifted at one end by bounce off the lit wall, which is what
    // removes the flat fill. Lift it far enough and the floor is brighter than
    // the wall above it, and a groove becomes a stripe again.
    const brightestFloor = Math.max(...floors.map((floor) => luma(floor.tone)));
    const darkestWall = Math.min(...walls.map((wall) => luma(wall.tone)));
    expect(brightestFloor, 'the floor must stay under its own walls').toBeLessThan(darkestWall);
  });

  it('widens only the floor with the carve', () => {
    /*
     * How far the snow slumps back into a groove is a property of the snow, not
     * of the turn, so the wall and the lip keep their widths and a hard carve
     * digs the floor out from under them. The whole ribbon still grows, which
     * is what the geometry has to allow for.
     */
    for (const vertex of section) {
      expect(vertex.out).toBeLessThanOrEqual(TRAIL.wallWidth + TRAIL.lipWidth);
    }
    const narrow = offsets(TRAIL.baseWidth / 2);
    const wide = offsets(TRAIL.carveWidth / 2);
    const growth = (TRAIL.carveWidth - TRAIL.baseWidth) / 2;
    for (let i = 0; i < section.length; i++) {
      expect(wide[i]! - narrow[i]!).toBeCloseTo(section[i]!.side * growth, 9);
    }
  });

  it('stitches every strip of it, and never across the ring wrap', () => {
    /*
     * The stride is the one part of the ribbon that can be silently wrong. Both
     * failure modes still draw: a stride of two - which is what the ribbon used
     * before its vertices were shared - quietly drops every other strip, and
     * indexing the ring rather than the buffer stitches the newest sample to the
     * oldest and drags one triangle across the whole trail. Neither shows up as
     * an error anywhere.
     *
     * A quad across the ribbon is exactly two neighbouring samples by two
     * neighbouring across-track slots, so that is what every triangle has to be.
     */
    const geometry = buildCarveRibbon();
    const perSample = section.length;
    const vertices = TRAIL.samples * perSample;

    expect(geometry.getAttribute('position').count).toBe(vertices);
    // Four components: the fade rides the vertex alpha, along the ribbon as it
    // ages and across it where the lip dissolves into the snow.
    expect(geometry.getAttribute('color').itemSize).toBe(4);

    const index = geometry.getIndex()!;
    expect(index.count).toBe((TRAIL.samples - 1) * (perSample - 1) * 6);

    for (let triangle = 0; triangle < index.count; triangle += 3) {
      const corners = [0, 1, 2].map((corner) => index.getX(triangle + corner));
      const rows = [...new Set(corners.map((c) => Math.floor(c / perSample)))];
      const slots = [...new Set(corners.map((c) => c % perSample))];

      expect(Math.max(...corners), 'an index runs past the end of the ribbon').toBeLessThan(
        vertices,
      );
      expect(rows.length, `triangle ${triangle / 3} spans ${rows.length} samples`).toBe(2);
      expect(Math.max(...rows) - Math.min(...rows)).toBe(1);
      expect(slots.length, `triangle ${triangle / 3} spans ${slots.length} strips`).toBe(2);
      expect(Math.max(...slots) - Math.min(...slots), 'a strip was skipped').toBe(1);
    }
  });

  it('blends swatches in the space they were authored in', () => {
    // sRGB rather than scene-linear: these are values picked by eye, and the
    // linear-light mix of the same pair lands visibly above the midpoint.
    expect(mixHex(TRAIL.color, TRAIL.lipColor, 0)).toBe(TRAIL.color);
    expect(mixHex(TRAIL.color, TRAIL.lipColor, 1)).toBe(TRAIL.lipColor);
    expect(mixHex(TRAIL.color, TRAIL.lipColor, -3)).toBe(TRAIL.color);
    expect(mixHex(TRAIL.color, TRAIL.lipColor, 4)).toBe(TRAIL.lipColor);

    const midpoint = mixHex(TRAIL.color, TRAIL.lipColor, 0.5);
    expect(rgb(midpoint)).toEqual(
      rgb(TRAIL.color).map((channel, i) => Math.round((channel + rgb(TRAIL.lipColor)[i]!) / 2)),
    );
  });
});

/**
 * How deep the groove is cut, which is the *other* axis of the same defect.
 *
 * The section above fixes a trench held bit-identical across 45 pixels. With one
 * fixed set of tones the ribbon is then held just as identically along its whole
 * visible length - the same flat fill rotated ninety degrees - and the trail's
 * darkest value is a decal the frame carries the entire run rather than something
 * the player did. The relief scales with the carve instead.
 */
describe('how deep the trench is cut', () => {
  const ladder = Array.from({ length: DIG_STEPS + 1 }, (_, step) => carveSection(step / DIG_STEPS));
  const straight = ladder[0]!;
  const deepest = ladder[DIG_STEPS]!;

  /** The one vertex on `side` sitting `out` metres outboard of the floor edge. */
  const at = (section: CarveVertex[], side: -1 | 1, out: number): CarveVertex =>
    section.find((vertex) => vertex.side === side && vertex.out === out)!;
  /** The darkest thing in a section: the floor under the wall that faces the key. */
  const floor = (section: CarveVertex[]): number => luma(at(section, SUN_SIDE, 0).tone);
  /** The brightest: the lip on the same side, whose outer slope faces the light. */
  const lip = (section: CarveVertex[]): number => luma(at(section, SUN_SIDE, TRAIL.wallWidth).tone);

  /**
   * The stand-in for untouched snow, in the authored space these tones live in.
   *
   * `TRAIL.wallColor` is the middle of the section and it is authored at 162,
   * while frame grabs measure the piste between 157 and 172 - so the distance
   * from a tone to the wall is very nearly the contrast that tone will have
   * against the snow it is drawn on. That is what makes "the groove survives"
   * assertable here rather than only on a device.
   */
  const PISTE = luma(TRAIL.wallColor);

  it('is the carve itself, recovered from the width the ring already stores', () => {
    /*
     * `CarveTrail` lays `lerp(baseWidth, carveWidth, carve) / 2`, so inverting
     * that lerp returns the exact `carve01` of the frame the sample was laid on.
     * Exactness is the point: it is why the depth needs no seventh array in a
     * ring whose whole layout exists so that it never allocates.
     */
    for (let i = 0; i <= 20; i++) {
      const carve = i / 20;
      const halfWidth = lerp(TRAIL.baseWidth, TRAIL.carveWidth, carve) / 2;
      expect(trenchDepth01(halfWidth)).toBeCloseTo(carve, 9);
    }

    // A reset ring holds zero widths and a double swipe on a fast board saturates
    // `carve01` past one. Neither may index off the end of the ladder.
    expect(trenchDepth01(0)).toBe(0);
    expect(trenchDepth01(TRAIL.carveWidth)).toBe(1);
    expect(Math.round(trenchDepth01(TRAIL.carveWidth) * DIG_STEPS)).toBe(DIG_STEPS);
  });

  it('leaves the default section exactly as the guarantees above measured it', () => {
    // Everything the cross-section describe asserts is about the fully carved
    // groove. A default that had drifted off the top of the ladder would leave
    // all of it testing a section the renderer never uploads.
    expect(carveSection()).toEqual(deepest);
  });

  it('digs deeper the harder the board is edged', () => {
    /*
     * The whole point: the floor is darkest where the rider actually worked. 15
     * levels is the smallest swing worth the plumbing - the critique measured a
     * drift at +3.2 against its snow and called it invisible - and the real
     * figure is about 19 authored, near 25 on screen once the curve has been
     * through it.
     */
    expect(floor(deepest), 'the carve must change the trench, not just its width').toBeLessThan(
      floor(straight) - 15,
    );

    // And it has to arrive gradually. A ladder that jumped about would put a
    // transverse seam across the ribbon wherever the rider changed effort.
    for (let step = 1; step <= DIG_STEPS; step++) {
      expect(floor(ladder[step]!)).toBeLessThan(floor(ladder[step - 1]!));
      expect(lip(ladder[step]!)).toBeGreaterThan(lip(ladder[step - 1]!));
    }
  });

  it('steps the ladder finely enough that it cannot band', () => {
    /*
     * The counterweight to quantising at all. Rungs coarse enough to see would
     * trade a flat fill for a staircase, and it would show up exactly where the
     * eye is already looking - a hard transverse edge across the trench as the
     * carve crossed a step. Three authored levels at eight steps; five is the
     * bound this may not cross.
     */
    for (let step = 1; step <= DIG_STEPS; step++) {
      const previous = ladder[step - 1]!;
      for (const [index, vertex] of ladder[step]!.entries()) {
        expect(
          Math.abs(luma(vertex.tone) - luma(previous[index]!.tone)),
          `rung ${step} jumps at vertex ${index}`,
        ).toBeLessThan(5);
      }
    }
  });

  it('still cuts a visible groove when the board is running straight', () => {
    /*
     * The counterweight that matters, because running straight is most of a run.
     * "The darkest value only appears under load" is satisfied perfectly by a
     * trail nobody can see the rest of the time, which deletes the effect rather
     * than fixing it - the same trap as fading the whole ribbon to soften its
     * edges. The shallow groove still has to read against the snow.
     */
    expect(PISTE - floor(straight), 'the resting trench must still read').toBeGreaterThan(25);
    expect(lip(straight) - PISTE, 'the resting lips must still read').toBeGreaterThan(20);
    expect(lip(straight) - floor(straight)).toBeGreaterThan(55);
  });

  it('keeps the groove a groove at every depth', () => {
    // The ordering the section is built on - floor under its walls, walls under
    // their lips - is what makes it relief rather than a band, and a depth that
    // inverted any of it anywhere would be worse than no depth at all.
    for (const [step, section] of ladder.entries()) {
      const walls = [at(section, -1, TRAIL.wallWidth / 2), at(section, 1, TRAIL.wallWidth / 2)];
      const floors = [at(section, -1, 0), at(section, 1, 0)];
      const lips = [at(section, -1, TRAIL.wallWidth), at(section, 1, TRAIL.wallWidth)];

      expect(
        Math.max(...floors.map((vertex) => luma(vertex.tone))),
        `rung ${step} lifts the floor above a wall`,
      ).toBeLessThan(Math.min(...walls.map((vertex) => luma(vertex.tone))));
      expect(
        Math.max(...walls.map((vertex) => luma(vertex.tone))),
        `rung ${step} lifts a wall above a lip`,
      ).toBeLessThan(Math.min(...lips.map((vertex) => luma(vertex.tone))));
    }
  });

  it('never invents a value outside the three authored tones, at any depth', () => {
    // Collapsing towards the wall rather than towards the snow is what buys
    // this: every rung is a blend of the authored section with a tone already
    // inside it, so no depth can reach past either end.
    for (const [step, section] of ladder.entries()) {
      for (const vertex of section) {
        expect(luma(vertex.tone), `rung ${step} is darker than the trench`).toBeGreaterThanOrEqual(
          luma(TRAIL.color),
        );
        expect(luma(vertex.tone), `rung ${step} is brighter than the lip`).toBeLessThanOrEqual(
          luma(TRAIL.lipColor),
        );
        expect(chroma(vertex.tone), `${vertex.tone} is more saturated than snow gets`).toBeLessThan(
          MAX_SNOW_CHROMA,
        );
      }
    }
  });

  it('moves the tones and nothing else', () => {
    /*
     * The geometry and the alpha profile are built once from the default
     * section, so a depth that shifted an offset would draw the ribbon through
     * the wrong index buffer, and one that shifted an alpha would dissolve a
     * strip the ribbon needs. Only colour may depend on the carve.
     */
    for (const section of ladder) {
      expect(section.map((vertex) => [vertex.side, vertex.out, vertex.alpha])).toEqual(
        deepest.map((vertex) => [vertex.side, vertex.out, vertex.alpha]),
      );
    }
  });

  it('leaves no flat fill at any depth', () => {
    // The across-track guarantee, re-checked on every rung: the tones are pulled
    // together as the groove shallows, and two of them rounding onto the same
    // hex would put back the flat strip the shared vertices exist to remove.
    for (const [step, section] of ladder.entries()) {
      for (let i = 1; i < section.length; i++) {
        const previous = section[i - 1]!;
        const vertex = section[i]!;
        expect(
          vertex.tone !== previous.tone || vertex.alpha !== previous.alpha,
          `rung ${step} strip ${i - 1} is a flat fill`,
        ).toBe(true);
      }
    }
  });
});

describe('marker poles', () => {
  const layout = markerLayout();
  const perSide = layout.length / 2;
  const slot = TRACK_SPAN / perSide;

  it('lays out identically on every build', () => {
    expect(markerLayout()).toEqual(layout);
  });

  it('puts enough poles down to read as a stream', () => {
    // Roughly six passing events a second at the opening speed. Fewer than a
    // couple of dozen a side and it is scenery, not flow.
    expect(perSide).toBeGreaterThan(24);
  });

  it('stays in the corridor between the obstacles and the fence', () => {
    /*
     * Boxed in from both directions and both bounds are gameplay. Obstacles
     * reach |x| = 3.3 - the outer lane at 2.2 plus the widest obstacle half
     * width - so anything nearer would be read as a hazard; the piste edge is
     * at 4.6 and the fence at 5.1.
     */
    for (const marker of layout) {
      expect(Math.abs(marker.x)).toBeGreaterThan(3.4);
      expect(Math.abs(marker.x)).toBeLessThan(4.6);
    }
  });

  it('never breaches the height at which it would look jumpable', () => {
    // `MARKERS.height` is a ceiling, not a nominal value, and a per-instance
    // roll is exactly where a ceiling gets breached with nothing to notice.
    for (const marker of layout) {
      expect(marker.scale).toBeGreaterThan(0.5);
      expect(marker.scale).toBeLessThanOrEqual(1);
      expect(marker.scale * MARKERS.height).toBeLessThanOrEqual(MARKERS.height);
    }
  });

  it('tiles the recycling band without a hole or a pile-up', () => {
    /*
     * `wrapZ` maps offsets into `[0, TRACK_SPAN)`, so the sequence has to close
     * on itself: a cumulative jittered walk would leave a seam that travels
     * down the run once a lap. Measured on the wrapped, sorted offsets, which
     * is what the player actually sees.
     */
    for (const side of [0, 1]) {
      const offsets = layout
        .slice(side * perSide, (side + 1) * perSide)
        .map((marker) => ((marker.zOffset % TRACK_SPAN) + TRACK_SPAN) % TRACK_SPAN)
        .sort((a, b) => a - b);

      const gaps: number[] = [];
      for (let i = 0; i < offsets.length; i++) {
        const next = i === offsets.length - 1 ? offsets[0]! + TRACK_SPAN : offsets[i + 1]!;
        gaps.push(next - offsets[i]!);
      }

      expect(gaps.reduce((a, b) => a + b, 0)).toBeCloseTo(TRACK_SPAN, 6);
      expect(Math.min(...gaps)).toBeGreaterThan(slot * 0.3);
      expect(Math.max(...gaps)).toBeLessThan(slot * 1.75);
    }
  });

  it('is not strictly periodic, so it carries a rate rather than a phase', () => {
    /*
     * The counterweight to the tiling test, and the whole reason these are not
     * simply laid at `i * spacing`. The ground ridges are a strictly periodic
     * signal at 2.4 to 4.1 Hz, and a strictly periodic stream is one the eye
     * locks phase to and stops integrating - it looks identical at 21 units a
     * second and at 12, which is the defect this package exists to fix.
     */
    const offsets = layout.slice(0, perSide).map((marker) => marker.zOffset);
    const gaps = offsets.slice(1).map((z, i) => z - offsets[i]!);
    const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    const variance = gaps.reduce((sum, g) => sum + (g - mean) ** 2, 0) / gaps.length;
    expect(
      Math.sqrt(variance),
      'marker spacing must vary, or the stream carries phase instead of rate',
    ).toBeGreaterThan(0.4);
  });

  it('does not mirror one side onto the other', () => {
    // The treeline alternates sides with `i % 2`, which is perfect bilateral
    // symmetry at a fixed pitch and the strongest procedural tell in the game.
    const left = layout.slice(0, perSide).map((marker) => marker.zOffset);
    const right = layout.slice(perSide).map((marker) => marker.zOffset);
    expect(left).not.toEqual(right);
    let matching = 0;
    for (let i = 0; i < perSide; i++) {
      if (Math.abs(left[i]! - right[i]!) < 0.01) matching++;
    }
    expect(matching).toBeLessThan(perSide * 0.1);
  });
});
