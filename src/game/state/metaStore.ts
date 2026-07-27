/**
 * Persisted progression: wallet, records, skins, upgrades, missions, dailies.
 *
 * All the rules live in pure modules (`saveSchema`, `missions`, `dailyCycle`,
 * `powerUps`) and are unit-tested there. This store is the thin layer that
 * holds the current save in memory, exposes it to React, and writes it back.
 *
 * Writes are debounced: a run can complete several mutations in a row (coins,
 * high score, mission progress, run count) and there is no reason to hit
 * storage for each one.
 */

import { create } from 'zustand';
import {
  applyRunToProgress,
  isComplete,
  missionsForDate,
  type MissionInstance,
  type RunStats,
} from '@/game/content/missions';
import { UPGRADE_MAX_LEVEL, upgradePrice, type PowerUpId } from '@/game/content/powerUps';
import { skinDef } from '@/game/content/skins';
import {
  canClaimDaily,
  dailyRewardFor,
  localDateKey,
  nextStreak,
  seedForDate,
  shouldRollMissions,
} from '@/game/systems/dailyCycle';
import {
  createDefaultSave,
  parseSave,
  SAVE_KEY,
  serializeSave,
  trimLeaderboard,
  type SaveData,
  type ScoreEntry,
} from '@/game/state/saveSchema';
import { getItem, setItem } from '@/platform/storage';

/** Milliseconds to coalesce writes over. */
const WRITE_DEBOUNCE = 400;

interface MetaStore {
  save: SaveData;
  /** False until the first load resolves; screens wait on this. */
  loaded: boolean;
  /** Today's missions, regenerated from the date rather than stored. */
  missions: MissionInstance[];

  load: () => Promise<void>;
  /** Applies a finished run: coins, records, run count, mission progress. */
  commitRun: (stats: RunStats & { score: number; mode: string }) => void;
  buySkin: (id: string) => boolean;
  equipSkin: (id: string) => boolean;
  buyUpgrade: (id: PowerUpId) => boolean;
  /** Claims a completed mission's reward. Returns the coins paid, or 0. */
  claimMission: (id: string) => number;
  /** Claims the daily login reward. Returns the coins paid, or 0. */
  claimDaily: () => number;
  /** Toggles an audio or haptics preference. */
  /** Generic in the key so a volume takes a number and vibration takes a boolean. */
  setSetting: <K extends keyof SaveData['settings']>(
    key: K,
    value: SaveData['settings'][K],
  ) => void;
  /** Rolls a new mission set if the local day has changed. */
  refreshDay: (now?: Date) => void;
}

let writeTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Set once the save has been read back from storage.
 *
 * Nothing may be written before that. The store is constructed holding a
 * *default* save, and reading storage is asynchronous - so any mutation that
 * lands in the gap (a fast tap on a settings toggle, a run that somehow
 * finishes first) would persist those defaults straight over the player's real
 * progress. Refusing to write until the load has completed makes destroying a
 * save on startup impossible rather than merely unlikely.
 */
let loadCompleted = false;

function scheduleWrite(save: SaveData): void {
  if (!loadCompleted) return;

  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = setTimeout(() => {
    writeTimer = null;
    void setItem(SAVE_KEY, serializeSave(save));
  }, WRITE_DEBOUNCE);
}

export const useMetaStore = create<MetaStore>((set, get) => ({
  save: createDefaultSave(),
  loaded: false,
  missions: [],

  load: async () => {
    const raw = await getItem(SAVE_KEY);
    set({ save: parseSave(raw), loaded: true });
    // Only now is it safe to persist anything.
    loadCompleted = true;
    get().refreshDay();
  },

  refreshDay: (now = new Date()) => {
    const today = localDateKey(now);
    const { save } = get();

    if (shouldRollMissions(save.missionsRolledOn, today)) {
      // Progress and claims belong to the old day; the new set starts clean.
      const next: SaveData = {
        ...save,
        missions: {},
        missionsClaimed: [],
        missionsRolledOn: today,
      };
      set({ save: next, missions: missionsForDate(seedForDate(today)) });
      scheduleWrite(next);
      return;
    }

    set({ missions: missionsForDate(seedForDate(today)) });
  },

  commitRun: (stats) => {
    const { save, missions } = get();

    const entry: ScoreEntry = {
      score: Math.floor(stats.score),
      distance: stats.distance,
      coins: stats.coins,
      mode: stats.mode,
      skin: save.equippedSkin,
      date: localDateKey(new Date()),
    };

    // Insert then re-sort and trim per mode, so a strong run in one mode can
    // never evict another mode's history.
    const leaderboard = trimLeaderboard([...save.leaderboard, entry]);

    const next: SaveData = {
      ...save,
      coins: save.coins + stats.coins,
      highScore: Math.max(save.highScore, Math.floor(stats.score)),
      bestDistance: Math.max(save.bestDistance, stats.distance),
      totalRuns: save.totalRuns + 1,
      leaderboard,
      missions: applyRunToProgress(missions, save.missions, stats),
    };

    set({ save: next });
    scheduleWrite(next);
  },

  setSetting: (key, value) => {
    const { save } = get();
    if (save.settings[key] === value) return;

    const next: SaveData = { ...save, settings: { ...save.settings, [key]: value } };
    set({ save: next });
    scheduleWrite(next);
  },

  buySkin: (id) => {
    const { save } = get();
    const def = skinDef(id);

    if (save.ownedSkins.includes(id)) return false;
    if (save.coins < def.price) return false;

    const next: SaveData = {
      ...save,
      coins: save.coins - def.price,
      ownedSkins: [...save.ownedSkins, id],
      // Buying it equips it - nobody buys a skin to then not wear it.
      equippedSkin: id,
    };

    set({ save: next });
    scheduleWrite(next);
    return true;
  },

  equipSkin: (id) => {
    const { save } = get();
    if (!save.ownedSkins.includes(id)) return false;
    if (save.equippedSkin === id) return false;

    const next: SaveData = { ...save, equippedSkin: id };
    set({ save: next });
    scheduleWrite(next);
    return true;
  },

  buyUpgrade: (id) => {
    const { save } = get();
    const level = save.upgrades[id] ?? 0;
    if (level >= UPGRADE_MAX_LEVEL) return false;

    const price = upgradePrice(level);
    if (save.coins < price) return false;

    const next: SaveData = {
      ...save,
      coins: save.coins - price,
      upgrades: { ...save.upgrades, [id]: level + 1 },
    };

    set({ save: next });
    scheduleWrite(next);
    return true;
  },

  claimMission: (id) => {
    const { save, missions } = get();
    const mission = missions.find((candidate) => candidate.id === id);
    if (!mission) return 0;
    if (save.missionsClaimed.includes(id)) return 0;
    if (!isComplete(mission, save.missions[id] ?? 0)) return 0;

    const next: SaveData = {
      ...save,
      coins: save.coins + mission.reward,
      missionsClaimed: [...save.missionsClaimed, id],
    };

    set({ save: next });
    scheduleWrite(next);
    return mission.reward;
  },

  claimDaily: () => {
    const { save } = get();
    const today = localDateKey(new Date());
    if (!canClaimDaily(save.lastDailyClaim, today)) return 0;

    const streak = nextStreak(save.lastDailyClaim, today, save.dailyStreak);
    const reward = dailyRewardFor(streak);

    const next: SaveData = {
      ...save,
      coins: save.coins + reward,
      lastDailyClaim: today,
      dailyStreak: streak,
    };

    set({ save: next });
    scheduleWrite(next);
    return reward;
  },
}));

/** Forces any pending write out immediately, e.g. when the app backgrounds. */
export function flushMetaSave(): void {
  if (!loadCompleted || !writeTimer) return;
  clearTimeout(writeTimer);
  writeTimer = null;
  void setItem(SAVE_KEY, serializeSave(useMetaStore.getState().save));
}
