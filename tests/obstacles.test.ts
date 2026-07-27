/**
 * Obstacle definitions vs. reality.
 *
 * Each obstacle declares the one action that clears it. These tests simulate a
 * real jump and a real slide - the actual player physics, the actual colliders,
 * the actual forgiveness margin - and assert the declared action gets through
 * and the others cannot, at every speed the game reaches.
 *
 * Crucially the negative cases sweep the whole range of trigger timings, so
 * "cannot be jumped" means no timing works, not just that one guess failed.
 * Without this, tuning the jump arc could silently turn a dodge obstacle into
 * a jumpable one and nothing would fail.
 */

import { describe, expect, it } from 'vitest';
import { TUNING } from '@/game/config/tuning';
import {
  OBSTACLE_KINDS,
  obstacleDef,
  type ClearAction,
  type ObstacleKind,
} from '@/game/content/obstacles';
import { aabbOverlap, createAabb, type Aabb } from '@/game/systems/collision';
import {
  createPlayerState,
  requestJump,
  requestSlide,
  stepPlayer,
  writePlayerAabb,
} from '@/game/systems/player';

const STEP = TUNING.sim.step;
const SHRINK = 1 - TUNING.collision.forgiveness;

/** Speeds spanning the whole difficulty ramp. */
const SPEEDS = [TUNING.speed.start, 20, TUNING.speed.max];

function obstacleBox(kind: ObstacleKind, worldZ: number): Aabb {
  const def = obstacleDef(kind);
  return {
    x: 0,
    y: def.centreY,
    z: worldZ,
    hx: def.halfWidth * SHRINK,
    hy: def.halfHeight * SHRINK,
    hz: def.halfDepth * SHRINK,
  };
}

/**
 * Runs the player at an obstacle, triggering `action` when the obstacle is
 * `leadSeconds` away. Returns true if they got through untouched.
 */
function runThrough(
  kind: ObstacleKind,
  action: ClearAction | 'none',
  speed: number,
  leadSeconds: number,
): boolean {
  const player = createPlayerState();
  const box = createAabb();

  let worldZ = -20;
  let acted = false;

  while (worldZ < 8) {
    if (!acted && (action === 'jump' || action === 'slide')) {
      if (worldZ >= -leadSeconds * speed) {
        acted = true;
        if (action === 'jump') requestJump(player);
        else requestSlide(player);
      }
    }

    stepPlayer(player, STEP);
    worldZ += speed * STEP;

    writePlayerAabb(player, 0, box);
    const shrunkPlayer: Aabb = {
      ...box,
      hx: box.hx * SHRINK,
      hy: box.hy * SHRINK,
      hz: box.hz * SHRINK,
    };
    if (aabbOverlap(shrunkPlayer, obstacleBox(kind, worldZ))) return false;
  }

  return true;
}

/** True if ANY trigger timing gets the player through. */
function clearableBy(kind: ObstacleKind, action: ClearAction, speed: number): boolean {
  for (let lead = 0; lead <= 1.0; lead += 0.02) {
    if (runThrough(kind, action, speed, lead)) return true;
  }
  return false;
}

describe('obstacle definitions', () => {
  it('declares a known action for every kind', () => {
    for (const kind of OBSTACLE_KINDS) {
      expect(['jump', 'slide', 'dodge']).toContain(obstacleDef(kind).action);
    }
  });

  it('gives every kind a non-degenerate collider that sits on or above the snow', () => {
    for (const kind of OBSTACLE_KINDS) {
      const def = obstacleDef(kind);
      expect(def.halfWidth).toBeGreaterThan(0);
      expect(def.halfHeight).toBeGreaterThan(0);
      expect(def.halfDepth).toBeGreaterThan(0);
      expect(def.centreY - def.halfHeight).toBeGreaterThanOrEqual(-1e-9);
    }
  });

  it('keeps the collider inside the visual box, so nothing hits thin air', () => {
    for (const kind of OBSTACLE_KINDS) {
      const def = obstacleDef(kind);
      expect(def.halfWidth * 2).toBeLessThanOrEqual(def.visual.width + 1e-9);
      expect(def.halfHeight * 2).toBeLessThanOrEqual(def.visual.height + 1e-9);
      expect(def.halfDepth * 2).toBeLessThanOrEqual(def.visual.depth + 1e-9);
    }
  });

  it('covers all three actions, so no mechanic is unused', () => {
    const actions = new Set(OBSTACLE_KINDS.map((kind) => obstacleDef(kind).action));
    expect(actions).toEqual(new Set(['jump', 'slide', 'dodge']));
  });
});

describe.each(SPEEDS)('at speed %d', (speed) => {
  describe.each(OBSTACLE_KINDS)('%s', (kind) => {
    const def = obstacleDef(kind);

    it('blocks a player who does nothing', () => {
      expect(runThrough(kind, 'none', speed, 0)).toBe(false);
    });

    if (def.action === 'jump') {
      it('is cleared by jumping', () => {
        expect(clearableBy(kind, 'jump', speed)).toBe(true);
      });
      it('cannot be slid under, at any timing', () => {
        expect(clearableBy(kind, 'slide', speed)).toBe(false);
      });
    }

    if (def.action === 'slide') {
      it('is cleared by sliding', () => {
        expect(clearableBy(kind, 'slide', speed)).toBe(true);
      });
      it('cannot be jumped, at any timing', () => {
        expect(clearableBy(kind, 'jump', speed)).toBe(false);
      });
    }

    if (def.action === 'dodge') {
      it('cannot be jumped, at any timing - it must be dodged', () => {
        expect(clearableBy(kind, 'jump', speed)).toBe(false);
      });
      it('cannot be slid under, at any timing', () => {
        expect(clearableBy(kind, 'slide', speed)).toBe(false);
      });
    }
  });
});
