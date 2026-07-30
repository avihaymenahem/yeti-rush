/**
 * Purchasable boards.
 *
 * Each board is a colour scheme *and* a handling profile. The colours are a
 * swap on one shared mesh, so adding a board costs nothing at runtime; the
 * stats are multipliers applied to systems that already exist.
 *
 * The stats are deliberately trade-offs rather than an upgrade ladder. A board
 * that is simply better than the one before it turns the shop into a paywall on
 * the only sensible choice; a board that is faster but twitchier, or forgiving
 * but slow-scoring, is a decision. Nothing here is strictly dominant.
 *
 * The default must stay free and always owned; `saveSchema` enforces that on
 * load.
 */

export interface BoardStats {
  /**
   * World speed multiplier. Faster scores quicker and reaches the hard tiers
   * sooner, at the cost of reaction time.
   */
  speed: number;
  /**
   * Lane-change responsiveness. Above 1 is snappier.
   *
   * Never below 1. A board that steers *slower* than the baseline would make
   * stretches of track unsolvable that the generator has already validated as
   * passable, so the floor is a correctness constraint, not a balance one.
   */
  control: number;
  /** How fast the ski patrol drops back after a trip. Higher is more forgiving. */
  grip: number;
  /** Coin score multiplier. */
  fortune: number;
}

export interface SkinDef {
  id: string;
  name: string;
  /** One line on what this board is for, shown in the shop. */
  tagline: string;
  /** Coins to unlock. Zero means owned from the start. */
  price: number;
  stats: BoardStats;
  /**
   * The deck, and the rails and binding straps on it.
   *
   * The board's *entire* palette, deliberately. There were `fur`, `furShade`
   * and `face` fields here too, left behind when riders were split out into
   * `characters.ts` - dead from the moment of that split, because `buildYeti`
   * has read every colour above the deck off the character ever since.
   *
   * They are deleted rather than merely left unread. For as long as a board
   * could name a fur colour, the bug the split was made to end - buying a
   * snowboard changing the colour of the yeti riding it - stayed *representable*,
   * one careless destructure away from returning, and a new board would be
   * authored with three colours that do nothing. `tests/characters.test.ts`
   * asserts a board carries no rider colour, so they cannot drift back either.
   */
  board: string;
  boardTrim: string;
}

export const NEUTRAL_STATS: BoardStats = { speed: 1, control: 1, grip: 1, fortune: 1 };

export const SKINS = {
  'yeti-classic': {
    id: 'yeti-classic',
    name: 'Classic',
    tagline: 'No tricks. Balanced everywhere.',
    price: 0,
    stats: { speed: 1.0, control: 1.0, grip: 1.0, fortune: 1.0 },
    board: '#e8663c',
    boardTrim: '#2fa8e0',
  },
  'yeti-glacier': {
    id: 'yeti-glacier',
    name: 'Glacier',
    tagline: 'Carves hard. Gives up a little pace for it.',
    price: 550,
    stats: { speed: 0.95, control: 1.22, grip: 1.05, fortune: 1.0 },
    board: '#2fa8e0',
    boardTrim: '#f7fbfe',
  },
  'yeti-ember': {
    id: 'yeti-ember',
    name: 'Ember',
    tagline: 'Quick off the mark. Less room for error.',
    price: 1600,
    stats: { speed: 1.1, control: 1.0, grip: 0.9, fortune: 1.08 },
    board: '#c0392b',
    boardTrim: '#f0b429',
  },
  'yeti-midnight': {
    id: 'yeti-midnight',
    name: 'Midnight',
    tagline: 'Shrugs off a slip. The patrol loses interest fast.',
    price: 3600,
    stats: { speed: 0.96, control: 1.1, grip: 1.55, fortune: 1.0 },
    board: '#22303a',
    boardTrim: '#d7b3ff',
  },
  'yeti-aurora': {
    id: 'yeti-aurora',
    name: 'Aurora',
    tagline: 'Coins are worth far more. Trip twice and you are done.',
    price: 7200,
    stats: { speed: 1.05, control: 1.05, grip: 0.85, fortune: 1.3 },
    board: '#5be584',
    boardTrim: '#d7b3ff',
  },
} as const satisfies Record<string, SkinDef>;

export type SkinId = keyof typeof SKINS;

export const SKIN_IDS = Object.keys(SKINS) as SkinId[];

export function skinDef(id: string): SkinDef {
  return (SKINS as Record<string, SkinDef>)[id] ?? SKINS['yeti-classic'];
}

/** Shop order: cheapest first, so the next goal is always at the top. */
export function skinsForSale(): SkinDef[] {
  return SKIN_IDS.map((id) => SKINS[id]).sort((a, b) => a.price - b.price);
}

// --- Worst-case bounds ------------------------------------------------------
// The track generator guarantees every stretch is passable, and that guarantee
// has to hold for whichever board the player has equipped - not just the
// baseline. These describe the hardest configuration any board can produce, and
// the solvability tests validate against them.

/** The highest world speed any board can reach. */
export function worstCaseSpeed(baseMaxSpeed: number): number {
  const fastest = SKIN_IDS.reduce((max, id) => Math.max(max, SKINS[id].stats.speed), 1);
  return baseMaxSpeed * fastest;
}

/** The longest a lane change can take on any board. */
export function worstCaseLaneChangeDuration(baseDuration: number): number {
  const slowest = SKIN_IDS.reduce((min, id) => Math.min(min, SKINS[id].stats.control), 1);
  return baseDuration / slowest;
}
