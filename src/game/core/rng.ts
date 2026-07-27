/**
 * Seeded pseudo-random number generation.
 *
 * Every random decision in the game goes through this - never `Math.random()`.
 * A run is therefore fully reproducible from its seed, which makes the track
 * generator fuzz-testable and lets us replay a reported bad run exactly.
 */

export interface Rng {
  /** The seed this generator was created from. */
  readonly seed: number;
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform integer in [0, maxExclusive). Returns 0 if `maxExclusive` <= 0. */
  int(maxExclusive: number): number;
  /** Uniform float in [min, max). */
  range(min: number, max: number): number;
  /** True with probability `p`. */
  chance(p: number): boolean;
  /** Uniformly picks one element. Throws on an empty array. */
  pick<T>(items: readonly T[]): T;
  /** Picks one element with probability proportional to its weight. */
  weighted<T>(items: readonly T[], weights: readonly number[]): T;
  /** A new independent generator, seeded deterministically from this one. */
  fork(): Rng;
}

/**
 * Mulberry32 - 32-bit state, fast, and good enough statistically for gameplay.
 * Chosen over a bigger PRNG because it is trivially portable and reproducible.
 */
export function createRng(seed: number): Rng {
  let state = seed | 0;

  const next = (): number => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const rng: Rng = {
    seed,
    next,
    int: (maxExclusive) => (maxExclusive <= 0 ? 0 : Math.floor(next() * maxExclusive)),
    range: (min, max) => min + next() * (max - min),
    chance: (p) => next() < p,

    pick: <T,>(items: readonly T[]): T => {
      if (items.length === 0) throw new Error('rng.pick: empty array');
      return items[Math.floor(next() * items.length)] as T;
    },

    weighted: <T,>(items: readonly T[], weights: readonly number[]): T => {
      if (items.length === 0) throw new Error('rng.weighted: empty array');
      if (items.length !== weights.length) {
        throw new Error('rng.weighted: items and weights length mismatch');
      }

      let total = 0;
      for (const w of weights) {
        if (w < 0) throw new Error('rng.weighted: negative weight');
        total += w;
      }
      if (total <= 0) throw new Error('rng.weighted: weights sum to zero');

      let roll = next() * total;
      for (let i = 0; i < items.length; i++) {
        roll -= weights[i] as number;
        if (roll < 0) return items[i] as T;
      }
      // Only reachable through floating-point drift on the final element.
      return items[items.length - 1] as T;
    },

    fork: () => createRng((next() * 0xffffffff) | 0),
  };

  return rng;
}

/** Turns an arbitrary string into a seed (FNV-1a), for named/shareable runs. */
export function hashSeed(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash | 0;
}
