/**
 * The shop's three sections, and what is worth buying in each.
 *
 * Split out of the component because of what tabs cost: they trade a long page
 * for a page whose contents are *hidden*. A player scrolling past the riders
 * discovers them; a player who never taps the Riders tab never learns they
 * exist. So each tab carries a dot when it holds something unowned the player
 * can afford right now - which is the discoverability the scroll used to give
 * for free, only louder.
 *
 * Pure, and here rather than in `app/`, so the rule can be tested without
 * rendering anything.
 */

import { CHARACTER_IDS, characterDef } from '@/game/content/characters';
import { POWER_UP_IDS, UPGRADE_MAX_LEVEL, upgradePrice } from '@/game/content/powerUps';
import { skinsForSale } from '@/game/content/skins';

export const SHOP_TABS = [
  { id: 'boards', label: 'Boards' },
  { id: 'riders', label: 'Riders' },
  { id: 'powerUps', label: 'Power-ups' },
] as const;

export type ShopTab = (typeof SHOP_TABS)[number]['id'];

/** The parts of the save this needs. Narrow, so tests need not build a whole one. */
export interface ShopWallet {
  coins: number;
  ownedSkins: readonly string[];
  ownedCharacters: readonly string[];
  upgrades: Readonly<Record<string, number>>;
}

/**
 * Whether a tab holds anything the player could buy right now.
 *
 * Deliberately "unowned *and* affordable" rather than either alone. A dot on
 * something unaffordable is a nag, and one on a tab where everything is already
 * owned is a lie - both train the player to ignore it, which is worse than
 * having no dot at all.
 */
export function hasAffordable(tab: ShopTab, save: ShopWallet): boolean {
  switch (tab) {
    case 'boards':
      return skinsForSale().some(
        (skin) => !save.ownedSkins.includes(skin.id) && save.coins >= skin.price,
      );

    case 'riders':
      return CHARACTER_IDS.some((id) => {
        const character = characterDef(id);
        return !save.ownedCharacters.includes(id) && save.coins >= character.price;
      });

    case 'powerUps':
      return POWER_UP_IDS.some((id) => {
        const level = save.upgrades[id] ?? 0;
        return level < UPGRADE_MAX_LEVEL && save.coins >= upgradePrice(level);
      });
  }
}
