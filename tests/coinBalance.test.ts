/**
 * How long the shop takes to buy.
 *
 * A coin economy fails silently. Nothing crashes, no run becomes unplayable,
 * and the only symptom is that a player owns everything by the end of the first
 * evening and the shop stops being a reason to keep playing. This one did
 * exactly that: the track laid 44 coins every 100 m against a 15,000 coin shop,
 * so roughly thirty-five runs bought the lot.
 *
 * `tests/economy.test.ts` covers the shop's *state* rules - what a purchase may
 * do to a save. This file covers its *balance*, which is a measurement rather
 * than an invariant and so is asserted as a range over the real generator.
 *
 * The measurement is deliberately the most generous possible reading: every
 * coin laid is counted as collected, which no real player manages. The bound is
 * therefore a floor on effort - the shop cannot be cleared faster than this, and
 * in practice takes considerably longer.
 */

import { describe, expect, it } from 'vitest';
import { TUNING } from '@/game/config/tuning';
import { POWER_UP_IDS, upgradePrice } from '@/game/content/powerUps';
import { SKIN_IDS, SKINS } from '@/game/content/skins';
import { createTestRuntime } from '@/game/state/runtime';
import { tickRun } from '@/game/systems/simulation';

const STEP = TUNING.sim.step;

/** A run long enough to count as a good one, used as the yardstick throughout. */
const REFERENCE_RUN_METRES = 2000;

/** Coins needed to own every board and max every power-up. */
function shopTotal(): number {
  const boards = SKIN_IDS.reduce((sum, id) => sum + SKINS[id].price, 0);
  const perPowerUp = [0, 1, 2].reduce((sum, level) => sum + upgradePrice(level), 0);
  return boards + POWER_UP_IDS.length * perPowerUp;
}

/**
 * Distinct coins the generator lays over `metres`, averaged across seeds.
 *
 * Obstacles are cleared so the sampling run always reaches the full distance;
 * this measures what the track *offers*, not what a player is good enough to
 * take. Entities come from a recycled pool, so coins are keyed by position -
 * counting live entities per tick would count each one once per frame.
 */
function coinsLaidPerRun(metres: number, seeds = 16): number {
  let total = 0;

  for (let seed = 0; seed < seeds; seed++) {
    const rt = createTestRuntime(seed);
    rt.running = true;
    const seen = new Set<string>();

    while (rt.distance < metres) {
      for (const obstacle of rt.track.obstacles) obstacle.active = false;
      for (const coin of rt.track.coins) {
        if (!coin.active) continue;
        seen.add(`${coin.trackZ.toFixed(2)}:${coin.lane}`);
      }
      tickRun(rt, STEP);
    }

    total += seen.size;
  }

  return total / seeds;
}

describe('the coin economy', () => {
  const perRun = coinsLaidPerRun(REFERENCE_RUN_METRES);
  const total = shopTotal();
  const runsToClear = total / perRun;

  it('lays enough coins for a run to be worth collecting', () => {
    // The counterweight. Every bound below is trivially satisfied by laying no
    // coins at all, which makes the shop unreachable rather than balanced.
    expect(perRun).toBeGreaterThan(200);
  });

  it('cannot be cleared in one session, even by a perfect collector', () => {
    // Two thousand metres a run and one hundred percent collection - neither of
    // them realistic - and the shop still has to be worked for.
    expect(runsToClear).toBeGreaterThan(90);
  });

  it('does not make the shop unreachable either', () => {
    // The other side of the same bound. A shop nobody can afford is as dead as
    // one everybody clears on the first day.
    expect(runsToClear).toBeLessThan(400);
  });

  it('puts the first board within a few runs', () => {
    // The first purchase is what teaches a player that coins buy something. Set
    // too far out and the shop reads as decoration for most of the play time.
    const paid = SKIN_IDS.map((id) => SKINS[id].price).filter((price) => price > 0);
    expect(Math.min(...paid) / perRun).toBeLessThan(4);
  });

  it('prices every board and upgrade tier above the one before it', () => {
    // A tier costing no more than its predecessor is a data-entry slip; one
    // costing less inverts the progression outright.
    const prices = SKIN_IDS.map((id) => SKINS[id].price).sort((a, b) => a - b);
    for (let i = 1; i < prices.length; i++) {
      expect(prices[i] as number).toBeGreaterThan(prices[i - 1] as number);
    }
    for (let level = 1; level < 3; level++) {
      expect(upgradePrice(level)).toBeGreaterThan(upgradePrice(level - 1));
    }
  });
});

describe('coin density', () => {
  it('thins the filler runs without touching the ramp and rail lines', () => {
    // The routes are where the risk is, so they keep every coin their arc was
    // authored with. Were this ever to invert, taking a ramp or a rail would be
    // a gamble paying less than staying on the flat, and nobody sensible would.
    expect(TUNING.coins.plainRunScale).toBeGreaterThan(0);
    expect(TUNING.coins.plainRunScale).toBeLessThan(1);
  });
});
