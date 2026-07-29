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

import { beforeEach, describe, expect, it } from 'vitest';
import {
  CHARACTER_IDS,
  characterDef,
  CHARACTERS,
  DEFAULT_CHARACTER,
} from '@/game/content/characters';
import { SKIN_IDS, skinDef } from '@/game/content/skins';
import { useMetaStore } from '@/game/state/metaStore';
import { createDefaultSave, migrate } from '@/game/state/saveSchema';

beforeEach(() => {
  useMetaStore.setState({ save: createDefaultSave() });
});

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

  it('gives every rider four distinct colours', () => {
    // The whole character *is* its palette, so a rider with a duplicate in it
    // is one that reads as a flat silhouette on the slope.
    for (const id of CHARACTER_IDS) {
      const { fur, furShade, face, accent } = characterDef(id);
      expect(new Set([fur, furShade, face, accent]).size).toBe(4);
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
      ]);
    }
  });

  it('leaves the board colours to the board', () => {
    // The split that stopped a snowboard purchase recolouring the rider.
    for (const id of SKIN_IDS) {
      const skin = skinDef(id);
      expect(skin.board).toBeTypeOf('string');
      expect(skin.boardTrim).toBeTypeOf('string');
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
