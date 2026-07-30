import { describe, expect, it } from 'vitest';
import { TUNING } from '@/game/config/tuning';
import { FEEDBACK } from '@/game/config/visuals';
import { clamp01 } from '@/game/core/math';
import {
  difficulty01,
  speedAt,
  speedProgress,
  tierAt,
  TIER_COUNT,
} from '@/game/systems/difficulty';
import { speedRush } from '@/platform/screenFlash';

const { start, max, rampSeconds } = TUNING.speed;

/**
 * The normalisation this replaced, kept as a live expression rather than as
 * prose. Every mutation check below is "what would this cue have done under the
 * old anchor", and the answer is always the same: nothing at all, for the whole
 * opening of every run.
 */
function zeroAnchoredProgress(speed: number): number {
  return clamp01((speed - start) / (max - start));
}

describe('speedAt', () => {
  it('starts at the configured start speed', () => {
    expect(speedAt(0)).toBeCloseTo(start, 9);
  });

  it('reaches exactly the max speed at the end of the ramp', () => {
    expect(speedAt(rampSeconds)).toBeCloseTo(max, 9);
  });

  it('is clamped at max speed for the rest of the run', () => {
    expect(speedAt(rampSeconds * 5)).toBeCloseTo(max, 9);
    expect(speedAt(100_000)).toBeCloseTo(max, 9);
  });

  it('increases monotonically', () => {
    let previous = speedAt(0);
    for (let t = 0.5; t <= rampSeconds * 1.5; t += 0.5) {
      const current = speedAt(t);
      expect(current).toBeGreaterThanOrEqual(previous - 1e-9);
      previous = current;
    }
  });

  it('never leaves the [start, max] band, including for negative time', () => {
    for (const t of [-100, -1, 0, 1, 30, rampSeconds, rampSeconds * 10]) {
      const speed = speedAt(t);
      expect(speed).toBeGreaterThanOrEqual(start - 1e-9);
      expect(speed).toBeLessThanOrEqual(max + 1e-9);
    }
  });

  it('front-loads the ramp, so the run stops feeling sluggish early', () => {
    // Ease-out: more than half the total speed gain lands in the first half.
    const halfway = speedAt(rampSeconds / 2);
    expect(halfway - start).toBeGreaterThan((max - start) * 0.5);
  });
});

describe('tierAt', () => {
  it('starts at the easiest tier', () => {
    expect(tierAt(0)).toBe(0);
  });

  it('never decreases as distance grows', () => {
    let previous = tierAt(0);
    for (let d = 0; d < 8000; d += 25) {
      const tier = tierAt(d);
      expect(tier).toBeGreaterThanOrEqual(previous);
      previous = tier;
    }
  });

  it('stays within the declared tier range', () => {
    for (const d of [0, 100, 500, 1500, 3000, 50_000]) {
      expect(tierAt(d)).toBeGreaterThanOrEqual(0);
      expect(tierAt(d)).toBeLessThan(TIER_COUNT);
    }
  });

  it('eventually unlocks the hardest tier', () => {
    expect(tierAt(100_000)).toBe(TIER_COUNT - 1);
  });
});

describe('difficulty01', () => {
  it('spans exactly 0 to 1 across the ramp', () => {
    expect(difficulty01(0)).toBeCloseTo(0, 9);
    expect(difficulty01(rampSeconds)).toBeCloseTo(1, 9);
  });

  it('is clamped outside the ramp', () => {
    expect(difficulty01(-50)).toBe(0);
    expect(difficulty01(rampSeconds * 10)).toBe(1);
  });

  it('is not routed through speedProgress, and must never be', () => {
    /*
     * The two look interchangeable and are not. `difficulty01` weights which
     * chunks may spawn, so it has to start at zero: tier 0 is where a player who
     * has never played begins. `speedProgress` drives what the *screen* does and
     * has to start well above zero for the opposite reason. Wiring one to the
     * other would either open the game on tier-2 track or put the screen back to
     * being dead for the first half-minute.
     */
    expect(difficulty01(0)).toBeLessThan(speedProgress(speedAt(0)) - 0.4);
  });
});

describe('speedProgress', () => {
  it('is exactly the ceiling at top speed, and clamps above it', () => {
    expect(speedProgress(max)).toBeCloseTo(1, 12);
    expect(speedProgress(max * 3)).toBe(1);
  });

  it('is zero only at a standstill, which is the honest zero', () => {
    expect(speedProgress(0)).toBe(0);
    expect(speedProgress(-40)).toBe(0);
  });

  it('sits well above zero at the speed every run opens at', () => {
    const opening = speedProgress(start);

    // The floor is derived, not invented: it is start over max, and nothing
    // else. If either speed constant moves, this moves with it by construction.
    expect(opening).toBeCloseTo(start / max, 12);
    expect(opening).toBeGreaterThan(0.4);

    // The mutation, kept rather than run once by hand. Under the old anchor the
    // number a run *opens* on is identically zero - the defect, stated as an
    // assertion, so re-anchoring cannot be done quietly.
    expect(zeroAnchoredProgress(start)).toBe(0);
  });

  it('leaves a real escalation above that floor', () => {
    /*
     * The counterweight. "Not dead at the opening" is trivially satisfied by
     * returning 1 everywhere, which kills the cue just as completely from the
     * other end - so the gap between the opening and the ceiling has to be worth
     * something too.
     */
    expect(speedProgress(max) - speedProgress(start)).toBeGreaterThan(0.25);
  });

  it('increases monotonically with speed', () => {
    let previous = speedProgress(-10);
    for (let speed = -10; speed <= max * 1.5; speed += 0.25) {
      const progress = speedProgress(speed);
      expect(progress).toBeGreaterThanOrEqual(previous - 1e-12);
      previous = progress;
    }
  });

  it('is the same straight line through speed the old anchor was', () => {
    // Only the mapping moved, from [0, 1] onto [start / max, 1]. Anything tuned
    // against the old curve's *shape* is unaffected; what changed is where it
    // starts, which is the entire point.
    const floor = start / max;
    for (let speed = start; speed <= max; speed += 0.5) {
      expect(speedProgress(speed)).toBeCloseTo(
        floor + (1 - floor) * zeroAnchoredProgress(speed),
        12,
      );
    }
  });

  it('keeps the speed-driven edge tint visible at the opening speed', () => {
    /*
     * The guarantee is not "the number is non-zero" - that is satisfied by 1e-9.
     * It is that a cue built on it can actually be seen in the condition a
     * player spends most of their time in, and that there is still something
     * left to arrive at the top of the ramp.
     */
    const opening = speedRush(speedProgress(start));
    const top = speedRush(speedProgress(max));

    expect(top).toBeCloseTo(FEEDBACK.speedRushMax, 9);
    expect(opening).toBeGreaterThan(top * 0.25);
    expect(opening).toBeLessThan(top * 0.75);

    // The mutation. The identical overlay, driven by the old anchor, is not
    // faint at the opening - it is off, and it stays off for the first several
    // seconds of every run.
    expect(speedRush(zeroAnchoredProgress(start))).toBe(0);
  });

  it('is already most of the way up for the whole opening of a run', () => {
    /*
     * The reason the floor matters, measured rather than asserted. `easeOutQuad`
     * front-loads a 115 s ramp, but a run that ends in the first half-minute -
     * which is most of them - never leaves the bottom of it. Sampling the real
     * speed curve rather than picking a speed keeps this honest if the ramp is
     * ever retuned.
     */
    for (let t = 0; t <= 30; t += 1) {
      expect(speedProgress(speedAt(t))).toBeGreaterThan(0.55);
    }
    // And the old anchor, over the same half-minute, spends it below a third.
    expect(zeroAnchoredProgress(speedAt(0))).toBe(0);
    expect(zeroAnchoredProgress(speedAt(10))).toBeLessThan(0.35);
  });
});
