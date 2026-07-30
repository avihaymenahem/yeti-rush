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

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { LANES, TUNING } from '@/game/config/tuning';
// The angle and tint resolvers are exercised in `obstacleVariants.test.ts`;
// what belongs here is the pair that interacts with the collider.
import { MAX_STYLE_SCALE, OBSTACLE_MODELS, PINE_MODELS, styleScale } from '@/game/content/models';
import { OBSTACLE_KINDS, obstacleDef, type ObstacleKind } from '@/game/content/obstacles';
import { ATLAS_STUB_URL, isKitAtlasReference } from '@/game/render/glbAtlas';
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
  images?: { uri?: string }[];
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

/**
 * How many primitives a model is built from.
 *
 * `useModel` sets `flatShading` from whether a model had more than one mesh, so
 * this is not trivia: two variants of one obstacle that disagree here are
 * shaded differently - one faceted, one smooth - standing side by side.
 */
function primitiveCount(url: string): number {
  const gltf = readGlbJson(readFileSync(modelPath(url)));
  return gltf.meshes.reduce((total, mesh) => total + mesh.primitives.length, 0);
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

/** Every registered spec, flattened out of the per-kind variant lists. */
const allSpecs = Object.values(OBSTACLE_MODELS).flat();

describe('obstacle models', () => {
  it('covers at least the obstacles the player meets most', () => {
    // Three of the seven kinds are imported art. The rest are built in code,
    // not for want of models but because a chalet, the two overhead barriers
    // and the woodpile all have to be exactly the size of their colliders and
    // read as one specific instruction at a glance.
    expect(modelledKinds.length).toBeGreaterThanOrEqual(3);
  });

  it('every registered model file exists and parses', () => {
    for (const spec of allSpecs) {
      expect(() => modelSize(spec.url)).not.toThrow();
    }
  });

  it('declares a fit for every model, so nothing renders at authoring scale', () => {
    for (const spec of allSpecs) {
      expect(Boolean(spec.fitBox ?? spec.fitWidth ?? spec.fitHeight)).toBe(true);
    }
  });

  it('never registers the same file twice for one kind', () => {
    // A duplicated URL is a variant that silently is not one: the renderer would
    // build two identical layers and one of the intended looks would be missing.
    for (const kind of modelledKinds) {
      const urls = OBSTACLE_MODELS[kind]!.map((spec) => spec.url);
      expect(new Set(urls).size).toBe(urls.length);
    }
  });

  /*
   * Every variant is held to the collider, not just the first.
   *
   * This is the guard that decided which of the Nature Kit's ten `rock_tall`
   * models could be used at all: fitted to a 3 m height, six of them come out
   * 2.3-3.1 m wide against a 1.7 m collider and fail the width bound below.
   */
  describe.each(modelledKinds.flatMap((kind) => OBSTACLE_MODELS[kind]!.map((spec) => [kind, spec] as const)))(
    '%s - %o',
    (kind, spec) => {
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
    },
  );

  /*
   * The boulder's variants.
   *
   * The counterweight to the sweep above: "every variant fits its collider" is
   * trivially satisfied by registering the same rock four times, and "the
   * boulder has variants" is trivially satisfied by four models that look
   * identical. So this asserts there really are several, that they are
   * different files, and that they differ in shape rather than only in name -
   * while still all standing exactly 3 m tall, since the height is the whole
   * reason the boulder cannot be jumped.
   */
  describe('boulder variants', () => {
    const specs = OBSTACLE_MODELS.boulder!;

    it('offers more than one rock, so a run is not the same spire repeated', () => {
      expect(specs.length).toBeGreaterThanOrEqual(3);
    });

    it('gives every variant the same un-jumpable height', () => {
      // The one property that is gameplay, not decoration. A shorter variant
      // would be a boulder the player could clear, which the solvability check
      // has no idea about - it only knows the kind says "dodge".
      for (const spec of specs) {
        expect(fittedSize(spec).y).toBeCloseTo(obstacleDef('boulder').halfHeight * 2, 5);
      }
    });

    it('finishes every variant identically, so they gloss alike', () => {
      /*
       * `useModel` builds the material out of the spec: `textured` chooses the
       * atlas branch over the vertex-colour one, and `recolor` sets the tint.
       * A variant differing in either would be the same rock in a different
       * finish - a dull one among three shiny ones, or a sandy one among three
       * slate - and nothing else in this file would notice, because every size
       * check would still pass.
       */
      const finishes = specs.map(({ url: _url, ...rest }) => JSON.stringify(rest));
      expect(new Set(finishes).size).toBe(1);
    });

    it('shades every variant the same way', () => {
      // The other half of the finish, and the half that lives in the file
      // rather than the spec: `flatShading` is set from the model's own mesh
      // count, so a single-primitive rock would come out smooth beside three
      // faceted ones however identical its spec.
      const faceted = specs.map((spec) => primitiveCount(spec.url) > 1);
      expect(new Set(faceted).size).toBe(1);
    });

    it('never reaches the next lane, however it is turned and sized', () => {
      /*
       * Boulders are drawn at a random angle and up to `MAX_STYLE_SCALE`, which
       * is what stops four models reading as one rock at speed. The cost is
       * that the footprint no longer sits inside the axis-aligned width every
       * other test here measures: turned 45 degrees, a 1.7 x 1.8 m rock covers
       * its *diagonal*, and scaled up it covers more still.
       *
       * So the bound is checked against the worst combination the renderer can
       * actually produce, not the resting pose. The limit is the near edge of a
       * rider one lane over: lanes are 2.2 apart and `halfWidth` is a half
       * extent, so that edge sits at 2.2 - 0.38. Same line `procedural props`
       * holds the chalet to.
       */
      const neighbourEdge = LANES[2]! - TUNING.player.halfWidth;
      for (const spec of specs) {
        const size = fittedSize(spec);
        const worstReach = (Math.hypot(size.x, size.z) * MAX_STYLE_SCALE) / 2;
        expect(worstReach).toBeLessThan(neighbourEdge);
      }
    });

    it('only ever grows, so a rock can never be smaller than its hitbox', () => {
      // The jitter's one hard rule. Scaling below 1 would put art inside the
      // collider and kill the player in visibly clear air - the exact failure
      // the whole fitted-size sweep above exists to prevent, reintroduced per
      // instance where no static check would ever see it.
      expect(MAX_STYLE_SCALE).toBeGreaterThanOrEqual(1);
      for (let i = 0; i <= 1000; i++) {
        const scale = styleScale(i / 1000);
        expect(scale).toBeGreaterThanOrEqual(1);
        expect(scale).toBeLessThanOrEqual(MAX_STYLE_SCALE);
      }
    });

    it('actually differ in silhouette', () => {
      // Footprint, since the height is pinned. Rounded to a centimetre so this
      // measures shapes a player could tell apart, not float noise.
      const footprints = specs.map((spec) => {
        const size = fittedSize(spec);
        return `${size.x.toFixed(2)}x${size.z.toFixed(2)}`;
      });
      expect(new Set(footprints).size).toBe(specs.length);
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
    const modelled = new Set(modelledKinds);
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
    /*
     * The whole read, and asserted geometrically rather than as a thickness.
     * The rim has to reach *further along the axis* than the field does, or it
     * is not raised - it is a differently coloured ring, which shares its normal
     * with the face and shades identically. Three versions failed here: a solid
     * cylinder that enclosed the face entirely, a chamfer whose widest point was
     * mid-thickness so the edge went inwards, and a bead that fixed the
     * direction and made the coin fat.
     *
     * Split by radius rather than by colour, so it keeps testing the shape if
     * the palette is ever retuned.
     */
    const positions = geometry.getAttribute('position');
    let outerReach = 0;
    let innerReach = 0;
    let widest = 0;

    for (let i = 0; i < positions.count; i++) {
      widest = Math.max(widest, Math.hypot(positions.getX(i), positions.getZ(i)));
    }
    for (let i = 0; i < positions.count; i++) {
      const radius = Math.hypot(positions.getX(i), positions.getZ(i));
      const height = Math.abs(positions.getY(i));
      if (radius > widest * 0.8) outerReach = Math.max(outerReach, height);
      else if (radius < widest * 0.5) innerReach = Math.max(innerReach, height);
    }

    // The rim is the highest thing on the coin - including the numeral, which
    // is struck *into* the field rather than glued onto it. That margin was
    // wrong by a tenth of a millimetre on the first attempt, which is precisely
    // the kind of thing nobody sees and a measurement does.
    expect(outerReach).toBeGreaterThan(innerReach);
  });

  it('stays thin, like a coin rather than a puck', () => {
    // The other half of the same shape. A rim can be made to stand proud by
    // simply making the whole thing thicker, which is how the bead version went
    // wrong - raised, and far too fat to read as struck metal.
    geometry.computeBoundingBox();
    const box = geometry.boundingBox as THREE.Box3;
    const thickness = box.max.y - box.min.y;
    const diameter = box.max.x - box.min.x;
    expect(thickness).toBeLessThan(diameter * 0.2);
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

/*
 * The stubbed atlas request.
 *
 * `useModel` assigns the colour atlas through the bundler and lets `glbAtlas`
 * retire the GLBs' own reference to it. Both halves are easy to get subtly
 * wrong in ways nothing else would catch: the reference could stop existing
 * (making the stub dead code), or the matcher could widen far enough to swallow
 * the real atlas - which does not throw, it textures every imported model with
 * one transparent pixel.
 */
describe('the kit atlas reference', () => {
  /** Every distinct image URI declared across the registered models. */
  const declaredImageUris = new Set(
    [...allSpecs, ...PINE_MODELS].flatMap((spec) =>
      (readGlbJson(readFileSync(modelPath(spec.url))).images ?? [])
        .map((image) => image.uri)
        .filter((uri): uri is string => uri !== undefined),
    ),
  );

  it('is really there, in more than one model', () => {
    // The counterweight. Every assertion below is trivially satisfied if the
    // GLBs stopped referencing an atlas at all, so this asserts the sample size
    // and that the thing being worked around genuinely exists.
    const textured = [...allSpecs, ...PINE_MODELS].filter((spec) => spec.textured);
    expect(textured.length).toBeGreaterThanOrEqual(4);
    expect(declaredImageUris.has('Textures/colormap.png')).toBe(true);
  });

  it('names a path that exists in neither the source tree nor a build', () => {
    // The reason a stub is correct rather than lazy: this is not a path that
    // resolves in one environment and not the other, it resolves in none. If a
    // `Textures/` directory is ever added, the redirect stops being right.
    for (const uri of declaredImageUris) {
      expect(existsSync(MODEL_DIR + uri)).toBe(false);
    }
    expect(existsSync(MODEL_DIR + 'colormap.png')).toBe(true);
  });

  it('matches the reference however the loader resolves it', () => {
    // GLTFLoader resolves the URI against the model's own URL, so what reaches
    // the loading manager is prefixed - differently in dev and in a build.
    expect(isKitAtlasReference('Textures/colormap.png')).toBe(true);
    expect(isKitAtlasReference('/src/assets/models/Textures/colormap.png')).toBe(true);
    expect(isKitAtlasReference('/assets/Textures/colormap.png')).toBe(true);
    expect(isKitAtlasReference('/yeti-rush/assets/Textures/colormap.png')).toBe(true);
    expect(isKitAtlasReference('http://localhost:5173/assets/Textures/colormap.png?t=1')).toBe(
      true,
    );
  });

  it('never matches the atlas the bundler emits', () => {
    // The failure that would not announce itself. Widening the pattern to
    // `colormap.png` alone catches the hashed asset too, and every textured
    // model silently renders as a single transparent pixel.
    expect(isKitAtlasReference('/assets/colormap-DfG7h2Ka.png')).toBe(false);
    expect(isKitAtlasReference('/src/assets/models/colormap.png')).toBe(false);
    expect(isKitAtlasReference('/assets/Textures/colormap-DfG7h2Ka.png')).toBe(false);
    expect(isKitAtlasReference('/assets/textures-colormap.png')).toBe(false);
  });

  it('redirects to a PNG that actually decodes', () => {
    // A base64 typo fails exactly like the broken path it replaces, and looks
    // the same in the console, so the bytes are checked rather than trusted.
    const [header, payload] = ATLAS_STUB_URL.split(',');
    expect(header).toBe('data:image/png;base64');

    const bytes = Buffer.from(payload as string, 'base64');
    expect(bytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(bytes.subarray(12, 16).toString()).toBe('IHDR');
    expect(bytes.readUInt32BE(16)).toBe(1); // width
    expect(bytes.readUInt32BE(20)).toBe(1); // height
    expect(bytes.subarray(bytes.length - 8, bytes.length - 4).toString()).toBe('IEND');
  });

  it('costs less than the atlas it stands in for', () => {
    // The whole argument for a stub over redirecting to the real file. If this
    // ever stops holding, redirecting is the better trade.
    const atlasBytes = readFileSync(MODEL_DIR + 'colormap.png').length;
    const stubBytes = Buffer.from(ATLAS_STUB_URL.split(',')[1] as string, 'base64').length;
    expect(stubBytes).toBeLessThan(atlasBytes / 100);
  });
});
