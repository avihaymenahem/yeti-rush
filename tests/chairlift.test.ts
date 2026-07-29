/**
 * The chairlift, and the coins it is supposed to sweep up.
 *
 * The power-up sells one thing: you are lifted clear of the piste and hoover up
 * the line you fly along. It did not do it. The lift holds the rider five
 * metres up, coins sit at 0.9, and pickup was a sphere around the player - so
 * the reach that was meant to sweep four lanes' worth of coin line was almost
 * entirely spent on the drop to the ground, and the ride collected next to
 * nothing.
 *
 * What made it a bug report rather than a balance quibble is that the *drawing*
 * of the magnet pull starts fourteen metres out and completes at the pickup
 * radius. So the player watched a stream of coins fly up to their chest, arrive,
 * and not count. That is the shape of the thing being tested here: not "some
 * coins are collected" but "the line the lift flies along is collected", with a
 * counterweight proving the ground-level reach did not simply get bigger.
 */

import { describe, expect, it } from 'vitest';
import { TUNING, type LaneIndex } from '@/game/config/tuning';
import { flightHeight } from '@/game/content/powerUps';
import { createTestRuntime, type RuntimeState } from '@/game/state/runtime';
import { tickRun } from '@/game/systems/simulation';

const STEP = TUNING.sim.step;

/** The height the lift holds the rider at, taken from the power-up itself. */
const FLIGHT_HEIGHT = (() => {
  const timers = createTestRuntime(1).powerUps;
  timers.chairlift = 1;
  const height = flightHeight(timers);
  if (height === null) throw new Error('the chairlift no longer lifts anyone');
  return height;
})();

/** A runtime with nothing generated in it, so only staged coins are collected. */
function bareRuntime(): RuntimeState {
  const rt = createTestRuntime(1);
  rt.running = true;
  for (const obstacle of rt.track.obstacles) obstacle.active = false;
  for (const coin of rt.track.coins) coin.active = false;
  for (const pickup of rt.track.pickups) pickup.active = false;
  rt.track.nextPickupAt = Number.MAX_SAFE_INTEGER;
  rt.track.nextChunkStart = Number.MAX_SAFE_INTEGER;
  rt.nextAvalancheAt = Number.MAX_SAFE_INTEGER;
  return rt;
}

/** A run of coins down one lane, exactly as the generator lays them. */
function placeLine(rt: RuntimeState, lane: LaneIndex, from: number, count: number): number {
  for (let i = 0; i < count; i++) {
    const coin = rt.track.coins.find((c) => !c.active);
    if (!coin) throw new Error('ran out of coin slots');
    coin.active = true;
    coin.lane = lane;
    coin.trackZ = from + i * TUNING.coins.spacing;
    coin.y = TUNING.coins.baseHeight;
  }
  return count;
}

/** Ticks until the whole line has gone past, and reports what was banked. */
function flyThrough(rt: RuntimeState, seconds: number): number {
  const before = rt.coins;
  const ticks = Math.round(seconds / STEP);
  for (let i = 0; i < ticks; i++) tickRun(rt, STEP);
  return rt.coins - before;
}

describe('riding the lift over a coin line', () => {
  it('collects the line it flies along', () => {
    /*
     * The bug, stated as the guarantee it broke. Twenty coins in the lane the
     * player is already in, and the lift running for the whole pass: before the
     * fix this banked a handful at most, because the sphere only reached the
     * ground when a coin was very nearly underfoot.
     */
    const rt = bareRuntime();
    rt.powerUps.chairlift = 30;
    const laid = placeLine(rt, 1, 40, 20);

    expect(flyThrough(rt, 6)).toBe(laid);
  });

  it('sweeps in the lanes either side of it', () => {
    // The widened radius is what the ride is buying. A line two lanes over is
    // still 4.4 metres away horizontally, which is inside it.
    const rt = bareRuntime();
    rt.powerUps.chairlift = 30;
    const laid = placeLine(rt, 0, 40, 12) + placeLine(rt, 2, 40, 12);

    expect(flyThrough(rt, 6)).toBe(laid);
  });

  it('would have missed nearly all of it without the fix', () => {
    /*
     * The counterweight, and the only test here that would have failed loudly
     * before. It reproduces the old behaviour exactly - a sphere centred on a
     * rider five metres up - and asserts that reach really does miss the line,
     * so the passing tests above are not passing on a reach that was always
     * wide enough.
     */
    const radius = TUNING.coins.pickupRadius * 4;
    const drop = FLIGHT_HEIGHT - TUNING.coins.baseHeight;
    expect(drop).toBeGreaterThan(0);

    // What is left of the reach once the drop to the piste is paid for.
    const horizontal = Math.sqrt(Math.max(0, radius * radius - drop * drop));
    expect(horizontal).toBeLessThan(TUNING.coins.spacing * 1.5);
  });
});

/** One coin, at whatever height the caller wants to test the reach with. */
function placeCoinAt(rt: RuntimeState, lane: LaneIndex, trackZ: number, y: number) {
  const coin = rt.track.coins.find((c) => !c.active);
  if (!coin) throw new Error('ran out of coin slots');
  coin.active = true;
  coin.lane = lane;
  coin.trackZ = trackZ;
  coin.y = y;
  return coin;
}

describe('height still counts', () => {
  it('is not forgiven at all for a player on the ground', () => {
    /*
     * The fix must not have become "height never matters". A magnet is the
     * widest reach in the game - six times the base radius - and a coin beyond
     * it overhead stays where it is.
     */
    const rt = bareRuntime();
    rt.powerUps.magnet = 30;
    const magnetReach = TUNING.coins.pickupRadius * 6;
    placeCoinAt(rt, 1, 40, magnetReach + 2);

    expect(flyThrough(rt, 6)).toBe(0);

    // The positive control: the same coin at head height is collected, so the
    // zero above is the height and not a mis-staged lane or a missed window.
    const control = bareRuntime();
    control.powerUps.magnet = 30;
    placeCoinAt(control, 1, 40, TUNING.coins.baseHeight);
    expect(flyThrough(control, 6)).toBe(1);
  });

  it('is forgiven only downwards, even on the lift', () => {
    /*
     * The narrow version of the same point, and the reason the rule is "the
     * drop is free" rather than "ignore the y axis". Nothing is spawned above
     * the lift today, so a blanket rule would look identical - right up until
     * something is.
     */
    const rt = bareRuntime();
    rt.powerUps.chairlift = 30;
    const chairliftReach = TUNING.coins.pickupRadius * 4;
    placeCoinAt(rt, 1, 40, FLIGHT_HEIGHT + chairliftReach + 2);

    expect(flyThrough(rt, 6)).toBe(0);

    // The positive control, at the same distance but below the lift instead of
    // above it - where the drop is exactly what the ride is meant to forgive.
    const control = bareRuntime();
    control.powerUps.chairlift = 30;
    placeCoinAt(control, 1, 40, TUNING.coins.baseHeight);
    expect(flyThrough(control, 6)).toBe(1);
  });
});

describe('on the ground', () => {

  it('collects an ordinary line at ground level exactly as before', () => {
    // The regression guard for everyone not on a lift, which is almost all of
    // the game. Nothing about the ordinary run may have changed.
    const rt = bareRuntime();
    const laid = placeLine(rt, 1, 40, 20);

    expect(flyThrough(rt, 6)).toBe(laid);
  });
});
