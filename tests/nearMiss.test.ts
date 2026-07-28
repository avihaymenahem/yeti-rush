/**
 * Near misses.
 *
 * The first thing in this game that pays the player for *how* they got past
 * something rather than whether they did. That makes it a scoring rule, so it
 * is computed in the simulation and tested like one.
 *
 * The threshold has a hard ceiling that is a correctness question rather than a
 * feel one, and that is what most of this file is about. Lanes are 2.2 apart;
 * push the near-miss gap past the clearance a player has in the *next lane* and
 * every obstacle on the track pays out, for ever, for doing nothing. It would
 * look like generosity in review and like a broken scoreboard on a phone.
 */

import { describe, expect, it } from 'vitest';
import { LANES, TUNING } from '@/game/config/tuning';
import { OBSTACLE_KINDS, obstacleDef } from '@/game/content/obstacles';
import { createTestRuntime } from '@/game/state/runtime';
import { passingGap } from '@/game/systems/simulation';
import { runAutopilot } from './support/autopilot';

/** Narrowest spacing between two adjacent lane centres. */
function laneSpacing(): number {
  let narrowest = Infinity;
  for (let i = 1; i < LANES.length; i++) {
    narrowest = Math.min(narrowest, Math.abs((LANES[i] as number) - (LANES[i - 1] as number)));
  }
  return narrowest;
}

/** Widest thing the generator can put on the track. */
function widestObstacle(): number {
  let widest = 0;
  for (const kind of OBSTACLE_KINDS) widest = Math.max(widest, obstacleDef(kind).halfWidth);
  return widest;
}

describe('the near-miss threshold', () => {
  it('stays below the clearance a player has one lane over', () => {
    // The ceiling, and the only assertion here that is not a matter of taste.
    const clearance = laneSpacing() - (TUNING.player.halfWidth + widestObstacle());
    expect(TUNING.collision.nearMissGap).toBeLessThan(clearance);
  });

  it('is not so tight that nothing can reach it', () => {
    // The other side. A threshold of zero is trivially safe and pays nobody.
    expect(TUNING.collision.nearMissGap).toBeGreaterThan(0.1);
  });
});

describe('measuring the gap as something goes past', () => {
  const { halfWidth, halfHeight } = TUNING.player;

  it('is the sideways clearance when the player is beside it', () => {
    const gap = passingGap(0, halfHeight, halfWidth, halfHeight, 2.2, 0.5, 0.5, 0.5);
    expect(gap).toBeCloseTo(2.2 - (halfWidth + 0.5), 5);
  });

  it('is the height cleared when the player jumped it', () => {
    // Same lane, well above it. The lateral gap is negative - they are directly
    // over the thing - so height is what separated them.
    const gap = passingGap(0, 2.4, halfWidth, halfHeight, 0, 0.4, 0.5, 0.4);
    expect(gap).toBeCloseTo(2.4 - halfHeight - (0.4 + 0.4), 5);
  });

  it('takes the roomier axis, not the tighter one', () => {
    // Cleared by height from an adjacent lane. The lane offset happens to be
    // small, and that does not make it a close call - the player was never
    // going to touch it.
    const close = passingGap(0, 3, halfWidth, halfHeight, 0.9, 0.4, 0.5, 0.4);
    expect(close).toBeGreaterThan(TUNING.collision.nearMissGap);
  });

  it('goes negative inside the forgiveness margin', () => {
    // Not a contradiction: the hit test runs on colliders shrunk by
    // `collision.forgiveness`, so a pass can overlap the full boxes and still
    // be a pass. That is the tightest near miss there is and it counts.
    const gap = passingGap(0, halfHeight, halfWidth, halfHeight, halfWidth + 0.4, 0.5, 0.5, 0.5);
    expect(gap).toBeLessThan(0);
    expect(gap).toBeLessThan(TUNING.collision.nearMissGap);
  });
});

describe('over a played run', () => {
  /*
   * Played rather than generated. Where the player *is* when an obstacle goes
   * past is the entire question, and no amount of inspecting laid track answers
   * it - so `support/autopilot.ts` flies a plain greedy player and these assert
   * what came out. The bands are wide on purpose: the pilot commits every jump
   * at a fixed lead and so clears things by an unnaturally uniform margin.
   */
  const SEEDS = 24;
  const results = Array.from({ length: SEEDS }, (_, i) =>
    runAutopilot(createTestRuntime(i + 1), 2000),
  );
  const distance = results.reduce((sum, r) => sum + r.distance, 0);
  const nearMisses = results.reduce((sum, r) => sum + r.nearMisses, 0);
  const perKm = nearMisses / (distance / 1000);

  it('gets the pilot far enough for the sample to mean anything', () => {
    // Guards the measurement itself. A pilot that died in the first chunk would
    // make every rate below a statement about nothing.
    expect(distance / SEEDS).toBeGreaterThan(500);
  });

  it('happens often enough to be a reward', () => {
    expect(perKm).toBeGreaterThan(1);
  });

  it('and rarely enough to be worth something', () => {
    // The counterweight, and the one that catches the threshold drifting up
    // into lane-width territory where it fires on every obstacle on the track.
    expect(perKm).toBeLessThan(20);
  });

  it('stays a minority of what the player got past', () => {
    // Squeezing past has to be the exception. If most obstacles scored as near
    // misses the bonus would just be a second, noisier distance score.
    const passed = results.reduce((sum, r) => sum + r.passed, 0);
    expect(passed).toBeGreaterThan(50);
    expect(nearMisses).toBeLessThan(passed);
  });
});
