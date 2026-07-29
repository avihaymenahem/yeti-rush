/**
 * Tricks off a ramp.
 *
 * A ramp launch is the only span in the game where the player is committed:
 * twenty-two metres they cannot jump or slide out of, only steer. That rule is
 * load-bearing - the spawner clears the landing precisely because of it - and
 * it also meant the most dramatic second in a run was one the player spent as a
 * passenger. Tricks fill that second without touching the rule.
 *
 * So the assertions come in two halves. One half is the mechanic: chains build,
 * greed costs, a blown landing takes the lot. The other half is that none of it
 * has leaked into anything the generator or the collision system depends on,
 * which is the only way this could break something that matters.
 */

import { describe, expect, it } from 'vitest';
import { TUNING } from '@/game/config/tuning';
import { createTestRuntime, type RuntimeState } from '@/game/state/runtime';
import {
  createPlayerState,
  launchFromRamp,
  requestJump,
  requestSlide,
  requestTrick,
  settleTricks,
  stepPlayer,
  trickValue,
} from '@/game/systems/player';
import { tickRun } from '@/game/systems/simulation';

const STEP = TUNING.sim.step;

/** A player mid-ramp-flight at a given speed. */
function launched(speed = TUNING.speed.start) {
  const player = createPlayerState();
  launchFromRamp(player, speed);
  return player;
}

/** Advances a player by seconds, without a runtime. */
function fly(player: ReturnType<typeof createPlayerState>, seconds: number): void {
  const ticks = Math.round(seconds / STEP);
  for (let i = 0; i < ticks; i++) stepPlayer(player, STEP);
}

describe('starting one', () => {
  it('needs a ramp flight', () => {
    // The restriction that keeps the jump buffer intact everywhere else: a tap
    // in ordinary airtime queues the next jump, which is worth more than tricks
    // would be there.
    const grounded = createPlayerState();
    expect(requestTrick(grounded)).toBe(false);

    const jumping = createPlayerState();
    requestJump(jumping);
    expect(requestTrick(jumping)).toBe(false);

    expect(requestTrick(launched())).toBe(true);
  });

  it('cannot be queued up mid-rotation', () => {
    // Otherwise the whole chain could be mashed in on the way up, which takes
    // the risk out of it - and the risk is the mechanic.
    const player = launched();
    expect(requestTrick(player)).toBe(true);
    expect(requestTrick(player)).toBe(false);

    fly(player, TUNING.tricks.duration);
    expect(requestTrick(player)).toBe(true);
  });

  it('stops at the chain limit', () => {
    const player = launched();
    for (let i = 0; i < TUNING.tricks.maxChain; i++) {
      expect(requestTrick(player)).toBe(true);
      fly(player, TUNING.tricks.duration);
    }
    expect(requestTrick(player)).toBe(false);
  });
});

describe('the chain', () => {
  it('pays more for each one', () => {
    for (let n = 1; n < TUNING.tricks.maxChain; n++) {
      expect(trickValue(n)).toBeGreaterThan(trickValue(n - 1));
    }
  });

  it('banks nothing until the rotation finishes', () => {
    const player = launched();
    requestTrick(player);
    fly(player, TUNING.tricks.duration / 2);

    expect(player.pendingTrickScore).toBe(0);
    expect(player.trickChain).toBe(0);

    fly(player, TUNING.tricks.duration / 2);
    expect(player.pendingTrickScore).toBe(trickValue(0));
    expect(player.trickChain).toBe(1);
  });

  it('turns the rider exactly as far as it has scored', () => {
    // The pose is read straight off this, so a mismatch lands the rider
    // sideways on a chain the simulation has already paid for.
    const player = launched();
    requestTrick(player);
    fly(player, TUNING.tricks.duration);
    expect(player.trickSpin).toBeCloseTo(Math.PI * 2, 3);
  });
});

describe('landing', () => {
  it('keeps a clean chain', () => {
    const player = launched();
    requestTrick(player);
    fly(player, TUNING.tricks.duration);

    const expected = trickValue(0);
    expect(settleTricks(player)).toBe(expected);
  });

  it('loses the whole chain when one is still turning', () => {
    /*
     * The entire risk, and it takes *everything* rather than just the
     * unfinished rotation. Forfeiting only the last one would make the final
     * tap of a flight free, which is the tap the decision is about.
     */
    const player = launched();
    for (let i = 0; i < 3; i++) {
      requestTrick(player);
      fly(player, TUNING.tricks.duration);
    }
    expect(player.pendingTrickScore).toBeGreaterThan(0);

    requestTrick(player);
    fly(player, TUNING.tricks.duration / 2);
    expect(settleTricks(player)).toBe(0);
  });

  it('leaves nothing behind for the next flight', () => {
    const player = launched();
    requestTrick(player);
    fly(player, TUNING.tricks.duration);
    settleTricks(player);

    expect(player.pendingTrickScore).toBe(0);
    expect(player.trickChain).toBe(0);
    expect(player.trickSpin).toBe(0);
  });
});

describe('through a real tick', () => {
  /** A run with nothing generated, so only the staged ramp exists. */
  function stagedRun(): RuntimeState {
    const rt = createTestRuntime(1);
    rt.running = true;
    rt.nextAvalancheAt = Number.MAX_SAFE_INTEGER;
    rt.track.nextChunkStart = Number.MAX_SAFE_INTEGER;
    rt.track.nextPickupAt = Number.MAX_SAFE_INTEGER;
    for (const obstacle of rt.track.obstacles) obstacle.active = false;
    for (const rail of rt.track.rails) rail.active = false;
    for (const ramp of rt.track.ramps) ramp.active = false;
    return rt;
  }

  it('banks into the run score on touchdown', () => {
    const rt = stagedRun();
    launchFromRamp(rt.player, rt.speed);
    requestTrick(rt.player);

    // Fly it out. The arc is defined over distance, so this is comfortably
    // longer than any flight at any speed.
    for (let i = 0; i < 240 && !rt.player.ramping === false; i++) tickRun(rt, STEP);

    expect(rt.tricksLanded).toBe(1);
    expect(rt.trickScore).toBe(trickValue(0));
    expect(rt.score).toBeGreaterThan(0);
  });

  it('counts a fumble instead when the landing is blown', () => {
    const rt = stagedRun();
    launchFromRamp(rt.player, rt.speed);

    // Ride most of the way down, then start one it cannot possibly finish.
    while (rt.player.ramping && rt.player.vy > -TUNING.player.jumpVelocity) tickRun(rt, STEP);
    requestTrick(rt.player);
    for (let i = 0; i < 240 && rt.player.ramping; i++) tickRun(rt, STEP);

    expect(rt.trickFumbles).toBe(1);
    expect(rt.trickScore).toBe(0);
  });
});

describe('what tricks must not touch', () => {
  it('leaves the arc itself alone', () => {
    /*
     * The load-bearing assertion. The ramp arc is what the spawner's landing
     * clearance is derived from, and a trick that nudged the flight even
     * slightly would silently move where the player comes down relative to
     * track that was cleared for them.
     */
    const plain = launched();
    const tricking = launched();
    requestTrick(tricking);

    for (let i = 0; i < 120; i++) {
      stepPlayer(plain, STEP);
      stepPlayer(tricking, STEP);
      if (i % 17 === 0) requestTrick(tricking);
      expect(tricking.y).toBeCloseTo(plain.y, 10);
      expect(tricking.vy).toBeCloseTo(plain.vy, 10);
    }
  });

  it('does not stop the player bailing out', () => {
    // Diving out of a flight is how a badly aimed ramp is survived. A trick in
    // progress must not swallow that input.
    const player = launched();
    requestTrick(player);
    requestSlide(player);
    expect(player.vy).toBeLessThan(0);
  });
});
