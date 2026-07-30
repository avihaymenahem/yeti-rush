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
  /**
   * The gilet shell over the chest and back.
   *
   * Clothing, not darker fur, and that distinction is the whole reason these
   * two fields exist. The rider is the thing a player looks at for a whole run
   * and every visible surface on it used to sit above 0.9 luminance except the
   * goggle band - so it had no silhouette against a snowfield, which is the one
   * background it is guaranteed to be seen on. Shading the *fur* down to fix
   * that reads as a dirty animal rather than a dressed one, so the deep values
   * go on garments the yeti is wearing and the coat stays white.
   *
   * Every one of these is under 0.25 display luminance, asserted in
   * `tests/characters.test.ts`. That is far below anything else in the frame -
   * the piste sits near 0.68 - which makes the rider the darkest thing on
   * screen and is exactly what a figure needs to separate.
   */
  garment: string;
  /** Harness straps and the waist belt. Darker again than the shell. */
  garmentTrim: string;
}

export const DEFAULT_CHARACTER = 'yeti';

export const CHARACTERS = {
  yeti: {
    id: 'yeti',
    name: 'Yeti',
    tagline: 'The original. Cold-blooded in every sense.',
    price: 0,
    fur: '#f7fbfe',
    /**
     * Dropped from `#dbe9f3`, which was not a shade of anything.
     *
     * At 0.905 display luminance against a 0.981 coat it was the same white
     * seven points down - so the belly, the shoulder ruff, the waist skirt, the
     * arms, the muzzle and the jaw fringe, which is most of the model's
     * surface, were all one flat value. This sits just under the piste, so the
     * fur that is *not* catching the sun now reads darker than the snow behind
     * it and the shaggy outline has an edge for the first time.
     */
    furShade: '#8ba1b4',
    face: '#2b3d4a',
    accent: '#2fa8e0',
    garment: '#1d2f42',
    garmentTrim: '#16212c',
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
    // Waxed canvas rather than the yeti's technical navy, to match the amber.
    garment: '#2b2620',
    garmentTrim: '#1a2027',
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
    garment: '#2a2140',
    garmentTrim: '#221f36',
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
    garment: '#43241a',
    garmentTrim: '#301e16',
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
    garment: '#152c3d',
    garmentTrim: '#122535',
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
