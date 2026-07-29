/**
 * Who you ride as.
 *
 * A second axis to the shop, and deliberately a *cosmetic* one. Boards carry
 * the handling stats and always will; a character that also changed how the
 * game plays would double the balance surface for no gain, and would make the
 * one thing players pick for personality into a thing they have to pick for
 * performance.
 *
 * Splitting them fixed something that had been quietly wrong: the rider's fur
 * used to be part of the *board*, so buying a snowboard changed the colour of
 * the yeti wearing it. Boards now own the deck and its trim, characters own
 * everything above it, and the two are chosen independently.
 *
 * Colours only, on one shared mesh - so a new character costs nothing at
 * runtime and no new geometry. `saveSchema` guarantees the default is owned.
 */

export interface CharacterDef {
  id: string;
  name: string;
  /** One line of personality, shown in the shop. */
  tagline: string;
  /** Coins to unlock. Zero means owned from the start. */
  price: number;
  /** Main coat. */
  fur: string;
  /** Deeper tone for limbs, muzzle and the shaggy fringe. */
  furShade: string;
  /** Eyes, nose, and the dark band of the goggles. */
  face: string;
  /** Goggle lenses and the scarf - the one flash of colour on the rider. */
  accent: string;
}

export const DEFAULT_CHARACTER = 'yeti';

export const CHARACTERS = {
  yeti: {
    id: 'yeti',
    name: 'Yeti',
    tagline: 'The original. Cold-blooded in every sense.',
    price: 0,
    fur: '#f7fbfe',
    furShade: '#dbe9f3',
    face: '#2b3d4a',
    accent: '#2fa8e0',
  },

  /** Older, greyer, and unimpressed by any of this. */
  elder: {
    id: 'elder',
    name: 'Elder',
    tagline: 'Been riding this mountain since before the lifts.',
    price: 900,
    fur: '#d9dfe6',
    furShade: '#a9b6c4',
    face: '#333e49',
    accent: '#c47b2c',
  },

  /** The one that comes down at dusk and is only ever seen from behind. */
  shadow: {
    id: 'shadow',
    name: 'Shadow',
    tagline: 'Nobody has ever got a clear photograph.',
    price: 2400,
    fur: '#4d5a6b',
    furShade: '#38424f',
    face: '#151d26',
    accent: '#8f6fd6',
  },

  /** Volcanic, and entirely out of place on a glacier. */
  ember: {
    id: 'ember',
    name: 'Ember',
    tagline: 'Melts the landing. Regrets nothing.',
    price: 4800,
    fur: '#f0a04b',
    furShade: '#c9662b',
    face: '#3a1f14',
    accent: '#ffd35c',
  },

  /** Not fur at all. */
  frost: {
    id: 'frost',
    name: 'Frost',
    tagline: 'Carved from the mountain rather than born on it.',
    price: 9000,
    fur: '#a8e4f5',
    furShade: '#6ab6d8',
    face: '#123a5c',
    accent: '#ffffff',
  },
} as const satisfies Record<string, CharacterDef>;

export type CharacterId = keyof typeof CHARACTERS;

export const CHARACTER_IDS = Object.keys(CHARACTERS) as CharacterId[];

/**
 * Looks a character up, falling back to the default.
 *
 * Forgiving on purpose: a save naming a character that no longer exists must
 * load and play rather than throw, exactly as `skinDef` does for boards.
 */
export function characterDef(id: string): CharacterDef {
  return CHARACTERS[id as CharacterId] ?? CHARACTERS[DEFAULT_CHARACTER];
}
