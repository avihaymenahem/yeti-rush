/**
 * The second chance.
 *
 * A revive is the one place in this game where the player is put back on the
 * track without having read any of it. That makes it the committed-flight
 * problem in a fifth costume - after ramp landings, rail dismounts and tunnel
 * exits - and it gets tested the same way: not "does it work" but "is the track
 * they wake up on survivable".
 *
 * The economy half matters just as much and fails just as quietly. A revive
 * that is always affordable is a game without death; one that never is, is a
 * feature nobody sees.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { TUNING } from '@/game/config/tuning';
import { useGameStore } from '@/game/state/gameStore';
import { useMetaStore } from '@/game/state/metaStore';
import { resetRuntime, runtime } from '@/game/state/runtime';
import {
  canRevive,
  finishOrOfferRevive,
  revivePrice,
  reviveRun,
} from '@/game/state/runController';
import { tickRun } from '@/game/systems/simulation';
import { worldZOf } from '@/game/systems/spawner';

const STEP = TUNING.sim.step;

/** A run that has just ended on an obstacle, with a given wallet. */
function deadRun(coins: number) {
  resetRuntime(1);
  runtime.running = true;
  // Far enough in that there is real generated track around the player.
  for (let i = 0; i < 600; i++) tickRun(runtime, STEP);

  runtime.alive = false;
  runtime.deathCause = 'obstacle';
  runtime.running = false;

  useMetaStore.setState((state) => ({ save: { ...state.save, coins } }));
  return runtime;
}

beforeEach(() => {
  useGameStore.getState().setPhase('running');
});

describe('being offered one', () => {
  it('needs the coins', () => {
    deadRun(revivePrice(0) - 1);
    expect(canRevive()).toBe(false);

    deadRun(revivePrice(0));
    expect(canRevive()).toBe(true);
  });

  it('is not offered when the clock ran out', () => {
    // Timing out is the mode's own ending rather than a mistake. Selling a way
    // past it would make Time Attack a question of who has the most coins.
    deadRun(999_999);
    runtime.deathCause = 'timeUp';
    expect(canRevive()).toBe(false);
  });

  it('runs out after a few of them', () => {
    deadRun(999_999);
    runtime.revives = TUNING.revive.maxPerRun;
    expect(canRevive()).toBe(false);
  });

  it('does not bank the run while the offer is open', () => {
    // The whole point: the score has to survive into the revived run, so
    // nothing may be committed until the offer is resolved.
    const before = useMetaStore.getState().save.leaderboard.length;
    deadRun(999_999);
    finishOrOfferRevive();

    expect(useGameStore.getState().phase).toBe('revive');
    expect(useMetaStore.getState().save.leaderboard.length).toBe(before);
  });

  it('goes straight to the results when there is nothing to offer', () => {
    // The counterweight. A revive that swallowed the game-over screen when it
    // could not be paid for would strand the player on a dead run.
    deadRun(0);
    finishOrOfferRevive();
    expect(useGameStore.getState().phase).toBe('gameover');
  });
});

describe('the price', () => {
  it('escalates within a run', () => {
    // Flat pricing makes reviving the automatic choice every time, which is the
    // same as having no death at all.
    for (let n = 1; n < TUNING.revive.maxPerRun; n++) {
      expect(revivePrice(n)).toBeGreaterThan(revivePrice(n - 1));
    }
  });

  it('is taken from the wallet exactly once', () => {
    const rt = deadRun(999_999);
    const before = useMetaStore.getState().save.coins;
    const price = revivePrice();

    expect(reviveRun()).toBe(true);
    expect(useMetaStore.getState().save.coins).toBe(before - price);
    expect(rt.revives).toBe(1);
  });

  it('changes nothing when it cannot be paid', () => {
    const rt = deadRun(0);
    expect(reviveRun()).toBe(false);
    expect(rt.alive).toBe(false);
    expect(rt.revives).toBe(0);
  });
});

describe('coming back', () => {
  it('keeps the run and loses the combo', () => {
    const rt = deadRun(999_999);
    rt.combo = 40;
    const { score, coins, distance } = rt;

    reviveRun();

    expect(rt.alive).toBe(true);
    expect(rt.score).toBe(score);
    expect(rt.coins).toBe(coins);
    expect(rt.distance).toBe(distance);
    // A combo is a claim about unbroken riding, and it was broken.
    expect(rt.combo).toBe(0);
  });

  it('clears whatever the player is standing in', () => {
    /*
     * Not decoration. The player restarts at the exact position that killed
     * them, and the thing that did it is still inside the collision window - so
     * without this the very next tick ends the run again, for ever, until the
     * wallet is empty.
     */
    const rt = deadRun(999_999);
    reviveRun();

    for (const obstacle of rt.track.obstacles) {
      if (!obstacle.active) continue;
      expect(Math.abs(worldZOf(obstacle.trackZ, rt.distance))).toBeGreaterThanOrEqual(
        TUNING.collision.zWindow,
      );
    }
  });

  it('survives the next second of track', () => {
    // The real assertion, and the one the clearance exists for: run on and see.
    const rt = deadRun(999_999);
    reviveRun();

    const ticks = Math.ceil(TUNING.revive.clearSeconds / STEP);
    for (let i = 0; i < ticks; i++) tickRun(rt, STEP);

    expect(rt.alive).toBe(true);
  });

  it('lets the grace expire rather than leaving the player untouchable', () => {
    // The counterweight to every survival assertion above, all of which are
    // trivially satisfied by never being killable again.
    const rt = deadRun(999_999);
    reviveRun();
    expect(rt.graceTimer).toBeGreaterThan(0);

    const ticks = Math.ceil((TUNING.revive.graceSeconds + 0.1) / STEP);
    for (let i = 0; i < ticks; i++) tickRun(rt, STEP);

    expect(rt.graceTimer).toBe(0);
  });

  it('pushes the patrol back off', () => {
    // Reviving with the patrol already on your shoulder means the next trip
    // ends the run, which is not a second chance.
    const rt = deadRun(999_999);
    rt.chaser.distance = 6;
    reviveRun();
    expect(rt.chaser.distance).toBeGreaterThan(6);
  });

  it('is running again, not merely alive', () => {
    const rt = deadRun(999_999);
    reviveRun();
    expect(rt.running).toBe(true);
    expect(useGameStore.getState().phase).toBe('running');
    expect(rt.deathCause).toBeNull();
  });
});
