/**
 * Daily missions.
 *
 * Three objectives rolled per local day from a fixed pool, seeded by the date
 * so the same day always produces the same set - a player who reinstalls, or
 * who plays on two devices, sees the same missions rather than a free re-roll.
 *
 * Progress accumulates across runs, so a mission is a reason to start another
 * run rather than something to chase within one.
 */

import { createRng, type Rng } from '@/game/core/rng';

/** The run statistics a mission can be measured against. */
export interface RunStats {
  distance: number;
  coins: number;
  bestCombo: number;
  rampLaunches: number;
  powerUpsCollected: number;
  phased: number;
  runs: number;
}

export type MissionMetric = keyof RunStats;

export interface MissionDef {
  id: string;
  metric: MissionMetric;
  /** Candidate targets, easiest first. One is picked when rolling. */
  targets: readonly number[];
  /** Coins awarded on completion. */
  reward: number;
  describe: (target: number) => string;
}

export const MISSION_POOL: readonly MissionDef[] = [
  {
    id: 'distance',
    metric: 'distance',
    targets: [1500, 2500, 4000],
    reward: 216,
    describe: (target) => `Ride ${target.toLocaleString()} m in total`,
  },
  {
    id: 'coins',
    metric: 'coins',
    targets: [150, 300, 500],
    reward: 180,
    describe: (target) => `Collect ${target} coins`,
  },
  {
    id: 'combo',
    metric: 'bestCombo',
    targets: [20, 35, 50],
    reward: 252,
    describe: (target) => `Clear ${target} obstacles without a slip`,
  },
  {
    id: 'ramps',
    metric: 'rampLaunches',
    targets: [5, 10, 18],
    reward: 234,
    describe: (target) => `Launch off ${target} ramps`,
  },
  {
    id: 'powerups',
    metric: 'powerUpsCollected',
    targets: [3, 6, 10],
    reward: 198,
    describe: (target) => `Grab ${target} power-ups`,
  },
  {
    // Id kept as `smash` from when the board destroyed obstacles rather than
    // phasing through them. It is the key today's mission progress is saved
    // under, so renaming it would reset any player mid-mission.
    id: 'smash',
    metric: 'phased',
    targets: [8, 15, 25],
    reward: 270,
    describe: (target) => `Ride through ${target} obstacles on the ghost board`,
  },
  {
    id: 'runs',
    metric: 'runs',
    targets: [3, 5, 8],
    reward: 162,
    describe: (target) => `Finish ${target} runs`,
  },
] as const;

export const MISSIONS_PER_DAY = 3;

export interface MissionInstance {
  id: string;
  metric: MissionMetric;
  target: number;
  reward: number;
  description: string;
}

export function missionDef(id: string): MissionDef | undefined {
  return MISSION_POOL.find((mission) => mission.id === id);
}

/**
 * Rolls a day's missions. Distinct objectives, and the target scales with how
 * far into the pool the pick landed so a day is not always three easy ones.
 */
export function rollMissions(rng: Rng, count = MISSIONS_PER_DAY): MissionInstance[] {
  const pool = [...MISSION_POOL];
  const chosen: MissionInstance[] = [];

  const total = Math.min(count, pool.length);
  for (let i = 0; i < total; i++) {
    const index = rng.int(pool.length);
    const def = pool.splice(index, 1)[0] as MissionDef;
    const target = def.targets[rng.int(def.targets.length)] as number;

    chosen.push({
      id: def.id,
      metric: def.metric,
      target,
      reward: def.reward,
      description: def.describe(target),
    });
  }

  return chosen;
}

/** Rolls the missions for a given local date. Same date, same missions. */
export function missionsForDate(seed: number, count = MISSIONS_PER_DAY): MissionInstance[] {
  return rollMissions(createRng(seed), count);
}

export function isComplete(mission: MissionInstance, progress: number): boolean {
  return progress >= mission.target;
}

/** Progress as a fraction in [0, 1], for the progress bar. */
export function progressFraction(mission: MissionInstance, progress: number): number {
  if (mission.target <= 0) return 1;
  return Math.max(0, Math.min(1, progress / mission.target));
}

/**
 * Folds a finished run's statistics into stored mission progress.
 *
 * Cumulative metrics add up across runs; `bestCombo` is a personal best within
 * a single run, so it takes the maximum instead - adding combos from separate
 * runs would make a "50 without a slip" mission trivially completable.
 */
export function applyRunToProgress(
  missions: readonly MissionInstance[],
  progress: Readonly<Record<string, number>>,
  stats: RunStats,
): Record<string, number> {
  const updated: Record<string, number> = { ...progress };

  for (const mission of missions) {
    const current = updated[mission.id] ?? 0;
    const value = stats[mission.metric];

    updated[mission.id] =
      mission.metric === 'bestCombo' ? Math.max(current, value) : current + value;
  }

  return updated;
}
