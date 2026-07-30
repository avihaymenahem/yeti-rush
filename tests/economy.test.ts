/**
 * Shop economy: skins and power-up upgrades.
 *
 * The rules that stop a player ending up in a broken state - negative coins, an
 * equipped skin they do not own, an upgrade past the cap - are the ones worth
 * pinning down, because each of them corrupts a save rather than just annoying
 * someone once.
 */

import { describe, expect, it } from 'vitest';
import type { MissionInstance, RunStats } from '@/game/content/missions';
import {
  durationsFor,
  POWER_UP_IDS,
  powerUpDef,
  UPGRADE_MAX_LEVEL,
  upgradedDuration,
  upgradePrice,
} from '@/game/content/powerUps';
import {
  NEUTRAL_STATS,
  SKIN_IDS,
  skinDef,
  skinsForSale,
  SKINS,
  worstCaseLaneChangeDuration,
  worstCaseSpeed,
} from '@/game/content/skins';
import { useMetaStore } from '@/game/state/metaStore';
import { createDefaultSave, DEFAULT_SKIN } from '@/game/state/saveSchema';

describe('skins', () => {
  it('keys every entry by its own id', () => {
    for (const id of SKIN_IDS) expect(SKINS[id].id).toBe(id);
  });

  it('includes the default skin, free of charge', () => {
    expect(SKIN_IDS).toContain(DEFAULT_SKIN);
    expect(skinDef(DEFAULT_SKIN).price).toBe(0);
  });

  it('prices every other skin above zero', () => {
    for (const id of SKIN_IDS) {
      if (id === DEFAULT_SKIN) continue;
      expect(skinDef(id).price).toBeGreaterThan(0);
    }
  });

  /*
   * The deck palette, and only the deck palette.
   *
   * This used to walk `fur`, `furShade` and `face` as well, which is the shape
   * of a bug rather than a guarantee: riders were split out into
   * `characters.ts` and those three have been dead ever since, so the test was
   * requiring every future board to carry three colours that do nothing - and
   * keeping "buying a snowboard recolours the yeti riding it" representable in
   * the type. They are gone from `SkinDef`, so the assertion is rewritten to
   * what a board actually owns rather than relaxed to whatever still compiles.
   */
  it('gives every skin a complete, valid deck palette and no rider colour', () => {
    const hex = /^#[0-9a-fA-F]{6}$/;
    for (const id of SKIN_IDS) {
      const skin = skinDef(id);
      for (const colour of [skin.board, skin.boardTrim]) {
        expect(colour).toMatch(hex);
      }
      // The counterweight: "every colour is a valid hex" is satisfied perfectly
      // by a board that has quietly grown a fur colour again, which is exactly
      // the state this codebase was in for four releases.
      expect(Object.keys(skin).filter((key) => /fur|face|skin|rider/i.test(key))).toEqual([]);
    }
  });

  it('falls back to the default for an unknown id rather than crashing', () => {
    expect(skinDef('does-not-exist').id).toBe(DEFAULT_SKIN);
  });

  it('lists cheapest first, so the next goal is at the top', () => {
    const prices = skinsForSale().map((skin) => skin.price);
    expect([...prices]).toEqual([...prices].sort((a, b) => a - b));
  });

  it('lists every skin exactly once', () => {
    expect(skinsForSale()).toHaveLength(SKIN_IDS.length);
  });
});

describe('board stats', () => {
  it('gives every board a complete, positive stat block', () => {
    for (const id of SKIN_IDS) {
      const { stats } = skinDef(id);
      for (const value of [stats.speed, stats.control, stats.grip, stats.fortune]) {
        expect(Number.isFinite(value)).toBe(true);
        expect(value).toBeGreaterThan(0);
      }
    }
  });

  it('leaves the default board completely neutral', () => {
    expect(skinDef(DEFAULT_SKIN).stats).toEqual(NEUTRAL_STATS);
  });

  it('never lets a board steer slower than the baseline', () => {
    // A board below 1 control would make stretches of track unsolvable that
    // the generator has already validated as passable. This is a correctness
    // floor, not a balance preference.
    for (const id of SKIN_IDS) {
      expect(skinDef(id).stats.control).toBeGreaterThanOrEqual(1);
    }
  });

  it('keeps every multiplier within a sane band', () => {
    for (const id of SKIN_IDS) {
      const { stats } = skinDef(id);
      for (const value of Object.values(stats)) {
        expect(value).toBeGreaterThanOrEqual(0.8);
        expect(value).toBeLessThanOrEqual(1.6);
      }
    }
  });

  it('makes no board strictly better than the free one', () => {
    // If a paid board beat Classic on every axis it would not be a choice, it
    // would be a paywall on the only sensible option.
    const baseline = skinDef(DEFAULT_SKIN).stats;

    for (const id of SKIN_IDS) {
      if (id === DEFAULT_SKIN) continue;
      const { stats } = skinDef(id);
      const better = Object.keys(baseline).filter(
        (key) => stats[key as keyof typeof stats] > baseline[key as keyof typeof baseline],
      );
      const worse = Object.keys(baseline).filter(
        (key) => stats[key as keyof typeof stats] < baseline[key as keyof typeof baseline],
      );

      expect(better.length).toBeGreaterThan(0);
      expect(worse.length).toBeGreaterThan(0);
    }
  });

  it('gives every board a tagline explaining its trade', () => {
    for (const id of SKIN_IDS) {
      expect(skinDef(id).tagline.length).toBeGreaterThan(10);
    }
  });
});

describe('worst-case bounds', () => {
  it('reports the fastest board as the speed ceiling', () => {
    const fastest = Math.max(...SKIN_IDS.map((id) => skinDef(id).stats.speed));
    expect(worstCaseSpeed(30)).toBeCloseTo(30 * fastest, 9);
  });

  it('never reports a ceiling below the baseline', () => {
    expect(worstCaseSpeed(30)).toBeGreaterThanOrEqual(30);
  });

  it('reports the slowest lane change across all boards', () => {
    const slowest = Math.min(...SKIN_IDS.map((id) => skinDef(id).stats.control));
    expect(worstCaseLaneChangeDuration(0.18)).toBeCloseTo(0.18 / slowest, 9);
  });

  it('never reports a lane change faster than the baseline', () => {
    // Solvability must be validated against the hardest case, never an
    // optimistic one.
    expect(worstCaseLaneChangeDuration(0.18)).toBeGreaterThanOrEqual(0.18);
  });
});

describe('upgrade pricing', () => {
  it('gets more expensive with each level', () => {
    for (let level = 1; level < UPGRADE_MAX_LEVEL; level++) {
      expect(upgradePrice(level)).toBeGreaterThan(upgradePrice(level - 1));
    }
  });

  it('never returns a free or negative price, even out of range', () => {
    for (const level of [-5, 0, 1, 2, 3, 99]) {
      expect(upgradePrice(level)).toBeGreaterThan(0);
    }
  });
});

describe('upgraded durations', () => {
  it('leaves level zero at the base duration', () => {
    for (const id of POWER_UP_IDS) {
      expect(upgradedDuration(id, 0)).toBeCloseTo(powerUpDef(id).duration, 9);
    }
  });

  it('increases with every level', () => {
    for (const id of POWER_UP_IDS) {
      for (let level = 1; level <= UPGRADE_MAX_LEVEL; level++) {
        expect(upgradedDuration(id, level)).toBeGreaterThan(upgradedDuration(id, level - 1));
      }
    }
  });

  it('caps at the maximum level rather than scaling forever', () => {
    for (const id of POWER_UP_IDS) {
      expect(upgradedDuration(id, 999)).toBeCloseTo(upgradedDuration(id, UPGRADE_MAX_LEVEL), 9);
    }
  });

  it('never goes below the base duration for a corrupt level', () => {
    for (const id of POWER_UP_IDS) {
      expect(upgradedDuration(id, -5)).toBeCloseTo(powerUpDef(id).duration, 9);
    }
  });

  it('stays within a sane multiple of the base, so nothing trivialises a run', () => {
    for (const id of POWER_UP_IDS) {
      const ratio = upgradedDuration(id, UPGRADE_MAX_LEVEL) / powerUpDef(id).duration;
      expect(ratio).toBeGreaterThan(1);
      expect(ratio).toBeLessThanOrEqual(2);
    }
  });
});

describe('durationsFor', () => {
  it('covers every power-up', () => {
    const durations = durationsFor({});
    for (const id of POWER_UP_IDS) expect(durations[id]).toBeGreaterThan(0);
  });

  it('applies each power-up its own level independently', () => {
    const durations = durationsFor({ magnet: 3 });
    expect(durations.magnet).toBeCloseTo(upgradedDuration('magnet', 3), 9);
    expect(durations.avalanche).toBeCloseTo(upgradedDuration('avalanche', 0), 9);
  });

  it('ignores junk keys and levels in a corrupt save', () => {
    const durations = durationsFor({ magnet: -2, nonsense: 9 });
    expect(durations.magnet).toBeCloseTo(powerUpDef('magnet').duration, 9);
    expect(Object.keys(durations).sort()).toEqual([...POWER_UP_IDS].sort());
  });
});

/*
 * Banking a run.
 *
 * `commitRun` is the one moment a run becomes permanent - coins, records and
 * mission progress all move together, and it is the only place that can know
 * which objectives this run finished, because the diff has to be taken against
 * the progress that existed a moment before it overwrote it. The results card
 * reads that answer, so getting it wrong is silent: the card simply says
 * nothing, exactly as it did when the feature did not exist.
 */

const COIN_MISSION: MissionInstance = {
  id: 'coins',
  metric: 'coins',
  target: 150,
  reward: 180,
  description: 'Collect 150 coins',
};

const COMBO_MISSION: MissionInstance = {
  id: 'combo',
  metric: 'bestCombo',
  target: 20,
  reward: 252,
  description: 'Clear 20 obstacles without a slip',
};

/** Puts the store on a known save and a known day's missions. */
function staged(missions: MissionInstance[], progress: Record<string, number> = {}): void {
  useMetaStore.setState({
    save: { ...createDefaultSave(), missions: progress },
    missions,
    lastRun: { bestCombo: 0, completedMissions: [] },
  });
}

/** A finished run, in the shape `commitRun` takes. */
function finishedRun(
  overrides: Partial<RunStats> = {},
): RunStats & { score: number; mode: string } {
  return {
    distance: 0,
    coins: 0,
    bestCombo: 0,
    rampLaunches: 0,
    powerUpsCollected: 0,
    phased: 0,
    runs: 1,
    score: 0,
    mode: 'endless',
    ...overrides,
  };
}

describe('commitRun', () => {
  it('reports exactly the missions this run finished', () => {
    staged([COIN_MISSION, COMBO_MISSION], { coins: 120 });

    const summary = useMetaStore.getState().commitRun(finishedRun({ coins: 40, bestCombo: 9 }));

    // The coin mission crossed 150 on this run's forty. The combo one did not
    // come close, which is what stops "reports the completions" being satisfied
    // by reporting all of them.
    expect(summary.completedMissions.map((mission) => mission.id)).toEqual(['coins']);
    expect(useMetaStore.getState().lastRun).toBe(summary);
  });

  it('says nothing when the run did not push anything over', () => {
    // The counterweight to the test above, and the one that matters: a run that
    // banked the same progress the save already had must produce an empty card,
    // or the completion notice fires on every run for ever.
    staged([COIN_MISSION, COMBO_MISSION], { coins: 120 });

    const summary = useMetaStore.getState().commitRun(finishedRun({ coins: 5 }));
    expect(summary.completedMissions).toEqual([]);
  });

  it('does not re-announce a mission that was already complete', () => {
    staged([COIN_MISSION], { coins: 400 });

    const summary = useMetaStore.getState().commitRun(finishedRun({ coins: 60 }));
    expect(summary.completedMissions).toEqual([]);
    // Still banked, though - the progress keeps climbing, it is only the
    // announcement that is once.
    expect(useMetaStore.getState().save.missions['coins']).toBe(460);
  });

  it('carries the best combo through for the results card', () => {
    staged([]);
    const summary = useMetaStore.getState().commitRun(finishedRun({ bestCombo: 31 }));
    expect(summary.bestCombo).toBe(31);
    expect(useMetaStore.getState().lastRun.bestCombo).toBe(31);
  });
});
