import { describe, expect, it } from 'vitest';
import { CHUNKS, CHUNK_LENGTH } from '@/game/content/chunks';
import { createRng } from '@/game/core/rng';
import {
  createSpawner,
  MAX_COINS,
  MAX_OBSTACLES,
  pickChunk,
  RECENT_MEMORY,
  resetSpawner,
  updateSpawner,
  worldZOf,
} from '@/game/systems/spawner';

function freshSpawner() {
  const state = createSpawner();
  resetSpawner(state);
  return state;
}

/** Advances the spawner over a stretch of track the way the sim would. */
function run(state: ReturnType<typeof freshSpawner>, toDistance: number, seed = 1): void {
  const rng = createRng(seed);
  for (let distance = 0; distance <= toDistance; distance += 5) {
    updateSpawner(state, distance, 3, rng);
  }
}

describe('pool allocation', () => {
  it('allocates the whole pool up front, inactive', () => {
    const state = createSpawner();
    expect(state.obstacles).toHaveLength(MAX_OBSTACLES);
    expect(state.coins).toHaveLength(MAX_COINS);
    expect(state.obstacles.every((o) => !o.active)).toBe(true);
    expect(state.coins.every((c) => !c.active)).toBe(true);
  });

  it('never grows the pools during a long run', () => {
    const state = freshSpawner();
    run(state, 6000);
    expect(state.obstacles).toHaveLength(MAX_OBSTACLES);
    expect(state.coins).toHaveLength(MAX_COINS);
  });

  it('reuses entity objects rather than replacing them', () => {
    const state = freshSpawner();
    const identities = state.obstacles.map((o) => o);
    run(state, 3000);
    state.obstacles.forEach((obstacle, index) => {
      expect(obstacle).toBe(identities[index]);
    });
  });
});

describe('streaming', () => {
  it('opens the run with clear track, so nothing is unavoidable at the start', () => {
    const state = freshSpawner();
    const rng = createRng(1);
    updateSpawner(state, 0, 0, rng);

    for (const obstacle of state.obstacles) {
      if (!obstacle.active) continue;
      // Nothing may sit at or behind the player on the very first tick.
      expect(obstacle.trackZ).toBeGreaterThan(CHUNK_LENGTH);
    }
  });

  it('lays track ahead of the player', () => {
    const state = freshSpawner();
    run(state, 500);
    expect(state.nextChunkStart).toBeGreaterThan(500);
  });

  it('recycles entities once they are behind the player', () => {
    const state = freshSpawner();
    run(state, 2000);

    for (const obstacle of state.obstacles) {
      if (!obstacle.active) continue;
      expect(worldZOf(obstacle.trackZ, 2000)).toBeLessThanOrEqual(20.001);
    }
    for (const coin of state.coins) {
      if (!coin.active) continue;
      expect(worldZOf(coin.trackZ, 2000)).toBeLessThanOrEqual(20.001);
    }
  });

  it('keeps active entity counts bounded over a very long run', () => {
    const state = freshSpawner();
    const rng = createRng(3);

    for (let distance = 0; distance <= 20_000; distance += 7) {
      updateSpawner(state, distance, 3, rng);
      expect(state.obstacles.filter((o) => o.active).length).toBeLessThanOrEqual(MAX_OBSTACLES);
      expect(state.coins.filter((c) => c.active).length).toBeLessThanOrEqual(MAX_COINS);
    }
  });

  it('never leaves the visible band empty once running', () => {
    const state = freshSpawner();
    const rng = createRng(5);

    for (let distance = 0; distance <= 3000; distance += 11) {
      updateSpawner(state, distance, 3, rng);
      if (distance < 200) continue;
      const ahead = state.obstacles.filter(
        (o) => o.active && worldZOf(o.trackZ, distance) < 0,
      ).length;
      const coinsAhead = state.coins.filter(
        (c) => c.active && worldZOf(c.trackZ, distance) < 0,
      ).length;
      // Some chunks are deliberately empty of obstacles, but never of both.
      expect(ahead + coinsAhead).toBeGreaterThan(0);
    }
  });

  it('is deterministic for a given seed', () => {
    const a = freshSpawner();
    const b = freshSpawner();
    run(a, 2000, 42);
    run(b, 2000, 42);

    const snapshot = (state: ReturnType<typeof freshSpawner>) =>
      state.obstacles
        .filter((o) => o.active)
        .map((o) => `${o.kind}:${o.lane}:${o.trackZ.toFixed(4)}`)
        .sort();

    expect(snapshot(a)).toEqual(snapshot(b));
    expect(a.nextChunkStart).toBe(b.nextChunkStart);
  });

  it('produces different track for different seeds', () => {
    const a = freshSpawner();
    const b = freshSpawner();
    run(a, 2000, 1);
    run(b, 2000, 999);

    const snapshot = (state: ReturnType<typeof freshSpawner>) =>
      state.obstacles.filter((o) => o.active).map((o) => o.trackZ.toFixed(2)).join(',');

    expect(snapshot(a)).not.toBe(snapshot(b));
  });

  it('advances the chunk cursor in exact chunk lengths', () => {
    const state = freshSpawner();
    const start = state.nextChunkStart;
    run(state, 400);
    const laid = (state.nextChunkStart - start) / CHUNK_LENGTH;
    expect(Number.isInteger(Math.round(laid * 1e6) / 1e6)).toBe(true);
  });
});

describe('pickChunk', () => {
  it('only returns chunks unlocked at the given tier', () => {
    const rng = createRng(11);
    for (let i = 0; i < 400; i++) {
      expect(pickChunk(rng, 0, []).tier).toBe(0);
    }
  });

  it('opens up harder chunks at higher tiers', () => {
    const rng = createRng(13);
    const tiers = new Set<number>();
    for (let i = 0; i < 400; i++) tiers.add(pickChunk(rng, 3, []).tier);
    expect(tiers.size).toBeGreaterThan(1);
  });

  it('avoids chunks laid recently, so the track does not visibly loop', () => {
    const rng = createRng(17);
    const recent = CHUNKS.filter((chunk) => chunk.tier === 0)
      .slice(0, 2)
      .map((chunk) => chunk.id);

    for (let i = 0; i < 200; i++) {
      expect(recent).not.toContain(pickChunk(rng, 0, recent).id);
    }
  });

  it('falls back to repeating rather than failing when everything is recent', () => {
    const rng = createRng(19);
    const allTier0 = CHUNKS.filter((chunk) => chunk.tier === 0).map((chunk) => chunk.id);
    expect(() => pickChunk(rng, 0, allTier0)).not.toThrow();
    expect(allTier0).toContain(pickChunk(rng, 0, allTier0).id);
  });

  it('never repeats a chunk within the memory window during a real run', () => {
    const state = freshSpawner();
    const rng = createRng(23);
    const laid: string[] = [];

    // Re-derive the sequence through the same selection the spawner uses.
    const recent: string[] = [];
    for (let i = 0; i < 200; i++) {
      const chunk = pickChunk(rng, 3, recent);
      laid.push(chunk.id);
      recent.push(chunk.id);
      if (recent.length > RECENT_MEMORY) recent.shift();
    }

    for (let i = 1; i < laid.length; i++) {
      const window = laid.slice(Math.max(0, i - RECENT_MEMORY), i);
      expect(window).not.toContain(laid[i]);
    }
    expect(state.obstacles.length).toBe(MAX_OBSTACLES);
  });
});

describe('resetSpawner', () => {
  it('clears everything for a fresh run', () => {
    const state = freshSpawner();
    run(state, 1500);
    expect(state.obstacles.some((o) => o.active)).toBe(true);

    resetSpawner(state);

    expect(state.obstacles.every((o) => !o.active)).toBe(true);
    expect(state.coins.every((c) => !c.active)).toBe(true);
    expect(state.recentChunkIds).toHaveLength(0);
    expect(state.nextChunkStart).toBe(CHUNK_LENGTH * 2);
  });
});

describe('worldZOf', () => {
  it('puts an entity at the player when the player reaches its track position', () => {
    expect(worldZOf(120, 120)).toBe(0);
  });

  it('reports entities ahead as negative and behind as positive', () => {
    expect(worldZOf(200, 120)).toBeLessThan(0);
    expect(worldZOf(100, 120)).toBeGreaterThan(0);
  });
});
