import { describe, expect, it } from 'vitest';
import { TUNING } from '@/game/config/tuning';
import { difficulty01, speedAt, tierAt, TIER_COUNT } from '@/game/systems/difficulty';

const { start, max, rampSeconds } = TUNING.speed;

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
});
