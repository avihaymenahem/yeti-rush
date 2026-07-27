/**
 * Axis-aligned bounding box collision.
 *
 * There is deliberately no physics engine. A runner needs collision that is
 * deterministic, forgiving and tunable - a solver gives none of those cheaply.
 * These are pure functions over plain numbers so they unit-test without a DOM,
 * a renderer or a scene graph.
 */

import { TUNING } from '@/game/config/tuning';

/** Centre + half-extents. Half-extents keep the overlap test branch-free. */
export interface Aabb {
  x: number;
  y: number;
  z: number;
  hx: number;
  hy: number;
  hz: number;
}

export function createAabb(
  x = 0,
  y = 0,
  z = 0,
  hx = 0.5,
  hy = 0.5,
  hz = 0.5,
): Aabb {
  return { x, y, z, hx, hy, hz };
}

/**
 * True when the boxes overlap on all three axes.
 * Touching exactly edge-to-edge does not count as a hit - a coin sitting flush
 * against an obstacle should not be unreachable.
 */
export function aabbOverlap(a: Aabb, b: Aabb): boolean {
  return (
    Math.abs(a.x - b.x) < a.hx + b.hx &&
    Math.abs(a.y - b.y) < a.hy + b.hy &&
    Math.abs(a.z - b.z) < a.hz + b.hz
  );
}

/**
 * Shrinks a box towards its centre by `amount` (0 = unchanged, 1 = a point).
 * Applied to hitboxes so they sit inside the visual mesh: players read a clip
 * of the visual silhouette as unfair, but never notice a miss that looked close.
 */
export function shrunk(box: Aabb, amount: number = TUNING.collision.forgiveness): Aabb {
  const scale = Math.max(0, 1 - amount);
  return {
    x: box.x,
    y: box.y,
    z: box.z,
    hx: box.hx * scale,
    hy: box.hy * scale,
    hz: box.hz * scale,
  };
}

/** In-place variant for the hot path, where allocating per entity is not free. */
export function shrinkInto(target: Aabb, source: Aabb, amount: number): void {
  const scale = Math.max(0, 1 - amount);
  target.x = source.x;
  target.y = source.y;
  target.z = source.z;
  target.hx = source.hx * scale;
  target.hy = source.hy * scale;
  target.hz = source.hz * scale;
}

/**
 * Cheap broad phase: is this entity close enough on Z to be worth testing?
 * On the treadmill the player sits at a fixed Z, so this rejects the whole
 * track in one subtraction per entity.
 */
export function withinZWindow(
  entityZ: number,
  playerZ: number,
  window: number = TUNING.collision.zWindow,
): boolean {
  return Math.abs(entityZ - playerZ) <= window;
}

/** Squared distance between box centres. Avoids a sqrt in magnet/pickup checks. */
export function distanceSquared(a: Aabb, b: Aabb): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}
