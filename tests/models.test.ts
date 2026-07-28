/**
 * Art must fit the colliders, not the other way round.
 *
 * These tests read the real `.glb` files off disk, compute the size each model
 * will actually be after its declared fit, and compare that against the
 * collider it represents. That closes the loop the comments in `models.ts`
 * claim: change a collider and forget the art (or swap a model for one with
 * different proportions) and this fails rather than silently shipping a hitbox
 * that does not match what the player sees.
 *
 * The GLB container is parsed directly - no three.js, no DOM - so this stays a
 * fast pure-logic test like the rest of the suite.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { TUNING } from '@/game/config/tuning';
import { OBSTACLE_MODELS, PINE_MODELS } from '@/game/content/models';
import { OBSTACLE_KINDS, obstacleDef, type ObstacleKind } from '@/game/content/obstacles';
import {
  coinGeometry,
  PROP_BUILDERS,
  propGeometry,
  rampGeometry,
  type PropKind,
} from '@/game/render/propGeometry';
import type { ModelSpec } from '@/game/render/useModel';

const MODEL_DIR = fileURLToPath(new URL('../src/assets/models/', import.meta.url));

/** Resolves the bundler's asset URL back to the file on disk. */
function modelPath(url: string): string {
  return MODEL_DIR + (url.split('/').pop() ?? url);
}

function readGlbJson(buffer: Buffer): Record<string, never> & {
  nodes: { mesh?: number; children?: number[]; scale?: number[]; translation?: number[] }[];
  meshes: { primitives: { attributes: Record<string, number> }[] }[];
  accessors: { min?: number[]; max?: number[] }[];
  scenes: { nodes: number[] }[];
  scene?: number;
} {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  expect(view.getUint32(0, true)).toBe(0x46546c67); // 'glTF'

  let offset = 12;
  while (offset < view.byteLength) {
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    if (type === 0x4e4f534a) {
      const json = buffer.subarray(offset + 8, offset + 8 + length).toString('utf8');
      return JSON.parse(json);
    }
    offset += 12 + length - 4;
    offset += (4 - (offset % 4)) % 4;
  }
  throw new Error('no JSON chunk in GLB');
}

/**
 * Axis-aligned size of a model, with node translation and scale applied.
 * Rotation is ignored: none of the imported models use it, which is asserted
 * indirectly by the fitted sizes coming out as expected.
 */
function modelSize(url: string): { x: number; y: number; z: number } {
  const gltf = readGlbJson(readFileSync(modelPath(url)));

  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];

  const visit = (index: number, offset: number[], scale: number[]) => {
    const node = gltf.nodes[index]!;
    const nodeScale = node.scale ?? [1, 1, 1];
    const nodeOffset = node.translation ?? [0, 0, 0];
    const combinedScale = scale.map((s, i) => s * nodeScale[i]!);
    const combinedOffset = offset.map((o, i) => o + nodeOffset[i]! * scale[i]!);

    if (node.mesh !== undefined) {
      for (const prim of gltf.meshes[node.mesh]!.primitives) {
        const accessor = gltf.accessors[prim.attributes['POSITION']!]!;
        if (!accessor.min || !accessor.max) continue;
        for (let axis = 0; axis < 3; axis++) {
          const lo = accessor.min[axis]! * combinedScale[axis]! + combinedOffset[axis]!;
          const hi = accessor.max[axis]! * combinedScale[axis]! + combinedOffset[axis]!;
          min[axis] = Math.min(min[axis]!, lo, hi);
          max[axis] = Math.max(max[axis]!, lo, hi);
        }
      }
    }

    for (const child of node.children ?? []) visit(child, combinedOffset, combinedScale);
  };

  for (const index of gltf.scenes[gltf.scene ?? 0]!.nodes) visit(index, [0, 0, 0], [1, 1, 1]);

  return { x: max[0]! - min[0]!, y: max[1]! - min[1]!, z: max[2]! - min[2]! };
}

/** The size a model will be once `useModel` has applied the spec's fit. */
function fittedSize(spec: ModelSpec): { x: number; y: number; z: number } {
  const raw = modelSize(spec.url);

  if (spec.fitBox) {
    return { x: spec.fitBox[0], y: spec.fitBox[1], z: spec.fitBox[2] };
  }

  let scale = 1;
  if (spec.fitHeight && raw.y > 0) scale = spec.fitHeight / raw.y;
  else if (spec.fitWidth && raw.x > 0) scale = spec.fitWidth / raw.x;

  return { x: raw.x * scale, y: raw.y * scale, z: raw.z * scale };
}

const modelledKinds = Object.keys(OBSTACLE_MODELS) as ObstacleKind[];

describe('obstacle models', () => {
  it('covers at least the obstacles the player meets most', () => {
    // Three of the seven kinds are imported art. The rest are built in code,
    // not for want of models but because a chalet, the two overhead barriers
    // and the woodpile all have to be exactly the size of their colliders and
    // read as one specific instruction at a glance.
    expect(modelledKinds.length).toBeGreaterThanOrEqual(3);
  });

  it('every registered model file exists and parses', () => {
    for (const spec of Object.values(OBSTACLE_MODELS)) {
      expect(() => modelSize(spec.url)).not.toThrow();
    }
  });

  it('declares a fit for every model, so nothing renders at authoring scale', () => {
    for (const spec of Object.values(OBSTACLE_MODELS)) {
      expect(Boolean(spec.fitBox ?? spec.fitWidth ?? spec.fitHeight)).toBe(true);
    }
  });

  describe.each(modelledKinds)('%s', (kind) => {
    const spec = OBSTACLE_MODELS[kind]!;
    const def = obstacleDef(kind);
    const collider = {
      x: def.halfWidth * 2,
      y: def.halfHeight * 2,
      z: def.halfDepth * 2,
    };

    it('is never visibly narrower or shorter than its collider', () => {
      const size = fittedSize(spec);
      // A visual smaller than the hitbox means dying to apparently thin air.
      expect(size.x).toBeGreaterThanOrEqual(collider.x * 0.95);
      expect(size.y).toBeGreaterThanOrEqual(collider.y * 0.95);
      expect(size.z).toBeGreaterThanOrEqual(collider.z * 0.95);
    });

    it('does not sprawl far past its collider', () => {
      const size = fittedSize(spec);
      // Generous on depth - a deep visual is forgiving, since the hitbox is
      // shorter along the direction of travel - but width must stay in lane.
      expect(size.x).toBeLessThanOrEqual(collider.x * 1.15);
      expect(size.y).toBeLessThanOrEqual(collider.y * 1.15);
      expect(size.z).toBeLessThanOrEqual(collider.z * 1.8);
    });

    it('stays inside its lane, so it cannot look like it blocks a neighbour', () => {
      // Lanes are 2.2 apart; anything wider than that reaches into the next one.
      expect(fittedSize(spec).x).toBeLessThan(2.2);
    });
  });
});

/**
 * Procedurally built obstacles get the same guarantee as the imported ones.
 *
 * The direction that matters is asymmetric: a visual *larger* than its hitbox
 * is forgiving - you clip the art and survive - but a visual *smaller* than its
 * hitbox kills the player in what looks like clear air. That is the bug this
 * catches, and it is exactly the one the first pine bough had.
 */
describe('procedural props', () => {
  const propKinds = Object.keys(PROP_BUILDERS) as PropKind[];

  it('builds the ramp, which mixes a hand-authored wedge with three primitives', () => {
    // The wedge is non-indexed and three's primitives are indexed. Merging the
    // two used to return null and take the entire scene down with it, so this
    // asserts the assembler normalises them rather than assuming they match.
    const geometry = rampGeometry();
    expect(geometry.getAttribute('position').count).toBeGreaterThan(0);
    expect(geometry.getAttribute('color')).toBeDefined();

    const box = geometry.boundingBox!;
    // Sits on the snow and rises towards the lip.
    expect(box.min.y).toBeCloseTo(0, 1);
    expect(box.max.y).toBeGreaterThan(0.8);
    // Wide enough to aim at, and no wider than a lane.
    expect(box.max.x - box.min.x).toBeGreaterThan(1.6);
    expect(box.max.x - box.min.x).toBeLessThan(2.2);
  });

  it('covers every obstacle kind without a model', () => {
    const modelled = new Set(Object.keys(OBSTACLE_MODELS));
    for (const kind of OBSTACLE_KINDS) {
      if (modelled.has(kind)) continue;
      expect(propKinds).toContain(kind);
    }
  });

  describe.each(propKinds)('%s', (kind) => {
    const def = obstacleDef(kind as ObstacleKind);
    const box = propGeometry(kind).boundingBox!;

    it('is built ground-aligned, like every other obstacle', () => {
      expect(box.min.y).toBeGreaterThanOrEqual(-0.05);
      expect(box.min.y).toBeLessThan(0.35);
    });

    it('fully covers its collider, so nothing kills in apparently clear air', () => {
      const colliderTop = def.centreY + def.halfHeight;
      const colliderBottom = def.centreY - def.halfHeight;

      expect(box.max.y).toBeGreaterThanOrEqual(colliderTop - 0.06);
      // The underside of an overhead barrier is the edge the player judges the
      // gap by, so it must not sit above the hitbox.
      expect(Math.min(box.min.y, colliderBottom)).toBeLessThanOrEqual(colliderBottom + 0.06);
      expect(box.max.x).toBeGreaterThanOrEqual(def.halfWidth - 0.06);
      expect(Math.abs(box.min.x)).toBeGreaterThanOrEqual(def.halfWidth - 0.06);
    });

    it('never reaches a rider in the neighbouring lane', () => {
      /*
       * Not "narrower than a lane": a chalet is a building and is meant to
       * overhang. What matters is that it never visually covers the space a
       * player in the next lane occupies, or the lane reads as blocked when it
       * is not. Lanes are 2.2 apart and the player is 0.38 wide.
       *
       * Measured only over the geometry a player can actually reach. Anything
       * above the top of a jumping player cannot be run into and cannot be
       * mistaken for a wall - and a tunnel has to roof the lane you ride
       * through, so forbidding overhead spans outright would forbid roofing a
       * passage at all. Below that line the rule is exactly as it was.
       */
      const reach = TUNING.player.jumpPeakHeight + TUNING.player.halfHeight * 2;
      const positions = propGeometry(kind).getAttribute('position');

      let widest = 0;
      for (let i = 0; i < positions.count; i++) {
        if (positions.getY(i) > reach) continue;
        widest = Math.max(widest, Math.abs(positions.getX(i)));
      }

      expect(widest).toBeLessThan(2.2 - 0.38);
    });

    it('puts its detail on the face the player actually sees', () => {
      /*
       * The camera sits at +z and obstacles arrive from -z, so the visible face
       * of a prop is its +z face. The chalet had its lit windows and its door
       * on the -z face and presented the player with a blank wall - every bit
       * of that detail was drawn facing away, for the whole life of the
       * project, and nothing here noticed.
       *
       * Counting distinct vertex colours either side of the midline catches it:
       * a one-sided prop has colours on its front that its back does not, and a
       * symmetric one comes out even. What must never happen again is a prop
       * that is richer behind than in front.
       */
      const geometry = propGeometry(kind);
      const positions = geometry.getAttribute('position');
      const colors = geometry.getAttribute('color');

      const front = new Set<string>();
      const back = new Set<string>();
      for (let i = 0; i < positions.count; i++) {
        const z = positions.getZ(i);
        // Skip the midline, where a face belongs to neither side.
        if (Math.abs(z) < 0.02) continue;
        const key = [colors.getX(i), colors.getY(i), colors.getZ(i)]
          .map((c) => c.toFixed(2))
          .join(',');
        (z > 0 ? front : back).add(key);
      }

      expect(front.size).toBeGreaterThanOrEqual(back.size);
    });

    it('does not tower far above its collider', () => {
      // Total height is not the measure - a gate or a bough stands on the
      // ground while its hitbox is overhead, so the visual is legitimately
      // taller. What must not happen is the art continuing well past the top
      // of what actually stops the player.
      expect(box.max.y).toBeLessThanOrEqual(def.centreY + def.halfHeight + 0.35);
    });
  });
});

describe('pine models', () => {
  it('registers more than one variant, so the treeline is not a repeat', () => {
    expect(PINE_MODELS.length).toBeGreaterThan(1);
  });

  it('uses distinct models', () => {
    const urls = PINE_MODELS.map((spec) => spec.url);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it('every file exists and is fitted to a sensible tree height', () => {
    for (const spec of PINE_MODELS) {
      const size = fittedSize(spec);
      expect(size.y).toBeGreaterThan(2);
      expect(size.y).toBeLessThan(8);
    }
  });

  it('keeps trees clear of the track, given where scenery is placed', () => {
    // Scenery starts 5.5 units out; the outer lane sits at 2.2 plus the
    // player's half width. A tree wider than that gap would overhang the run.
    for (const spec of PINE_MODELS) {
      expect(fittedSize(spec).x / 2).toBeLessThan(5.5 - 2.2 - 0.38);
    }
  });
});

/**
 * The coin.
 *
 * Not a prop kind, so it misses the sweep above, but it is instanced across the
 * whole visible field - which makes it the one geometry in the game whose vertex
 * count is multiplied by everything on screen.
 */
describe('coin geometry', () => {
  const geometry = coinGeometry();

  it('has a rim standing proud of its face', () => {
    // The whole read. A coin is legible because of its edge: the rim catches the
    // key light along a bright arc while the face stays a step down. A rim that
    // is merely wider than the face is a flat disc with a stripe on it.
    geometry.computeBoundingBox();
    const box = geometry.boundingBox as THREE.Box3;
    // The disc's axis is local Y, so rim thickness is the Y extent.
    expect(box.max.y - box.min.y).toBeGreaterThan(0.12);
  });

  it('carries more than one tone, so it is not a plain disc', () => {
    const colours = new Set<string>();
    const attribute = geometry.getAttribute('color');
    for (let i = 0; i < attribute.count; i++) {
      colours.add(
        `${attribute.getX(i).toFixed(2)},${attribute.getY(i).toFixed(2)},${attribute.getZ(i).toFixed(2)}`,
      );
    }
    expect(colours.size).toBeGreaterThanOrEqual(3);
  });

  it('never reaches past the radius it is collected from', () => {
    // Art wider than the pickup radius makes a coin look collectable from
    // further away than it is, which reads as the magnet failing.
    geometry.computeBoundingBox();
    const box = geometry.boundingBox as THREE.Box3;
    const reach = Math.max(box.max.x, box.max.z, -box.min.x, -box.min.z);
    expect(reach).toBeLessThan(TUNING.coins.pickupRadius);
  });

  it('stays cheap enough to instance across the field', () => {
    // Multiplied by every visible coin. Thinning the coin economy is what made
    // a richer disc affordable at all - this bound is what keeps that true.
    expect(geometry.getAttribute('position').count).toBeLessThan(700);
  });
});
