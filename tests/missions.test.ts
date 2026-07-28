import { describe, expect, it } from 'vitest';
import {
  applyRunToProgress,
  isComplete,
  MISSIONS_PER_DAY,
  MISSION_POOL,
  missionDef,
  missionsForDate,
  progressFraction,
  rollMissions,
  type MissionInstance,
  type RunStats,
} from '@/game/content/missions';
import { createRng } from '@/game/core/rng';
import { seedForDate } from '@/game/systems/dailyCycle';

const EMPTY_RUN: RunStats = {
  distance: 0,
  coins: 0,
  bestCombo: 0,
  rampLaunches: 0,
  powerUpsCollected: 0,
  phased: 0,
  runs: 0,
};

describe('mission pool', () => {
  it('has more entries than a day needs, so days differ', () => {
    expect(MISSION_POOL.length).toBeGreaterThan(MISSIONS_PER_DAY);
  });

  it('gives every mission a unique id, targets and a reward', () => {
    const ids = MISSION_POOL.map((mission) => mission.id);
    expect(new Set(ids).size).toBe(ids.length);

    for (const mission of MISSION_POOL) {
      expect(mission.targets.length).toBeGreaterThan(0);
      expect(mission.reward).toBeGreaterThan(0);
      for (const target of mission.targets) expect(target).toBeGreaterThan(0);
    }
  });

  it('orders every target list from easiest to hardest', () => {
    for (const mission of MISSION_POOL) {
      const sorted = [...mission.targets].sort((a, b) => a - b);
      expect([...mission.targets]).toEqual(sorted);
    }
  });

  it('describes every target readably', () => {
    for (const mission of MISSION_POOL) {
      for (const target of mission.targets) {
        const text = mission.describe(target);
        expect(text.length).toBeGreaterThan(4);
        // The number has to actually appear, or the player cannot tell them apart.
        expect(text).toMatch(/\d/);
      }
    }
  });

  it('looks up by id', () => {
    expect(missionDef(MISSION_POOL[0]!.id)).toBe(MISSION_POOL[0]);
    expect(missionDef('nonexistent')).toBeUndefined();
  });
});

describe('rollMissions', () => {
  it('rolls the requested number', () => {
    expect(rollMissions(createRng(1))).toHaveLength(MISSIONS_PER_DAY);
  });

  it('never repeats a mission within a day', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const ids = rollMissions(createRng(seed)).map((mission) => mission.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('only ever picks targets the mission actually declares', () => {
    for (let seed = 1; seed <= 200; seed++) {
      for (const mission of rollMissions(createRng(seed))) {
        const def = missionDef(mission.id)!;
        expect(def.targets).toContain(mission.target);
      }
    }
  });

  it('cannot roll more missions than the pool holds', () => {
    expect(rollMissions(createRng(1), 999)).toHaveLength(MISSION_POOL.length);
  });

  it('is deterministic for a seed', () => {
    expect(rollMissions(createRng(42))).toEqual(rollMissions(createRng(42)));
  });
});

describe('missionsForDate', () => {
  it('gives the same set all day', () => {
    const seed = seedForDate('2026-07-27');
    expect(missionsForDate(seed)).toEqual(missionsForDate(seed));
  });

  it('gives a different set on a different day', () => {
    const today = missionsForDate(seedForDate('2026-07-27'));
    // Compare against a spread of days: two adjacent days can legitimately
    // share a roll, but a whole week should not.
    const otherDays = ['2026-07-28', '2026-07-29', '2026-07-30', '2026-08-01', '2026-08-05'].map(
      (date) => JSON.stringify(missionsForDate(seedForDate(date))),
    );
    expect(new Set([JSON.stringify(today), ...otherDays]).size).toBeGreaterThan(1);
  });
});

describe('completion', () => {
  const mission: MissionInstance = {
    id: 'coins',
    metric: 'coins',
    target: 100,
    reward: 50,
    description: 'Collect 100 coins',
  };

  it('is incomplete below the target', () => {
    expect(isComplete(mission, 99)).toBe(false);
  });

  it('is complete at and above the target', () => {
    expect(isComplete(mission, 100)).toBe(true);
    expect(isComplete(mission, 250)).toBe(true);
  });

  it('reports a fraction clamped to [0, 1]', () => {
    expect(progressFraction(mission, 0)).toBe(0);
    expect(progressFraction(mission, 50)).toBeCloseTo(0.5);
    expect(progressFraction(mission, 500)).toBe(1);
    expect(progressFraction(mission, -20)).toBe(0);
  });
});

describe('applyRunToProgress', () => {
  const coinMission: MissionInstance = {
    id: 'coins',
    metric: 'coins',
    target: 100,
    reward: 50,
    description: 'Collect 100 coins',
  };
  const comboMission: MissionInstance = {
    id: 'combo',
    metric: 'bestCombo',
    target: 30,
    reward: 90,
    description: 'Clear 30 obstacles without a slip',
  };

  it('accumulates cumulative metrics across runs', () => {
    let progress: Record<string, number> = {};
    progress = applyRunToProgress([coinMission], progress, { ...EMPTY_RUN, coins: 40 });
    progress = applyRunToProgress([coinMission], progress, { ...EMPTY_RUN, coins: 35 });
    expect(progress['coins']).toBe(75);
  });

  it('takes the best, not the sum, for a personal-best metric', () => {
    // Summing combos from separate runs would make "30 without a slip" trivial.
    let progress: Record<string, number> = {};
    progress = applyRunToProgress([comboMission], progress, { ...EMPTY_RUN, bestCombo: 18 });
    progress = applyRunToProgress([comboMission], progress, { ...EMPTY_RUN, bestCombo: 12 });
    expect(progress['combo']).toBe(18);

    progress = applyRunToProgress([comboMission], progress, { ...EMPTY_RUN, bestCombo: 25 });
    expect(progress['combo']).toBe(25);
  });

  it('does not mutate the progress it was given', () => {
    const original: Record<string, number> = { coins: 10 };
    applyRunToProgress([coinMission], original, { ...EMPTY_RUN, coins: 5 });
    expect(original['coins']).toBe(10);
  });

  it("leaves missions outside today's set untouched", () => {
    const progress = applyRunToProgress([coinMission], { ramps: 4 }, {
      ...EMPTY_RUN,
      coins: 10,
      rampLaunches: 3,
    });
    expect(progress['ramps']).toBe(4);
  });

  it('counts a finished run for a run-count mission', () => {
    const runMission: MissionInstance = {
      id: 'runs',
      metric: 'runs',
      target: 3,
      reward: 90,
      description: 'Finish 3 runs',
    };

    let progress: Record<string, number> = {};
    for (let i = 0; i < 3; i++) {
      progress = applyRunToProgress([runMission], progress, { ...EMPTY_RUN, runs: 1 });
    }
    expect(progress['runs']).toBe(3);
    expect(isComplete(runMission, progress['runs']!)).toBe(true);
  });

  it('handles a full day of missions at once', () => {
    const missions = missionsForDate(seedForDate('2026-07-27'));
    const progress = applyRunToProgress(missions, {}, {
      distance: 1200,
      coins: 80,
      bestCombo: 22,
      rampLaunches: 4,
      powerUpsCollected: 2,
      phased: 6,
      runs: 1,
    });

    for (const mission of missions) {
      expect(progress[mission.id]).toBeGreaterThan(0);
    }
  });
});
