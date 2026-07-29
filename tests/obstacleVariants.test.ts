/**
 * Boulders come in four shapes, and which one a boulder gets is decided once,
 * at spawn, from the run's seed.
 *
 * Two failure modes are worth guarding and neither is about the art:
 *
 *  - **It is not actually random.** "Boulders have variants" is trivially
 *    satisfied by always picking the first one, and the track would look
 *    exactly as repetitive as before while every model test passed. So the
 *    distribution is measured over real generated content, not asserted on a
 *    staged entity.
 *  - **It is not stable.** The style is stored on a *pooled* entity that is
 *    recycled every few seconds. If it were re-rolled - or resolved at draw
 *    time - a boulder would change shape while the player watched it approach.
 *
 * And the invariant underneath both: a variant is decoration. It must not reach
 * the simulation, or two runs from one seed would diverge on which rock is
 * which.
 */

import { describe, expect, it } from 'vitest';
import { TUNING } from '@/game/config/tuning';
import {
  MAX_STYLE_SCALE,
  OBSTACLE_MODELS,
  styleAngle,
  styleScale,
  styleTint,
  variantIndex,
} from '@/game/content/models';
import { createRng } from '@/game/core/rng';
import { speedAt, tierAt } from '@/game/systems/difficulty';
import { createSpawner, updateSpawner } from '@/game/systems/spawner';

const BOULDER_VARIANTS = OBSTACLE_MODELS.boulder!.length;
const STEP = TUNING.sim.step;

/**
 * Every distinct boulder laid over one run, as `${trackZ}:${lane}` -> style.
 *
 * Entities come from a recycled pool and the same slot is reused many times
 * over a run, so keying on position is what stops one boulder being counted
 * once per frame it is alive for - the same idiom `laneSpread.test.ts` uses.
 */
function boulders(seed: number, seconds = 180): Map<string, number> {
  const state = createSpawner();
  const rng = createRng(seed);
  const found = new Map<string, number>();

  let distance = 0;
  let elapsed = 0;

  while (elapsed < seconds) {
    elapsed += STEP;
    const speed = speedAt(elapsed);
    distance += speed * STEP;
    updateSpawner(state, distance, tierAt(distance), rng, speed);

    for (const obstacle of state.obstacles) {
      if (!obstacle.active || obstacle.kind !== 'boulder') continue;
      const key = `${obstacle.trackZ.toFixed(2)}:${obstacle.lane}`;
      const previous = found.get(key);
      // Same boulder, later frame: the style must not have moved under it.
      if (previous !== undefined && previous !== obstacle.style) {
        throw new Error(`boulder at ${key} changed style ${previous} -> ${obstacle.style}`);
      }
      found.set(key, obstacle.style);
    }
  }

  return found;
}

/** Just the style rolls, in the order the boulders were first seen. */
function boulderStyles(seed: number, seconds = 180): number[] {
  return [...boulders(seed, seconds).values()];
}

describe('resolving a style roll to a variant', () => {
  it('splits the range evenly, with no variant favoured', () => {
    // The reason this is a floor of a [0, 1) roll and not `byte % count`: over
    // 256 values, `% 3` gives the first variant 86 and the last 84.
    const counts = new Array<number>(BOULDER_VARIANTS).fill(0);
    const samples = 100_000;
    for (let i = 0; i < samples; i++) {
      counts[variantIndex(i / samples, BOULDER_VARIANTS)]!++;
    }
    const expected = samples / BOULDER_VARIANTS;
    for (const count of counts) expect(Math.abs(count - expected)).toBeLessThanOrEqual(1);
  });

  it('stays in range at the edges of the roll', () => {
    expect(variantIndex(0, 4)).toBe(0);
    // `Rng.next` never returns 1, but nothing in the type says so.
    expect(variantIndex(1, 4)).toBe(3);
    expect(variantIndex(0.9999999, 4)).toBe(3);
  });

  it('collapses to the only variant when a kind has one model', () => {
    for (const roll of [0, 0.5, 0.999]) expect(variantIndex(roll, 1)).toBe(0);
  });
});

/*
 * The per-instance jitter.
 *
 * Swapping in three more rocks was not enough on its own - four models all
 * standing square on at one size still read as the same boulder going past, and
 * that is the feedback this exists to answer. Angle, size and tint are what
 * actually break the repetition, so they get the same scrutiny as the models.
 */
describe('turning, sizing and tinting a boulder', () => {
  const ROLLS = Array.from({ length: 400 }, (_, i) => i / 400);

  it('does not tie the angle to which rock it is', () => {
    /*
     * The failure that would make the track look *more* patterned, not less:
     * derive the angle from the style directly and every copy of a given rock
     * stands at the same angle, so the four models become four fixed poses.
     *
     * Measured as the spread of angles within one variant. Tied to the variant,
     * a variant's angles span a quarter turn at most; decorrelated, they cover
     * the circle.
     */
    for (let variant = 0; variant < BOULDER_VARIANTS; variant++) {
      const angles = ROLLS.filter((r) => variantIndex(r, BOULDER_VARIANTS) === variant).map(
        styleAngle,
      );
      const spread = Math.max(...angles) - Math.min(...angles);
      expect(spread).toBeGreaterThan(Math.PI * 1.5);
    }
  });

  it('turns rocks right round, so no angle is the default one', () => {
    // Quartered, because "it varies" is also true of a wobble of a few degrees.
    const quadrants = new Set(ROLLS.map((r) => Math.floor((styleAngle(r) / (Math.PI * 2)) * 4)));
    expect(quadrants.size).toBe(4);
  });

  it('never shrinks a rock below its collider', () => {
    // Restated here against the resolver rather than the constant, since this
    // is the value the renderer actually multiplies by.
    for (const roll of ROLLS) {
      expect(styleScale(roll)).toBeGreaterThanOrEqual(1);
      expect(styleScale(roll)).toBeLessThanOrEqual(MAX_STYLE_SCALE);
    }
  });

  it('actually uses the size range rather than sitting at one end', () => {
    const scales = ROLLS.map(styleScale);
    expect(Math.min(...scales)).toBeLessThan(1.03);
    expect(Math.max(...scales)).toBeGreaterThan(MAX_STYLE_SCALE - 0.03);
  });

  it('keeps the tint centred, so rocks are lit alike rather than recoloured', () => {
    const tints = ROLLS.map(styleTint);
    const mean = tints.reduce((sum, t) => sum + t, 0) / tints.length;
    expect(mean).toBeGreaterThan(0.97);
    expect(mean).toBeLessThan(1.03);
    // Gentle: this is one stone under one sun, not a palette.
    expect(Math.min(...tints)).toBeGreaterThan(0.8);
    expect(Math.max(...tints)).toBeLessThan(1.2);
  });

  it('gives two neighbouring rocks different looks', () => {
    /*
     * The end-to-end claim, and the one a player would notice failing: take the
     * boulders a real run lays down and check that consecutive ones differ in
     * something. A hash that collapsed - or a style that was constant - would
     * pass every bound above and still put identical rocks side by side.
     */
    const styles = boulderStyles(0x1234);
    let identical = 0;
    for (let i = 1; i < styles.length; i++) {
      const a = styles[i - 1]!;
      const b = styles[i]!;
      const same =
        variantIndex(a, BOULDER_VARIANTS) === variantIndex(b, BOULDER_VARIANTS) &&
        Math.abs(styleAngle(a) - styleAngle(b)) < 0.2 &&
        Math.abs(styleScale(a) - styleScale(b)) < 0.02;
      if (same) identical++;
    }
    expect(styles.length).toBeGreaterThan(60);
    // Well under a tenth. Two rocks in a row can coincide; a run of them means
    // the variation is not doing anything.
    expect(identical / styles.length).toBeLessThan(0.05);
  });
});

describe('boulders on a real generated track', () => {
  it('produces enough boulders to say anything about them', () => {
    // The sample-size assertion. Every rate below is meaningless if the
    // generator happened to lay four boulders.
    expect(boulderStyles(0x1234).length).toBeGreaterThan(60);
  });

  it('uses every variant, rather than settling on one', () => {
    /*
     * The test that fails if the roll is dropped and the renderer defaults to
     * variant 0 - which is precisely what the track looked like before this
     * change, and which no other test in the suite would notice.
     */
    for (const seed of [0x1234, 0xbeef, 0x5eed]) {
      const used = new Set(boulderStyles(seed).map((s) => variantIndex(s, BOULDER_VARIANTS)));
      expect(used.size).toBe(BOULDER_VARIANTS);
    }
  });

  it('spreads them roughly evenly, so one rock does not dominate', () => {
    const styles = boulderStyles(0x1234);
    const counts = new Array<number>(BOULDER_VARIANTS).fill(0);
    for (const style of styles) counts[variantIndex(style, BOULDER_VARIANTS)]!++;

    // Deliberately loose. This is not testing mulberry32's uniformity - it is
    // testing that the roll is per-obstacle rather than, say, per chunk, which
    // would clump one shape into long stretches and show up here as a share
    // well outside these bounds.
    const share = counts.map((count) => count / styles.length);
    for (const value of share) {
      expect(value).toBeGreaterThan(0.5 / BOULDER_VARIANTS);
      expect(value).toBeLessThan(2 / BOULDER_VARIANTS);
    }
  });

  it('gives a seed the same rocks every time', () => {
    // Reproducibility, the property the whole RNG discipline exists to protect.
    expect(boulderStyles(0xbeef)).toEqual(boulderStyles(0xbeef));
  });

  it('gives different seeds different rocks', () => {
    /*
     * The counterweight: identical output for every seed would also satisfy the
     * test above.
     *
     * Compared as resolved variants over a common prefix, not as raw style
     * arrays. Two seeds lay different *numbers* of boulders, so comparing the
     * arrays whole passes on length alone - it did, when the roll was stubbed
     * out to a constant during a mutation check, which is exactly the bug this
     * is meant to catch.
     */
    const a = boulderStyles(0xbeef).map((s) => variantIndex(s, BOULDER_VARIANTS));
    const b = boulderStyles(0x5eed).map((s) => variantIndex(s, BOULDER_VARIANTS));
    const length = Math.min(a.length, b.length);
    expect(length).toBeGreaterThan(30);
    expect(a.slice(0, length)).not.toEqual(b.slice(0, length));
  });

  it('never lets a boulder change shape once it is standing', () => {
    /*
     * The pooled-entity trap. A boulder is spawned hundreds of metres ahead and
     * is on screen for seconds; re-rolling its style on any later tick - or
     * choosing it at draw time from a value the spawner reuses - would make it
     * visibly morph as it came towards the player.
     *
     * `boulders` throws on the first frame a style moves, so this asserts it
     * scanned a real run rather than that nothing happened to be checked.
     */
    for (const seed of [0x1234, 0xbeef]) {
      expect(() => boulders(seed)).not.toThrow();
      expect(boulders(seed).size).toBeGreaterThan(60);
    }
  });
});
