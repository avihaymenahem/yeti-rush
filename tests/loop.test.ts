import { describe, expect, it } from 'vitest';
import { createFixedTimestep, type FixedTimestepOptions } from '@/game/core/loop';

const OPTS: FixedTimestepOptions = {
  step: 1 / 60,
  maxFrameTime: 0.25,
  maxStepsPerFrame: 5,
};

describe('createFixedTimestep', () => {
  it('runs exactly one tick for one step of elapsed time', () => {
    const loop = createFixedTimestep(OPTS);
    let ticks = 0;
    loop.advance(OPTS.step, () => ticks++);
    expect(ticks).toBe(1);
  });

  it('runs no tick when less than a step has elapsed', () => {
    const loop = createFixedTimestep(OPTS);
    let ticks = 0;
    loop.advance(OPTS.step / 2, () => ticks++);
    expect(ticks).toBe(0);
    // The leftover is kept, so the next partial frame completes the step.
    loop.advance(OPTS.step / 2, () => ticks++);
    expect(ticks).toBe(1);
  });

  it('always passes the fixed step to the tick callback, never the frame delta', () => {
    const loop = createFixedTimestep(OPTS);
    const steps: number[] = [];
    loop.advance(0.05, (step) => steps.push(step));
    expect(steps.length).toBeGreaterThan(0);
    for (const step of steps) expect(step).toBe(OPTS.step);
  });

  it('accumulates a consistent number of ticks over many uneven frames', () => {
    const loop = createFixedTimestep(OPTS);
    let ticks = 0;
    // 120 frames of jittery ~60fps totalling exactly 120 steps of elapsed time.
    const deltas = Array.from({ length: 120 }, (_, i) =>
      i % 2 === 0 ? OPTS.step * 0.8 : OPTS.step * 1.2,
    );
    for (const delta of deltas) loop.advance(delta, () => ticks++);
    // Floating-point drift can leave the final step a hair short; anything
    // beyond one tick of slop would mean the sim is losing time.
    expect(ticks).toBeGreaterThanOrEqual(119);
    expect(ticks).toBeLessThanOrEqual(120);
  });

  it('clamps a huge frame delta instead of running thousands of ticks', () => {
    const loop = createFixedTimestep(OPTS);
    let ticks = 0;
    // App was backgrounded for a minute.
    loop.advance(60, () => ticks++);
    expect(ticks).toBeLessThanOrEqual(OPTS.maxStepsPerFrame);
  });

  it('never runs more than maxStepsPerFrame ticks in one frame', () => {
    const loop = createFixedTimestep({ ...OPTS, maxStepsPerFrame: 3 });
    let ticks = 0;
    loop.advance(0.2, () => ticks++);
    expect(ticks).toBe(3);
  });

  it('drops the backlog after hitting the step cap so it cannot grow forever', () => {
    const loop = createFixedTimestep({ ...OPTS, maxStepsPerFrame: 2 });
    loop.advance(0.2, () => {});
    expect(loop.pending).toBe(0);
  });

  it('ignores negative and non-finite deltas', () => {
    const loop = createFixedTimestep(OPTS);
    let ticks = 0;
    loop.advance(-5, () => ticks++);
    loop.advance(Number.NaN, () => ticks++);
    loop.advance(Number.POSITIVE_INFINITY, () => ticks++);
    expect(ticks).toBe(0);
    expect(loop.pending).toBe(0);
  });

  it('returns an interpolation alpha in [0, 1)', () => {
    const loop = createFixedTimestep(OPTS);
    for (let i = 0; i < 200; i++) {
      const alpha = loop.advance(0.007, () => {});
      expect(alpha).toBeGreaterThanOrEqual(0);
      expect(alpha).toBeLessThan(1);
    }
  });

  it('reset() clears the accumulator and the tick count', () => {
    const loop = createFixedTimestep(OPTS);
    loop.advance(0.01, () => {});
    loop.advance(OPTS.step, () => {});
    expect(loop.ticks).toBeGreaterThan(0);
    loop.reset();
    expect(loop.pending).toBe(0);
    expect(loop.ticks).toBe(0);
  });

  it('rejects a non-positive step', () => {
    expect(() => createFixedTimestep({ ...OPTS, step: 0 })).toThrow();
  });
});
