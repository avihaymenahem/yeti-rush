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
  fur: string;
  furShade: string;
  face: string;
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
    fur: '#f7fbfe',
    furShade: '#dbe9f3',
    face: '#2b3d4a',
    board: '#e8663c',
    boardTrim: '#2fa8e0',
  },
  'yeti-glacier': {
    id: 'yeti-glacier',
    name: 'Glacier',
    tagline: 'Carves hard. Gives up a little pace for it.',
    price: 550,
    stats: { speed: 0.95, control: 1.22, grip: 1.05, fortune: 1.0 },
    fur: '#cfeaf7',
    furShade: '#a8d4ea',
    face: '#1d3a4a',
    board: '#2fa8e0',
    boardTrim: '#f7fbfe',
  },
  'yeti-ember': {
    id: 'yeti-ember',
    name: 'Ember',
    tagline: 'Quick off the mark. Less room for error.',
    price: 1600,
    stats: { speed: 1.1, control: 1.0, grip: 0.9, fortune: 1.08 },
    fur: '#f6d7c4',
    furShade: '#e0a583',
    face: '#40251b',
    board: '#c0392b',
    boardTrim: '#f0b429',
  },
  'yeti-midnight': {
    id: 'yeti-midnight',
    name: 'Midnight',
    tagline: 'Shrugs off a slip. The patrol loses interest fast.',
    price: 3600,
    stats: { speed: 0.96, control: 1.1, grip: 1.55, fortune: 1.0 },
    fur: '#4a5a6b',
    furShade: '#33404e',
    face: '#d7b3ff',
    board: '#22303a',
    boardTrim: '#d7b3ff',
  },
  'yeti-aurora': {
    id: 'yeti-aurora',
    name: 'Aurora',
    tagline: 'Coins are worth far more. Trip twice and you are done.',
    price: 7200,
    stats: { speed: 1.05, control: 1.05, grip: 0.85, fortune: 1.3 },
    fur: '#d9f7e8',
    furShade: '#8fe3c4',
    face: '#1f4a3c',
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
