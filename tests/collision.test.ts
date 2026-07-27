import { describe, expect, it } from 'vitest';
import {
  aabbOverlap,
  createAabb,
  distanceSquared,
  shrinkInto,
  shrunk,
  withinZWindow,
} from '@/game/systems/collision';

describe('aabbOverlap', () => {
  it('detects a dead-centre hit', () => {
    expect(aabbOverlap(createAabb(0, 0, 0, 1, 1, 1), createAabb(0, 0, 0, 1, 1, 1))).toBe(true);
  });

  it('misses when separated on any single axis', () => {
    const a = createAabb(0, 0, 0, 1, 1, 1);
    expect(aabbOverlap(a, createAabb(3, 0, 0, 1, 1, 1))).toBe(false);
    expect(aabbOverlap(a, createAabb(0, 3, 0, 1, 1, 1))).toBe(false);
    expect(aabbOverlap(a, createAabb(0, 0, 3, 1, 1, 1))).toBe(false);
  });

  it('treats exactly touching edges as a miss', () => {
    // Half-extents 1 and 1, centres 2 apart: faces are flush.
    expect(aabbOverlap(createAabb(0, 0, 0, 1, 1, 1), createAabb(2, 0, 0, 1, 1, 1))).toBe(false);
  });

  it('detects the narrowest possible overlap', () => {
    expect(aabbOverlap(createAabb(0, 0, 0, 1, 1, 1), createAabb(1.999, 0, 0, 1, 1, 1))).toBe(true);
  });

  it('is symmetric', () => {
    const a = createAabb(0, 1, -2, 0.4, 0.8, 0.4);
    const b = createAabb(0.5, 1.2, -1.9, 0.5, 0.5, 0.5);
    expect(aabbOverlap(a, b)).toBe(aabbOverlap(b, a));
  });

  it('lets a jump clear a low obstacle', () => {
    // Player collider centred at y = 1.6 after a jump; barrier is knee height.
    const player = createAabb(0, 1.6, 0, 0.38, 0.8, 0.38);
    const barrier = createAabb(0, 0.35, 0, 0.9, 0.35, 0.5);
    expect(aabbOverlap(player, barrier)).toBe(false);
  });

  it('lets a slide clear an overhead barrier that standing would hit', () => {
    const standing = createAabb(0, 0.8, 0, 0.38, 0.8, 0.38);
    const sliding = createAabb(0, 0.34, 0, 0.38, 0.34, 0.38);
    const overhead = createAabb(0, 1.5, 0, 0.9, 0.5, 0.5);
    expect(aabbOverlap(standing, overhead)).toBe(true);
    expect(aabbOverlap(sliding, overhead)).toBe(false);
  });
});

describe('shrunk', () => {
  it('reduces half-extents but keeps the centre', () => {
    const box = shrunk(createAabb(1, 2, 3, 1, 1, 1), 0.2);
    expect(box.x).toBe(1);
    expect(box.y).toBe(2);
    expect(box.z).toBe(3);
    expect(box.hx).toBeCloseTo(0.8);
    expect(box.hy).toBeCloseTo(0.8);
    expect(box.hz).toBeCloseTo(0.8);
  });

  it('turns a glancing contact into a near miss', () => {
    const player = createAabb(0, 1, 0, 0.4, 0.8, 0.4);
    const obstacle = createAabb(0.85, 1, 0, 0.5, 0.8, 0.5);
    expect(aabbOverlap(player, obstacle)).toBe(true);
    expect(aabbOverlap(shrunk(player, 0.15), shrunk(obstacle, 0.15))).toBe(false);
  });

  it('never inverts the box, even for absurd amounts', () => {
    const box = shrunk(createAabb(0, 0, 0, 1, 1, 1), 5);
    expect(box.hx).toBe(0);
    expect(box.hy).toBe(0);
    expect(box.hz).toBe(0);
  });

  it('is a no-op at amount 0', () => {
    const source = createAabb(1, 2, 3, 0.5, 0.6, 0.7);
    expect(shrunk(source, 0)).toEqual(source);
  });
});

describe('shrinkInto', () => {
  it('matches the allocating variant', () => {
    const source = createAabb(2, 3, 4, 1, 2, 3);
    const target = createAabb();
    shrinkInto(target, source, 0.25);
    expect(target).toEqual(shrunk(source, 0.25));
  });

  it('does not mutate the source', () => {
    const source = createAabb(2, 3, 4, 1, 2, 3);
    const before = { ...source };
    shrinkInto(createAabb(), source, 0.5);
    expect(source).toEqual(before);
  });
});

describe('withinZWindow', () => {
  it('accepts entities in front of and behind the player', () => {
    expect(withinZWindow(-5, 0, 6)).toBe(true);
    expect(withinZWindow(5, 0, 6)).toBe(true);
  });

  it('rejects entities beyond the window', () => {
    expect(withinZWindow(-40, 0, 6)).toBe(false);
    expect(withinZWindow(20, 0, 6)).toBe(false);
  });

  it('includes the exact window boundary', () => {
    expect(withinZWindow(6, 0, 6)).toBe(true);
  });
});

describe('distanceSquared', () => {
  it('measures between centres, ignoring extents', () => {
    const a = createAabb(0, 0, 0, 9, 9, 9);
    const b = createAabb(3, 4, 0, 0.1, 0.1, 0.1);
    expect(distanceSquared(a, b)).toBe(25);
  });

  it('is zero for coincident centres', () => {
    expect(distanceSquared(createAabb(1, 1, 1), createAabb(1, 1, 1))).toBe(0);
  });
});
