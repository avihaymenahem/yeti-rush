/**
 * Shop economy: skins and power-up upgrades.
 *
 * The rules that stop a player ending up in a broken state - negative coins, an
 * equipped skin they do not own, an upgrade past the cap - are the ones worth
 * pinning down, because each of them corrupts a save rather than just annoying
 * someone once.
 */

import { describe, expect, it } from 'vitest';
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
import { DEFAULT_SKIN } from '@/game/state/saveSchema';

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

  it('gives every skin a complete, valid colour set', () => {
    const hex = /^#[0-9a-fA-F]{6}$/;
    for (const id of SKIN_IDS) {
      const skin = skinDef(id);
      for (const colour of [skin.fur, skin.furShade, skin.face, skin.board, skin.boardTrim]) {
        expect(colour).toMatch(hex);
      }
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
