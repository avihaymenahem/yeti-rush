/**
 * Riders.
 *
 * The shop's second axis, and a deliberately cosmetic one. Boards carry the
 * handling stats; a character that also changed how the game plays would double
 * the balance surface for nothing, and would turn the one thing players pick
 * for personality into a thing they have to pick for performance.
 *
 * Splitting them fixed something that had been quietly wrong for the whole life
 * of the project: the rider's fur was part of the *board*, so buying a
 * snowboard changed the colour of the yeti riding it. Most of what is asserted
 * here is that the two stay separate.
 */

import * as THREE from 'three';
import { beforeEach, describe, expect, it } from 'vitest';
import { TUNING } from '@/game/config/tuning';
import { RIDER, saturate } from '@/game/config/visuals';
import {
  CHARACTER_IDS,
  characterDef,
  CHARACTERS,
  DEFAULT_CHARACTER,
} from '@/game/content/characters';
import { SKIN_IDS, skinDef } from '@/game/content/skins';
import {
  buildYeti,
  FIGURE_SCALE,
  hipHeightFor,
  RIDING_LEG_PITCH,
  YETI_JOINTS,
} from '@/game/render/yetiGeometry';
import { useMetaStore } from '@/game/state/metaStore';
import { createDefaultSave, migrate } from '@/game/state/saveSchema';

beforeEach(() => {
  useMetaStore.setState({ save: createDefaultSave() });
});

/**
 * Display luminance of an authored hex, on the same weights `visuals.ts` uses.
 *
 * Gamma-space on purpose: these are values a person reads off a screen, not
 * radiometric quantities, and the palette in `visuals.ts` is authored and
 * asserted the same way.
 */
function luma(hex: string): number {
  const value = hex.replace('#', '');
  const r = parseInt(value.slice(0, 2), 16) / 255;
  const g = parseInt(value.slice(2, 4), 16) / 255;
  const b = parseInt(value.slice(4, 6), 16) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * How many vertices of a merged part carry a given authored colour.
 *
 * `bakeColor` saturates the hex and hands it to `THREE.Color`, which converts
 * sRGB to the linear working space on assignment - so a raw hex compared
 * against the buffer would miss by the whole transfer function. Building the
 * expected value through exactly the same pair is what keeps this a test of
 * where the colour went rather than of colour management.
 */
function verticesColoured(geometry: THREE.BufferGeometry, hex: string): number {
  const expected = new THREE.Color(saturate(hex));
  const colors = geometry.getAttribute('color');

  let found = 0;
  for (let i = 0; i < colors.count; i++) {
    const near =
      Math.abs(colors.getX(i) - expected.r) < 1e-4 &&
      Math.abs(colors.getY(i) - expected.g) < 1e-4 &&
      Math.abs(colors.getZ(i) - expected.b) < 1e-4;
    if (near) found++;
  }
  return found;
}

/** The rig every rider is built on, for the geometry assertions below. */
function buildDefaultRig() {
  return buildYeti(characterDef(DEFAULT_CHARACTER), skinDef('yeti-classic'));
}

describe('the roster', () => {
  it('starts with exactly one free rider', () => {
    // More than one free character makes the first purchase meaningless; none
    // at all leaves a new save with nothing equippable.
    const free = CHARACTER_IDS.filter((id) => characterDef(id).price === 0);
    expect(free).toEqual([DEFAULT_CHARACTER]);
  });

  it('prices every rider above the one before it', () => {
    const prices = CHARACTER_IDS.map((id) => characterDef(id).price).sort((a, b) => a - b);
    for (let i = 1; i < prices.length; i++) {
      expect(prices[i] as number).toBeGreaterThan(prices[i - 1] as number);
    }
  });

  it('gives every rider six distinct colours', () => {
    // The whole character *is* its palette, so a rider with a duplicate in it
    // is one that reads as a flat silhouette on the slope.
    for (const id of CHARACTER_IDS) {
      const { fur, furShade, face, accent, garment, garmentTrim } = characterDef(id);
      expect(new Set([fur, furShade, face, accent, garment, garmentTrim]).size).toBe(6);
    }
  });

  it('falls back rather than throwing on a rider that no longer exists', () => {
    // A save naming a removed character has to load and play. Throwing here
    // would brick the app for anyone who had bought it.
    expect(characterDef('a-rider-that-was-cut')).toBe(CHARACTERS[DEFAULT_CHARACTER]);
  });
});

describe('buying one', () => {
  it('needs the coins, and takes exactly them', () => {
    const target = CHARACTER_IDS.find((id) => characterDef(id).price > 0);
    if (!target) throw new Error('no paid rider to test with');
    const price = characterDef(target).price;

    useMetaStore.setState((s) => ({ save: { ...s.save, coins: price - 1 } }));
    expect(useMetaStore.getState().buyCharacter(target)).toBe(false);

    useMetaStore.setState((s) => ({ save: { ...s.save, coins: price } }));
    expect(useMetaStore.getState().buyCharacter(target)).toBe(true);
    expect(useMetaStore.getState().save.coins).toBe(0);
  });

  it('equips what was just bought', () => {
    // Nobody buys a rider in order to look at it in a list.
    const target = CHARACTER_IDS.find((id) => characterDef(id).price > 0);
    if (!target) throw new Error('no paid rider to test with');

    useMetaStore.setState((s) => ({ save: { ...s.save, coins: 999_999 } }));
    useMetaStore.getState().buyCharacter(target);
    expect(useMetaStore.getState().save.equippedCharacter).toBe(target);
  });

  it('cannot be bought twice', () => {
    const target = CHARACTER_IDS.find((id) => characterDef(id).price > 0);
    if (!target) throw new Error('no paid rider to test with');

    useMetaStore.setState((s) => ({ save: { ...s.save, coins: 999_999 } }));
    useMetaStore.getState().buyCharacter(target);
    const after = useMetaStore.getState().save.coins;

    expect(useMetaStore.getState().buyCharacter(target)).toBe(false);
    expect(useMetaStore.getState().save.coins).toBe(after);
  });

  it('will not equip one the player does not own', () => {
    const target = CHARACTER_IDS.find((id) => characterDef(id).price > 0);
    if (!target) throw new Error('no paid rider to test with');

    expect(useMetaStore.getState().equipCharacter(target)).toBe(false);
    expect(useMetaStore.getState().save.equippedCharacter).toBe(DEFAULT_CHARACTER);
  });
});

describe('what a rider must not touch', () => {
  it('carries no handling stats at all', () => {
    /*
     * The load-bearing one. Boards own `stats`, and the generator's solvability
     * guarantee is validated against the worst case any *board* can produce. A
     * character with a stat on it would sit outside that proof entirely.
     */
    for (const id of CHARACTER_IDS) {
      expect(Object.keys(characterDef(id))).toEqual([
        'id',
        'name',
        'tagline',
        'price',
        'fur',
        'furShade',
        'face',
        'accent',
        'garment',
        'garmentTrim',
      ]);
    }
  });

  it('leaves the board colours to the board, and the rider colours to the rider', () => {
    /*
     * The split that stopped a snowboard purchase recolouring the rider, and it
     * only holds if it holds in *both* directions.
     *
     * It did not, for the whole life of the split: `SkinDef` kept carrying
     * `fur`, `furShade` and `face` after `buildYeti` had stopped reading any of
     * them off the board. Dead fields are not harmless here - while a board can
     * still name a fur colour the old bug stays representable, one careless
     * destructure from coming back, and the next board gets authored with three
     * colours that do nothing. Asserting the absence is what keeps them gone.
     *
     * Named per field, so restoring one fails with "yeti-classic carries fur,
     * which belongs to the rider" rather than a bare boolean.
     */
    const riderOnly = ['fur', 'furShade', 'face', 'accent', 'garment', 'garmentTrim'];
    for (const id of SKIN_IDS) {
      const skin = skinDef(id);
      expect(skin.board).toBeTypeOf('string');
      expect(skin.boardTrim).toBeTypeOf('string');
      for (const field of riderOnly) {
        expect(skin, `${id} carries ${field}, which belongs to the rider`).not.toHaveProperty(field);
      }
    }
    for (const id of CHARACTER_IDS) {
      expect(characterDef(id)).not.toHaveProperty('board');
      expect(characterDef(id)).not.toHaveProperty('boardTrim');
    }
  });
});

describe('an older save', () => {
  it('loads with the default rider owned and equipped', () => {
    // Everyone already playing was riding this, since the rider had no identity
    // of its own before now - so nothing is taken away and nothing is granted.
    const old = migrate({ version: 1, coins: 500, equippedSkin: 'yeti-classic' });
    expect(old.ownedCharacters).toContain(DEFAULT_CHARACTER);
    expect(old.equippedCharacter).toBe(DEFAULT_CHARACTER);
  });

  it('cannot end up equipped to something it does not own', () => {
    const tampered = migrate({
      version: 1,
      ownedCharacters: [DEFAULT_CHARACTER],
      equippedCharacter: 'shadow',
    });
    expect(tampered.equippedCharacter).toBe(DEFAULT_CHARACTER);
  });
});

/**
 * What the rider is wearing.
 *
 * The measured problem: 70% of the play space sat inside a single 10%
 * luminance band, and the rider was in it - the only sub-0.6 surface anywhere
 * on the model was the goggle band. A near-white figure on a near-white slope
 * has no silhouette, which is a readability failure before it is an art one.
 *
 * The fix had to be clothing rather than darker fur, so these assert both
 * halves: the garment really is dark, and the *coat* really is not.
 */
describe('the garment', () => {
  it('dresses every rider in something genuinely dark', () => {
    for (const id of CHARACTER_IDS) {
      const { garment, garmentTrim } = characterDef(id);
      expect(luma(garment)).toBeLessThan(0.25);
      expect(luma(garmentTrim)).toBeLessThan(0.25);
    }
  });

  it('leaves the coat alone, so the rider is dressed rather than dirty', () => {
    /*
     * The counterweight, and the one that actually constrains anything. "The
     * rider has a dark value on it" is trivially satisfied by shading the fur
     * down until the whole animal is grey - which is precisely the wrong fix,
     * because it reads as grime and it throws away the light end of the
     * figure's own range. What is wanted is contrast *within* the rider, so the
     * gap is asserted rather than either value alone.
     */
    for (const id of CHARACTER_IDS) {
      const { fur, garment } = characterDef(id);
      expect(luma(garment)).toBeLessThan(luma(fur) - 0.15);
    }
  });

  it('is built into the torso, not merely declared', () => {
    /*
     * A palette entry nothing reads is worth nothing. The garment lives inside
     * the already-merged torso geometry - which is what makes it free - so the
     * only way to know it shipped is to count the vertices carrying its colour.
     *
     * The floor is a real one. The gilet shell alone is a 10x8 sphere, so a
     * couple of hundred vertices; a token strap would come in under fifty and
     * fail here, which is the mutation this bound exists to catch.
     */
    const parts = buildDefaultRig();
    const { garment, garmentTrim } = characterDef(DEFAULT_CHARACTER);

    expect(verticesColoured(parts.torso, garment)).toBeGreaterThan(200);
    expect(verticesColoured(parts.torso, garmentTrim)).toBeGreaterThan(200);
    parts.dispose();
  });

  it('is the darkest thing on the rider, and by a clear margin', () => {
    /*
     * The point of the whole exercise, measured where it lands rather than
     * where it was authored: the *baked* torso colours, after `saturate` and
     * after the sRGB-to-linear conversion `THREE.Color` applies. Whatever the
     * palette does upstream, the darkest value on the figure has to be a
     * garment and it has to be well below the fur that surrounds it.
     */
    const parts = buildDefaultRig();
    const colors = parts.torso.getAttribute('color');

    let darkest = Infinity;
    let lightest = -Infinity;
    for (let i = 0; i < colors.count; i++) {
      const value = 0.2126 * colors.getX(i) + 0.7152 * colors.getY(i) + 0.0722 * colors.getZ(i);
      darkest = Math.min(darkest, value);
      lightest = Math.max(lightest, value);
    }

    const trim = new THREE.Color(saturate(characterDef(DEFAULT_CHARACTER).garmentTrim));
    const trimLuma = 0.2126 * trim.r + 0.7152 * trim.g + 0.0722 * trim.b;
    expect(darkest).toBeCloseTo(trimLuma, 5);
    // Linear, so the numbers are not the display values - what matters is that
    // the torso spans most of the range rather than sitting in one band.
    expect(lightest - darkest).toBeGreaterThan(0.8);

    parts.dispose();
  });
});

/**
 * The stance.
 *
 * The single largest authenticity error on the model, present in every frame of
 * every run: the hip sockets were `[-0.16, 0, 0]` and `[0.16, 0, 0]` - feet
 * side by side across the *narrow* axis of the board, which is a skateboard
 * stance. It is also why the camera looked at a flat back all run.
 */
describe('standing on the board', () => {
  it('puts one foot forward and one back', () => {
    const [leftX, , leftZ] = YETI_JOINTS.hipLeft;
    const [rightX, , rightZ] = YETI_JOINTS.hipRight;

    // Magnitudes first, and each with the socket named: restoring the old
    // `[±0.16, 0, 0]` makes both of these read "expected 0 to be greater than
    // 0.2" against a message that says which joint went flat, rather than the
    // "expected +0 to be -0" a bare sign comparison produces.
    expect(Math.abs(leftZ), 'hipLeft.z: the rear boot must sit along the board').toBeGreaterThan(
      0.2,
    );
    expect(Math.abs(rightZ), 'hipRight.z: the front boot must sit along the board').toBeGreaterThan(
      0.2,
    );
    // Opposite ends of the board, not opposite sides of the rider.
    expect(leftZ * rightZ, 'the boots must sit at opposite ends of the board').toBeLessThan(0);
    // And the fore-aft offset dominates the lateral one, which is the whole
    // difference between a snowboard stance and a skateboard one.
    expect(Math.abs(leftZ)).toBeGreaterThan(Math.abs(leftX) * 2);
    expect(Math.abs(rightZ)).toBeGreaterThan(Math.abs(rightX) * 2);
  });

  it('is a stance along the axis the board is actually long on', () => {
    /*
     * The counterweight. "Feet are offset in Z" only means "along the board"
     * for as long as the board runs down Z - swap the deck's dimensions and
     * the assertion above would keep passing while describing a rider standing
     * sideways across a wide plank.
     */
    const parts = buildDefaultRig();
    const box = parts.board.boundingBox!;
    const width = box.max.x - box.min.x;
    const length = box.max.z - box.min.z;

    expect(length).toBeGreaterThan(width * 2);
    // And both boots land on the deck rather than off either end of it.
    expect(Math.abs(YETI_JOINTS.hipLeft[2])).toBeLessThan(length / 2);
    expect(Math.abs(YETI_JOINTS.hipRight[2])).toBeLessThan(length / 2);

    parts.dispose();
  });

  it('keeps the soles on the deck through every squash the pose can apply', () => {
    /*
     * `torso.scale.y` carries the slide crouch, the landing fold and the
     * take-off extension, and it scales the legs about the *hips* - so without
     * `hipHeightFor` a compression lifts the boots off a board that has not
     * moved. It was shipped that way: a slide squashes to 0.425 and left them
     * hovering 28 cm above the deck for the whole 0.7 s.
     *
     * Not a restatement of `hipHeightFor`'s own arithmetic - both ends are read
     * off the real merged geometry. The leg's reach comes from its bounding
     * box and the deck's height from the board's, so `FOOT_REACH` drifting away
     * from the leg it describes, a thicker deck, or a change to `FIGURE_SCALE`
     * all fail here rather than shipping a hovering rider.
     */
    const parts = buildDefaultRig();
    // Underside of the boot, at the knee bend `FOOT_REACH` is measured at.
    const soleLocal = parts.leg.boundingBox!.min.y * Math.cos(RIDING_LEG_PITCH);
    const deckTop = YETI_JOINTS.board[1] + parts.board.boundingBox!.max.y;

    const slideCrouch = TUNING.player.slideHalfHeight / TUNING.player.halfHeight;
    const squashes = [
      FIGURE_SCALE,
      FIGURE_SCALE * slideCrouch,
      FIGURE_SCALE * (1 - RIDER.landingCompress),
      FIGURE_SCALE * (1 + RIDER.takeoffExtend),
    ];
    // The sweep has to actually sweep, or this is one pose asserted four times.
    expect(Math.max(...squashes) - Math.min(...squashes)).toBeGreaterThan(0.4);

    for (const scaleY of squashes) {
      const sole = hipHeightFor(scaleY) + soleLocal * scaleY;
      expect(Math.abs(sole - deckTop)).toBeLessThan(0.03);
    }

    parts.dispose();
  });
});

describe('rebuilding the rig', () => {
  it('hands back a disposer that releases everything it allocated', () => {
    /*
     * `Player` rebuilds the whole rig on every equip, and three frees nothing
     * on garbage collection. Because `App` is the router's root route the
     * Canvas survives navigation, so without this the shop - five riders
     * against five boards, on the screen players idle on longest - strands a
     * complete set of geometries and a shader program per browse.
     *
     * Asserted by enumeration rather than against a list of six names, which
     * is the same reason `dispose` itself enumerates: a seventh part that
     * nobody remembered to add to a list is exactly the leak this is for.
     */
    const parts = buildDefaultRig();
    const geometries = Object.values(parts).filter(
      (value): value is THREE.BufferGeometry => value instanceof THREE.BufferGeometry,
    );
    expect(geometries.length).toBeGreaterThanOrEqual(6);

    const released = new Set<THREE.BufferGeometry>();
    for (const geometry of geometries) {
      geometry.addEventListener('dispose', () => released.add(geometry));
    }
    let materialReleased = false;
    parts.material.addEventListener('dispose', () => {
      materialReleased = true;
    });

    parts.dispose();

    expect(released.size).toBe(geometries.length);
    expect(materialReleased).toBe(true);
  });
});
