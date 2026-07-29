/**
 * Persisted save data: shape, defaults and migration.
 *
 * Kept free of any I/O so it unit-tests as pure logic; `@/platform/storage`
 * does the reading and writing. `migrate` must never throw - a corrupt or
 * hand-edited save has to degrade to defaults rather than brick the app.
 */

import { DEFAULT_CHARACTER } from '@/game/content/characters';
import { DEFAULT_MODE } from '@/game/content/modes';

export const SAVE_VERSION = 1;
export const SAVE_KEY = 'yeti-rush:save';

/** One entry in the local leaderboard. */
export interface ScoreEntry {
  score: number;
  distance: number;
  coins: number;
  /** Mode the run was set in. Scores are ranked per mode, never pooled. */
  mode: string;
  /** Board the run was set on, so the table shows what it was achieved with. */
  skin: string;
  /** Local date (YYYY-MM-DD) the run happened. */
  date: string | null;
}

/** How many runs the local leaderboard keeps, per mode. */
export const LEADERBOARD_SIZE = 10;

export interface SaveData {
  version: number;
  /** Persistent wallet, spent in the shop. */
  coins: number;
  highScore: number;
  bestDistance: number;
  totalRuns: number;
  /**
   * Best runs, highest first. Local only - the game has no backend, so this is
   * the player's own history rather than a global ranking.
   */
  leaderboard: ScoreEntry[];
  ownedSkins: string[];
  equippedSkin: string;
  /** Characters unlocked. The default is always present; load enforces it. */
  ownedCharacters: string[];
  equippedCharacter: string;
  /** Power-up upgrade levels, keyed by power-up id. */
  upgrades: Record<string, number>;
  /** Active daily missions, keyed by mission id, value is progress so far. */
  missions: Record<string, number>;
  /** Ids of today's missions whose reward has already been paid out. */
  missionsClaimed: string[];
  /** Local date (YYYY-MM-DD) the current mission set was rolled on. */
  missionsRolledOn: string | null;
  /** Local date (YYYY-MM-DD) the daily reward was last claimed. */
  lastDailyClaim: string | null;
  /** Consecutive days claimed, for escalating daily rewards. */
  dailyStreak: number;
  /**
   * Whether the opening coach has run.
   *
   * A boolean rather than a count: it teaches three inputs once, and a player
   * who has seen it does not need it again. Defaults false for an existing
   * save too, so anyone already playing gets it once and never again - which is
   * cheaper than a migration that has to guess whether they already know how.
   */
  coached: boolean;
  settings: {
    /**
     * Volumes as 0-100 slider positions, not booleans.
     *
     * Zero is off, so there is no separate enabled flag to keep in step with
     * the level - two sources of truth for "is the music on" is exactly how a
     * mute toggle ends up disagreeing with a volume control.
     */
    musicVolume: number;
    sfxVolume: number;
    /** Vibration has no level, only on or off. */
    hapticsEnabled: boolean;
  };
}

export const DEFAULT_SKIN = 'yeti-classic';

export function createDefaultSave(): SaveData {
  return {
    version: SAVE_VERSION,
    coins: 0,
    highScore: 0,
    bestDistance: 0,
    totalRuns: 0,
    leaderboard: [],
    ownedSkins: [DEFAULT_SKIN],
    equippedSkin: DEFAULT_SKIN,
    ownedCharacters: [DEFAULT_CHARACTER],
    equippedCharacter: DEFAULT_CHARACTER,
    upgrades: {},
    missions: {},
    missionsClaimed: [],
    missionsRolledOn: null,
    lastDailyClaim: null,
    dailyStreak: 0,
    coached: false,
    settings: {
      musicVolume: 100,
      sfxVolume: 100,
      hapticsEnabled: true,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Non-negative integer, for counters that must never go backwards or fractional. */
function counter(value: unknown, fallback: number): number {
  const n = num(value, fallback);
  return n < 0 ? fallback : Math.floor(n);
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function str(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function nullableDate(value: unknown): string | null {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

/**
 * A 0-100 volume, migrating the boolean toggle that used to hold this setting.
 *
 * Saves written before the sliders existed carry `musicEnabled`/`sfxEnabled`.
 * An explicit `false` there meant the player had deliberately turned that sound
 * off, and silently restoring it to full on upgrade would be the rudest
 * possible way to handle it.
 */
function volume(value: unknown, legacyToggle: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.min(100, Math.round(value)));
  }
  if (legacyToggle === false) return 0;
  return fallback;
}

function stringArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  const cleaned = value.filter((item): item is string => typeof item === 'string');
  return cleaned.length > 0 ? Array.from(new Set(cleaned)) : fallback;
}

/**
 * Validates the leaderboard entry by entry, then re-sorts and re-trims it.
 * A hand-edited or truncated save must not be able to produce an unsorted or
 * unbounded table.
 *
 * Trimming is per mode: pooling then trimming would let a strong run in one
 * mode evict the entire history of another.
 */
function scoreEntries(value: unknown): ScoreEntry[] {
  if (!Array.isArray(value)) return [];

  const entries: ScoreEntry[] = [];
  for (const raw of value) {
    if (!isRecord(raw)) continue;
    const score = counter(raw['score'], -1);
    if (score < 0) continue;

    entries.push({
      score,
      distance: Math.max(0, num(raw['distance'], 0)),
      coins: counter(raw['coins'], 0),
      // Entries written before modes existed were all Endless runs.
      mode: str(raw['mode'], DEFAULT_MODE),
      skin: str(raw['skin'], DEFAULT_SKIN),
      date: nullableDate(raw['date']),
    });
  }

  return trimLeaderboard(entries);
}

/** The entries for one mode, highest first. */
export function leaderboardFor(
  entries: readonly ScoreEntry[],
  mode: string,
): ScoreEntry[] {
  return entries.filter((entry) => entry.mode === mode).sort((a, b) => b.score - a.score);
}

/** Best score in a mode, or null if it has never been played. */
export function bestScoreFor(entries: readonly ScoreEntry[], mode: string): number | null {
  const best = leaderboardFor(entries, mode)[0];
  return best ? best.score : null;
}

/** Sorts by score and keeps the top entries of each mode. */
export function trimLeaderboard(entries: readonly ScoreEntry[]): ScoreEntry[] {
  const byMode = new Map<string, ScoreEntry[]>();

  for (const entry of [...entries].sort((a, b) => b.score - a.score)) {
    const bucket = byMode.get(entry.mode) ?? [];
    if (bucket.length < LEADERBOARD_SIZE) {
      bucket.push(entry);
      byMode.set(entry.mode, bucket);
    }
  }

  return [...byMode.values()].flat().sort((a, b) => b.score - a.score);
}

function numberRecord(value: unknown): Record<string, number> {
  if (!isRecord(value)) return {};
  const out: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw === 'number' && Number.isFinite(raw)) out[key] = raw;
  }
  return out;
}

/**
 * Normalises anything into valid save data.
 *
 * Every field is validated individually rather than trusted wholesale, so a
 * save written by an older build - or truncated mid-write - still loads with
 * whatever data survived instead of resetting the player's progress.
 */
export function migrate(raw: unknown): SaveData {
  const defaults = createDefaultSave();
  if (!isRecord(raw)) return defaults;

  const settings = isRecord(raw['settings']) ? raw['settings'] : {};
  const ownedSkins = stringArray(raw['ownedSkins'], defaults.ownedSkins);

  // The default skin must always be owned, or the player can end up with
  // nothing equippable after a bad write.
  if (!ownedSkins.includes(DEFAULT_SKIN)) ownedSkins.unshift(DEFAULT_SKIN);

  const equippedSkin = str(raw['equippedSkin'], DEFAULT_SKIN);

  // The same two rules again for characters. An older save has neither field,
  // so both fall back to the default - which is what every existing player was
  // riding as anyway, since the rider had no identity of its own before this.
  const ownedCharacters = stringArray(raw['ownedCharacters'], defaults.ownedCharacters);
  if (!ownedCharacters.includes(DEFAULT_CHARACTER)) ownedCharacters.unshift(DEFAULT_CHARACTER);
  const equippedCharacter = str(raw['equippedCharacter'], DEFAULT_CHARACTER);

  return {
    version: SAVE_VERSION,
    coins: counter(raw['coins'], defaults.coins),
    highScore: counter(raw['highScore'], defaults.highScore),
    bestDistance: Math.max(0, num(raw['bestDistance'], defaults.bestDistance)),
    totalRuns: counter(raw['totalRuns'], defaults.totalRuns),
    leaderboard: scoreEntries(raw['leaderboard']),
    ownedSkins,
    // Never equip something the player does not own.
    equippedSkin: ownedSkins.includes(equippedSkin) ? equippedSkin : DEFAULT_SKIN,
    ownedCharacters,
    equippedCharacter: ownedCharacters.includes(equippedCharacter)
      ? equippedCharacter
      : DEFAULT_CHARACTER,
    upgrades: numberRecord(raw['upgrades']),
    missions: numberRecord(raw['missions']),
    // Empty is a valid state here, unlike ownedSkins, so no fallback list.
    missionsClaimed: Array.isArray(raw['missionsClaimed'])
      ? Array.from(new Set(raw['missionsClaimed'].filter((id): id is string => typeof id === 'string')))
      : [],
    missionsRolledOn: nullableDate(raw['missionsRolledOn']),
    lastDailyClaim: nullableDate(raw['lastDailyClaim']),
    dailyStreak: counter(raw['dailyStreak'], defaults.dailyStreak),
    coached: raw['coached'] === true,
    settings: {
      musicVolume: volume(
        settings['musicVolume'],
        settings['musicEnabled'],
        defaults.settings.musicVolume,
      ),
      sfxVolume: volume(settings['sfxVolume'], settings['sfxEnabled'], defaults.settings.sfxVolume),
      hapticsEnabled: bool(settings['hapticsEnabled'], defaults.settings.hapticsEnabled),
    },
  };
}

/** Parses a stored JSON string. Returns defaults for null/garbage input. */
export function parseSave(json: string | null): SaveData {
  if (!json) return createDefaultSave();
  try {
    return migrate(JSON.parse(json));
  } catch {
    return createDefaultSave();
  }
}

export function serializeSave(save: SaveData): string {
  return JSON.stringify(save);
}
