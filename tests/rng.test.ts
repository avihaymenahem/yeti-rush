import { describe, expect, it } from 'vitest';
import { createRng, hashSeed } from '@/game/core/rng';

describe('createRng', () => {
  it('produces the same sequence for the same seed', () => {
    const a = createRng(12345);
    const b = createRng(12345);
    const seqA = Array.from({ length: 50 }, () => a.next());
    const seqB = Array.from({ length: 50 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it('produces different sequences for different seeds', () => {
    const a = Array.from({ length: 20 }, ((r) => () => r.next())(createRng(1)));
    const b = Array.from({ length: 20 }, ((r) => () => r.next())(createRng(2)));
    expect(a).not.toEqual(b);
  });

  it('stays within [0, 1)', () => {
    const rng = createRng(99);
    for (let i = 0; i < 10_000; i++) {
      const value = rng.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('int() stays within bounds and covers the range', () => {
    const rng = createRng(7);
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      const value = rng.int(5);
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(5);
      seen.add(value);
    }
    expect(seen.size).toBe(5);
  });

  it('int(0) returns 0 rather than NaN', () => {
    expect(createRng(1).int(0)).toBe(0);
  });

  it('range() stays within bounds', () => {
    const rng = createRng(3);
    for (let i = 0; i < 1000; i++) {
      const value = rng.range(-4, 9);
      expect(value).toBeGreaterThanOrEqual(-4);
      expect(value).toBeLessThan(9);
    }
  });

  it('pick() only returns elements of the array', () => {
    const rng = createRng(21);
    const items = ['a', 'b', 'c'] as const;
    for (let i = 0; i < 500; i++) {
      expect(items).toContain(rng.pick(items));
    }
  });

  it('pick() throws on an empty array', () => {
    expect(() => createRng(1).pick([])).toThrow();
  });

  it('weighted() respects the weights', () => {
    const rng = createRng(555);
    const counts = { rare: 0, common: 0 };
    for (let i = 0; i < 20_000; i++) {
      counts[rng.weighted(['rare', 'common'] as const, [1, 9])]++;
    }
    const rareShare = counts.rare / 20_000;
    expect(rareShare).toBeGreaterThan(0.07);
    expect(rareShare).toBeLessThan(0.13);
  });

  it('weighted() never returns a zero-weight item', () => {
    const rng = createRng(8);
    for (let i = 0; i < 2000; i++) {
      expect(rng.weighted(['never', 'always'] as const, [0, 1])).toBe('always');
    }
  });

  it('weighted() rejects malformed input', () => {
    const rng = createRng(1);
    expect(() => rng.weighted(['a'], [1, 2])).toThrow(/mismatch/);
    expect(() => rng.weighted(['a', 'b'], [0, 0])).toThrow(/zero/);
    expect(() => rng.weighted(['a', 'b'], [-1, 2])).toThrow(/negative/);
  });

  it('fork() is deterministic but independent of the parent', () => {
    const parentA = createRng(42);
    const parentB = createRng(42);
    expect(parentA.fork().next()).toBe(parentB.fork().next());

    const parent = createRng(42);
    const child = parent.fork();
    expect(child.seed).not.toBe(parent.seed);
  });
});

describe('hashSeed', () => {
  it('is stable for the same string', () => {
    expect(hashSeed('yeti-rush')).toBe(hashSeed('yeti-rush'));
  });

  it('differs for different strings', () => {
    expect(hashSeed('alpha')).not.toBe(hashSeed('beta'));
  });

  it('produces a usable seed for an empty string', () => {
    expect(Number.isFinite(hashSeed(''))).toBe(true);
  });
});
