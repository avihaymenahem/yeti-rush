/**
 * The shop's section tabs.
 *
 * Tabs are not free. They trade a page you have to scroll for a page whose
 * contents are *hidden*, and hiding two thirds of a shop is how a player ends
 * up never learning the riders exist. The dot on each tab is what pays that
 * back, so what is tested here is the dot's honesty rather than the tabs.
 *
 * Both failure modes matter and they point opposite ways. A dot on something
 * unaffordable is a nag; a dot on a section where everything is already owned
 * is a lie. Either one teaches the player to stop looking at dots, and then the
 * dot on the section they *could* have bought from is ignored too.
 */

import { describe, expect, it } from 'vitest';
import { CHARACTER_IDS, characterDef, DEFAULT_CHARACTER } from '@/game/content/characters';
import { POWER_UP_IDS, UPGRADE_MAX_LEVEL, upgradePrice } from '@/game/content/powerUps';
import { hasAffordable, SHOP_TABS, type ShopWallet } from '@/game/content/shopTabs';
import { DEFAULT_SKIN } from '@/game/state/saveSchema';
import { skinsForSale } from '@/game/content/skins';

/** A player who owns only the free defaults. */
function newPlayer(coins: number): ShopWallet {
  return {
    coins,
    ownedSkins: [DEFAULT_SKIN],
    ownedCharacters: [DEFAULT_CHARACTER],
    upgrades: {},
  };
}

/** A player who owns everything there is. */
function completionist(coins: number): ShopWallet {
  const upgrades: Record<string, number> = {};
  for (const id of POWER_UP_IDS) upgrades[id] = UPGRADE_MAX_LEVEL;

  return {
    coins,
    ownedSkins: skinsForSale().map((skin) => skin.id),
    ownedCharacters: [...CHARACTER_IDS],
    upgrades,
  };
}

const cheapestBoard = Math.min(
  ...skinsForSale()
    .map((skin) => skin.price)
    .filter((price) => price > 0),
);
const cheapestRider = Math.min(
  ...CHARACTER_IDS.map((id) => characterDef(id).price).filter((price) => price > 0),
);

describe('with an empty wallet', () => {
  it('marks nothing at all', () => {
    // The nag case. A dot the player cannot act on is worse than no dot,
    // because it costs them a tap to find that out.
    for (const tab of SHOP_TABS) {
      expect(hasAffordable(tab.id, newPlayer(0))).toBe(false);
    }
  });
});

describe('with enough for something', () => {
  it('marks the boards once one is within reach', () => {
    expect(hasAffordable('boards', newPlayer(cheapestBoard - 1))).toBe(false);
    expect(hasAffordable('boards', newPlayer(cheapestBoard))).toBe(true);
  });

  it('marks the riders once one is within reach', () => {
    expect(hasAffordable('riders', newPlayer(cheapestRider - 1))).toBe(false);
    expect(hasAffordable('riders', newPlayer(cheapestRider))).toBe(true);
  });

  it('marks the power-ups from the first level', () => {
    const price = upgradePrice(0);
    expect(hasAffordable('powerUps', newPlayer(price - 1))).toBe(false);
    expect(hasAffordable('powerUps', newPlayer(price))).toBe(true);
  });
});

describe('with everything already owned', () => {
  it('marks nothing, however rich the player is', () => {
    // The lie case, and the one a naive "can they afford the price" check gets
    // wrong - it would leave every tab dotted for ever once the shop is cleared.
    for (const tab of SHOP_TABS) {
      expect(hasAffordable(tab.id, completionist(999_999))).toBe(false);
    }
  });

  it('marks the power-ups again if a level is somehow missing', () => {
    // The counterweight to the test above: it must be checking each item's own
    // state rather than a single "done" flag.
    const save = completionist(999_999);
    const first = POWER_UP_IDS[0] as string;
    expect(hasAffordable('powerUps', { ...save, upgrades: { ...save.upgrades, [first]: 0 } })).toBe(
      true,
    );
  });
});

describe('the tab set', () => {
  it('covers every section of the shop exactly once', () => {
    const ids = SHOP_TABS.map((tab) => tab.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(['boards', 'riders', 'powerUps']);
  });

  it('gives every tab a label', () => {
    for (const tab of SHOP_TABS) expect(tab.label.length).toBeGreaterThan(0);
  });
});
