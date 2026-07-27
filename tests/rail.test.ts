/**
 * Grind rails.
 *
 * A rail is the second optional route, and the rule that makes it safe to add
 * one is the rule that made the ramp safe: it is a *trigger*, never an obstacle.
 * Taking one can only ever help, so the solvability guarantee never has to know
 * it exists - the track underneath is checked as if the bar were not there.
 *
 * Mounting is decided by geometry alone, never by what the player pressed.
 * Ride into the near end and you step onto it; jump and the bar catches your
 * arc wherever it crosses; arrive late and the bar is overhead, so you pass
 * underneath. Two rounds of "rails don't work" came from gating that on an
 * input, so the tests here assert the rate at which real inputs - including no
 * input at all - actually get a player onto a rail on real generated track.
 */

import { describe, expect, it } from 'vitest';
import { TUNING, type LaneIndex } from '@/game/config/tuning';
import { CHUNKS, expandCoins, type ChunkTemplate } from '@/game/content/chunks';
import { obstacleDef } from '@/game/content/obstacles';
import { createTestRuntime, type RuntimeState } from '@/game/state/runtime';
import { requestLaneChange } from '@/game/systems/lanes';
import {
  bailRail,
  createPlayerState,
  mountRail,
  releaseRail,
  requestJump,
  requestSlide,
  stepGrind,
  stepPlayer,
} from '@/game/systems/player';
import { railHeightAt, railTopHeight } from '@/game/systems/rail';
import { tickRun } from '@/game/systems/simulation';

const STEP = TUNING.sim.step;
const RAIL = TUNING.rail;

describe('rail shape', () => {
  it('starts at the near-end height and finishes at the top', () => {
    expect(railHeightAt(0)).toBeCloseTo(RAIL.baseHeight, 6);
    expect(railHeightAt(RAIL.length)).toBeCloseTo(railTopHeight(), 6);
  });

  it('climbs the whole way without ever dipping', () => {
    let previous = -Infinity;
    for (let d = 0; d <= RAIL.length; d += RAIL.length / 40) {
      const height = railHeightAt(d);
      expect(height).toBeGreaterThanOrEqual(previous);
      previous = height;
    }
  });

  it('clamps rather than extrapolating off either end', () => {
    // A caller that overshoots should get the end of the rail, not a height
    // somewhere above the mountain.
    expect(railHeightAt(-50)).toBeCloseTo(RAIL.baseHeight, 6);
    expect(railHeightAt(RAIL.length * 10)).toBeCloseTo(railTopHeight(), 6);
  });

  it('mounts low enough that a slide meets it at its own height', () => {
    // The near end has to be something you step onto. High enough to need a
    // launch and the "slide into it" input would be a lie.
    expect(RAIL.baseHeight).toBeLessThanOrEqual(TUNING.player.slideHalfHeight * 2);
  });

  it('is speed-invariant, like the ramp arc', () => {
    // Height is a function of distance along the rail and nothing else, so the
    // rail carries the player to the same place at 16 u/s and at 36.
    for (const speed of [16, 24, 36, 44]) {
      const player = createPlayerState();
      requestSlide(player);
      mountRail(player, 0, 1, 0);

      let distance = 0;
      // `stepGrind` reports false on the tick it releases the player.
      let riding = true;
      while (riding) {
        distance += speed * STEP;
        riding = stepGrind(player, distance);
      }
      // Released at the top whatever the speed took to get there.
      expect(player.y).toBeCloseTo(railTopHeight(), 6);
    }
  });
});

describe('mounting', () => {
  it('takes a player who simply rides into it, with no input at all', () => {
    // The whole of "walking towards it in a straight line". A rail is a solid
    // bar at ankle height; riding into one has to put you on it, because that
    // is the first thing anyone tries and it used to pass straight through.
    const player = createPlayerState();
    expect(player.motion).toBe('running');
    expect(mountRail(player, 0, 1, 0)).toBe(true);
    expect(player.motion).toBe('grinding');
  });

  it('lets a grounded player run underneath once the bar is overhead', () => {
    // The other half of the same rule, and the one that keeps the track beneath
    // a rail passable on its own terms: past the near end the bar is over the
    // player's head, so arriving there on the snow must not yank them up.
    const along = RAIL.length * 0.75;
    expect(railHeightAt(along)).toBeGreaterThan(RAIL.stepUpHeight);

    const player = createPlayerState();
    expect(mountRail(player, 0, 1, along)).toBe(false);
    expect(player.motion).toBe('running');
  });

  it('leaves a player on the chairlift alone', () => {
    // Flying carries the player metres above the track - already over anything
    // the rail would have lifted them past.
    const player = createPlayerState();
    player.motion = 'flying';
    expect(mountRail(player, 0, 1, 0)).toBe(false);
    expect(player.motion).toBe('flying');
  });

  it('accepts a jump, which is what a player actually does at a rail', () => {
    // The regression that made rails feel like a trap: mounting used to demand
    // a slide, so the obvious input silently failed and dropped the player
    // short of the obstacle the rail exists to carry them over.
    const player = createPlayerState();
    expect(requestJump(player)).toBe(true);
    expect(mountRail(player, 0, 1, 0)).toBe(true);
    expect(player.motion).toBe('grinding');
  });

  it('catches a jump anywhere along the bar, not just at the near end', () => {
    // Jump timing is not going to be metre-perfect. Wherever the arc happens to
    // cross the bar, that is where the grind starts.
    for (const along of [0, 4, 9, 14, RAIL.length - 0.5]) {
      const player = createPlayerState();
      player.motion = 'airborne';
      player.y = railHeightAt(along);
      player.vy = -2;

      expect(mountRail(player, 50, 1, along)).toBe(true);
      expect(player.y).toBeCloseTo(railHeightAt(along), 6);
      // Mounted mid-rail, the grind still measures from the rail's near end, so
      // the remaining rise is whatever is left of the bar.
      expect(player.grindFromZ).toBe(50);
    }
  });

  it('does not catch a jump that passes well clear of the bar', () => {
    const player = createPlayerState();
    player.motion = 'airborne';
    player.y = railHeightAt(4) + RAIL.catchHeight + 0.2;
    expect(mountRail(player, 0, 1, 4)).toBe(false);
  });

  it('leaves a committed ramp flight alone', () => {
    // A ramp arc is a fixed flight the player cannot abort; a rail plucking
    // them out of it mid-air would drop them somewhere the chalet still stands.
    const player = createPlayerState();
    player.motion = 'airborne';
    player.ramping = true;
    player.y = railHeightAt(0);
    expect(mountRail(player, 0, 1, 0)).toBe(false);
  });

  it('accepts a sliding player and puts them on the bar', () => {
    const player = createPlayerState();
    expect(requestSlide(player)).toBe(true);
    expect(mountRail(player, 120, 2, 0)).toBe(true);
    expect(player.motion).toBe('grinding');
    expect(player.y).toBeCloseTo(RAIL.baseHeight, 6);
    expect(player.grindFromZ).toBe(120);
    expect(player.grindLane).toBe(2);
  });

  it('clears the slide, so the rail is not exited by the slide timing out', () => {
    const player = createPlayerState();
    requestSlide(player);
    mountRail(player, 0, 1, 0);

    // Well past a full slide's duration.
    for (let i = 0; i < Math.ceil(TUNING.player.slideDuration / STEP) + 10; i++) {
      stepPlayer(player, STEP);
    }
    expect(player.motion).toBe('grinding');
  });
});

describe('leaving a rail', () => {
  it('pops the player upward at the far end', () => {
    const player = createPlayerState();
    requestSlide(player);
    mountRail(player, 0, 1, 0);

    expect(stepGrind(player, RAIL.length)).toBe(false);
    expect(player.motion).toBe('airborne');
    expect(player.vy).toBeCloseTo(RAIL.exitVelocity, 6);
    expect(player.y).toBeCloseTo(railTopHeight(), 6);
  });

  it('refreshes the double jump on release, as landing does', () => {
    const player = createPlayerState();
    requestSlide(player);
    mountRail(player, 0, 1, 0);
    player.doubleJumpUsed = true;

    releaseRail(player);
    expect(player.doubleJumpUsed).toBe(false);
  });

  it('drops without a pop when the player steers off', () => {
    const player = createPlayerState();
    requestSlide(player);
    mountRail(player, 0, 1, 0);
    player.y = railHeightAt(RAIL.length / 2);

    bailRail(player);
    expect(player.motion).toBe('airborne');
    // No upward velocity: falling off is not the same as being launched.
    expect(player.vy).toBe(0);
  });

  it('lets the player jump off it', () => {
    // Without this the bar was a cage: `isGrounded` is false while grinding, so
    // a jump fell through to the double-jump branch, whose upward velocity
    // `stepGrind` overwrote with zero on the very next tick.
    const player = createPlayerState();
    requestSlide(player);
    mountRail(player, 0, 1, 0);
    stepGrind(player, RAIL.length / 2);

    expect(requestJump(player)).toBe(true);
    expect(player.motion).toBe('airborne');
    expect(player.vy).toBeCloseTo(TUNING.player.jumpVelocity, 6);
    // Leaves from the height it had reached, not from the snow.
    expect(player.y).toBeCloseTo(railHeightAt(RAIL.length / 2), 6);
  });

  it('rises after jumping off, rather than being pinned by the grind', () => {
    const player = createPlayerState();
    requestSlide(player);
    mountRail(player, 0, 1, 0);
    stepGrind(player, RAIL.length / 2);
    const from = player.y;

    requestJump(player);
    for (let i = 0; i < 10; i++) stepPlayer(player, STEP);
    expect(player.y).toBeGreaterThan(from);
  });

  it('drops the player when they slide off it', () => {
    const player = createPlayerState();
    requestSlide(player);
    mountRail(player, 0, 1, 0);
    stepGrind(player, RAIL.length / 2);

    requestSlide(player);
    expect(player.motion).toBe('airborne');
    // Driven down hard, and slides on touchdown - the same dive an airborne
    // slide does anywhere else.
    expect(player.vy).toBeLessThan(0);
    expect(player.slideQueued).toBe(true);
  });

  it('falls back to the snow after bailing rather than hanging', () => {
    const player = createPlayerState();
    requestSlide(player);
    mountRail(player, 0, 1, 0);
    player.y = railHeightAt(RAIL.length * 0.8);
    bailRail(player);

    for (let i = 0; i < 240 && player.motion === 'airborne'; i++) stepPlayer(player, STEP);
    expect(player.motion).toBe('running');
    expect(player.y).toBe(0);
  });
});

/** A runtime with streaming off, so only the staged entities exist. */
function stagedRuntime(): RuntimeState {
  const rt = createTestRuntime(7);
  rt.running = true;
  for (const obstacle of rt.track.obstacles) obstacle.active = false;
  for (const coin of rt.track.coins) coin.active = false;
  for (const rail of rt.track.rails) rail.active = false;
  rt.track.nextChunkStart = Number.MAX_SAFE_INTEGER;
  return rt;
}

function placeRail(rt: RuntimeState, lane: LaneIndex, trackZ: number) {
  const entity = rt.track.rails.find((r) => !r.active)!;
  entity.active = true;
  entity.lane = lane;
  entity.trackZ = trackZ;
  entity.used = false;
  return entity;
}

function placeObstacle(rt: RuntimeState, lane: LaneIndex, trackZ: number) {
  const entity = rt.track.obstacles.find((o) => !o.active)!;
  entity.active = true;
  entity.kind = 'boulder';
  entity.lane = lane;
  entity.trackZ = trackZ;
  entity.passed = false;
  return entity;
}

describe('riding a rail in a live run', () => {
  it('carries the player over an obstacle that would otherwise end the run', () => {
    const rt = stagedRuntime();
    placeRail(rt, 1, 30);
    // Under the far half, where the rail is high enough to clear it.
    placeObstacle(rt, 1, 30 + RAIL.length * 0.85);

    let slid = false;
    // Ride until well past the obstacle.
    while (rt.alive && rt.distance < 30 + RAIL.length + 10) {
      // Slide as the rail's near end arrives, which is the whole input.
      if (!slid && rt.distance > 30 - 2) {
        requestSlide(rt.player);
        slid = true;
      }
      tickRun(rt, STEP);
    }

    expect(slid).toBe(true);
    expect(rt.railGrinds).toBe(1);
    expect(rt.alive).toBe(true);
  });

  it('is what saves them - the same boulder without a rail ends the run', () => {
    // The counterweight, and it has to be built this way now that riding into a
    // rail mounts it. "Player does nothing" no longer distinguishes anything,
    // because doing nothing is a mount. Removing the *rail* is what isolates
    // it: if the run survived this too, the test above would be proving the
    // boulder is harmless rather than proving the rail carries you over it.
    const rt = stagedRuntime();
    placeObstacle(rt, 1, 30 + RAIL.length * 0.85);

    while (rt.alive && rt.distance < 30 + RAIL.length + 10) tickRun(rt, STEP);

    expect(rt.railGrinds).toBe(0);
    expect(rt.alive).toBe(false);
  });

  it('carries a player who rides straight into it and touches nothing', () => {
    // The reported failure, end to end.
    const rt = stagedRuntime();
    placeRail(rt, 1, 30);
    placeObstacle(rt, 1, 30 + RAIL.length * 0.85);

    while (rt.alive && rt.distance < 30 + RAIL.length + 10) tickRun(rt, STEP);

    expect(rt.railGrinds).toBe(1);
    expect(rt.alive).toBe(true);
  });

  it('does not grab a player who arrives in the lane late, under the bar', () => {
    // Steering into a rail's lane halfway along it must not teleport the player
    // three metres up onto a bar that is already over their head.
    const rt = stagedRuntime();
    placeRail(rt, 1, 30);
    // Start out of the lane and cross in once the bar is well clear overhead.
    requestLaneChange(rt.lane, -1);
    let steered = false;
    while (rt.alive && rt.distance < 30 + RAIL.length) {
      if (!steered && rt.distance > 30 + RAIL.length * 0.6) {
        requestLaneChange(rt.lane, 1);
        steered = true;
      }
      tickRun(rt, STEP);
    }

    expect(steered).toBe(true);
    expect(rt.railGrinds).toBe(0);
    expect(rt.player.motion).not.toBe('grinding');
  });

  it('drops the player when they steer out of the rail lane', () => {
    const rt = stagedRuntime();
    placeRail(rt, 1, 30);

    let slid = false;
    let steered = false;
    while (rt.alive && rt.distance < 30 + RAIL.length) {
      if (!slid && rt.distance > 30 - 2) {
        requestSlide(rt.player);
        slid = true;
      }
      if (slid && !steered && rt.player.motion === 'grinding') {
        requestLaneChange(rt.lane, 1);
        steered = true;
      }
      tickRun(rt, STEP);
      if (steered && rt.player.motion !== 'grinding') break;
    }

    expect(steered).toBe(true);
    expect(rt.player.motion).not.toBe('grinding');
    // Bailing costs the route, not the run.
    expect(rt.alive).toBe(true);
  });

  it('carries a player who jumped at it, not only one who slid', () => {
    // The reported bug, end to end: a jump at a rail did nothing, and the
    // player came down into the boulder the rail exists to carry them over.
    const rt = stagedRuntime();
    placeRail(rt, 1, 30);
    placeObstacle(rt, 1, 30 + RAIL.length * 0.85);

    let jumped = false;
    while (rt.alive && rt.distance < 30 + RAIL.length + 10) {
      if (!jumped && rt.distance > 30 - 2) {
        requestJump(rt.player);
        jumped = true;
      }
      tickRun(rt, STEP);
    }

    expect(jumped).toBe(true);
    expect(rt.railGrinds).toBe(1);
    expect(rt.alive).toBe(true);
  });

  it('catches a jump that was timed early and arcs down onto the bar', () => {
    // The jump does not have to be at the near end. Anywhere the arc crosses
    // the bar is a mount - which is what makes the mechanic forgiving enough to
    // use at speed rather than a timing puzzle with death for the prize.
    const rt = stagedRuntime();
    placeRail(rt, 1, 30);
    placeObstacle(rt, 1, 30 + RAIL.length * 0.85);

    let jumped = false;
    while (rt.alive && rt.distance < 30 + RAIL.length + 10) {
      // Eight metres early - well before the rail even starts.
      if (!jumped && rt.distance > 30 - 8) {
        requestJump(rt.player);
        jumped = true;
      }
      tickRun(rt, STEP);
    }

    expect(rt.railGrinds).toBe(1);
    expect(rt.alive).toBe(true);
  });

  it('counts a grind once even if the player pops off and catches it again', () => {
    // Re-catching a rail after jumping off it mid-grind is a trick, so it is
    // allowed - but it must not inflate the run stat or the missions built on it.
    const rt = stagedRuntime();
    const rail = placeRail(rt, 1, 30);

    while (rt.alive && rt.distance < 30 - 2) tickRun(rt, STEP);
    requestSlide(rt.player);
    while (rt.alive && rt.player.motion !== 'grinding' && rt.distance < 40) tickRun(rt, STEP);

    expect(rail.used).toBe(true);

    // Pop off and land back on the bar.
    requestJump(rt.player);
    let recaught = false;
    while (rt.alive && rt.distance < 30 + RAIL.length) {
      tickRun(rt, STEP);
      if (rt.player.motion === 'grinding') {
        recaught = true;
        break;
      }
    }

    expect(recaught).toBe(true);
    expect(rt.railGrinds).toBe(1);
  });
});

describe('authored rail chunks', () => {
  const railChunks = CHUNKS.filter((chunk) => (chunk.rails?.length ?? 0) > 0);

  it('there is at least one', () => {
    expect(railChunks.length).toBeGreaterThan(0);
  });

  it('appears in every lane', () => {
    const lanes = new Set(railChunks.flatMap((chunk) => chunk.rails!.map((rail) => rail.lane)));
    expect(lanes.size).toBe(3);
  });

  it.each(railChunks.map((chunk) => [chunk.id, chunk] as const))(
    '%s leaves a lane open, so the rail is never the only way through',
    (_id, chunk: ChunkTemplate) => {
      // Rails are invisible to the solvability check by design, so the track
      // under one has to stand on its own.
      const blocked = new Set(chunk.obstacles.map((obstacle) => obstacle.lane));
      expect(blocked.size).toBeLessThan(3);
    },
  );

  it.each(railChunks.map((chunk) => [chunk.id, chunk] as const))(
    '%s only puts obstacles where the rail is actually high enough',
    (_id, chunk: ChunkTemplate) => {
      for (const rail of chunk.rails!) {
        for (const obstacle of chunk.obstacles) {
          if (obstacle.lane !== rail.lane) continue;

          const along = obstacle.z - rail.z;
          // Anything under the rail's own span must be cleared by a rider, or
          // taking the route the coins advertise kills you.
          if (along < 0 || along > TUNING.rail.length) continue;

          const def = obstacleDef(obstacle.kind);
          const top = def.centreY + def.halfHeight;
          expect(railHeightAt(along)).toBeGreaterThan(top);
        }
      }
    },
  );

  it.each(railChunks.map((chunk) => [chunk.id, chunk] as const))(
    '%s puts its coin line on the rail, not beside it',
    (_id, chunk: ChunkTemplate) => {
      const railed = chunk.coins.filter((run) => run.railFrom !== undefined);
      expect(railed.length).toBeGreaterThan(0);

      const coins = expandCoins(chunk, 0, TUNING.coins.baseHeight, TUNING.coins.arcPeak, 1.4);
      const rail = chunk.rails![0]!;
      const onRail = coins.filter((coin) => coin.lane === rail.lane);
      expect(onRail.length).toBeGreaterThan(4);

      // The line has to climb, or it is just a flat run that happens to sit
      // near a rail and nothing rewards riding it.
      const lowest = Math.min(...onRail.map((coin) => coin.y));
      const highest = Math.max(...onRail.map((coin) => coin.y));
      expect(highest - lowest).toBeGreaterThan(RAIL.rise * 0.7);
    },
  );
});

/**
 * Mounting, measured against the real generator rather than a staged rail.
 *
 * The staged tests above prove the mount *can* work. They cannot prove it
 * usually does, and "usually does" is the whole of whether the mechanic is
 * playable - a rail that takes the input two times in three is worse than no
 * rail at all, because the player has committed to its lane by the time they
 * find out. So this drives an autopilot down real tracks at real speeds and
 * asserts a rate, which is the only form of this claim worth making.
 */
describe('mounting on a real track', () => {
  const LEN = TUNING.rail.length;

  /** `requestLaneChange` takes a direction, not a target - step towards one. */
  function steerTo(lane: { targetLane: number }, want: number): void {
    if (lane.targetLane === want) return;
    requestLaneChange(lane as never, (want > lane.targetLane ? 1 : -1) as never);
  }

  /**
   * Rides `seeds` runs, taking every rail with a single input `lead` metres out.
   *
   * Obstacles away from rails are cleared: this autopilot only knows how to
   * chase rails, and would otherwise die in the first hundred metres, long
   * before tier 1 unlocks any. The obstacles that matter - the ones a rail
   * carries you over, and the ones in its landing zone - are left in place.
   */
  function rideRails(seeds: number, action: 'jump' | 'slide' | 'none', lead: number) {
    let resolved = 0;
    let mounted = 0;
    let died = 0;

    for (let seed = 0; seed < seeds; seed++) {
      const rt = createTestRuntime(seed);
      rt.running = true;
      const handled = new Set<number>();
      let watching: { trackZ: number; lane: LaneIndex } | null = null;
      let mountedThis = false;
      let fired = false;
      let flew = false;

      while (rt.alive && rt.distance < 3000) {
        for (const obstacle of rt.track.obstacles) {
          if (!obstacle.active) continue;
          const nearRail = rt.track.rails.some(
            (rail) =>
              rail.active &&
              obstacle.trackZ > rail.trackZ &&
              obstacle.trackZ < rail.trackZ + LEN + 30,
          );
          if (!nearRail) obstacle.active = false;
        }

        for (const bar of rt.track.rails) {
          if (!bar.active || handled.has(bar.trackZ) || watching) continue;
          const ahead = bar.trackZ - rt.distance;
          // Ignore rails too near the end of the sampled run to resolve, or a
          // run stopping mid-grind would be scored as a mount that failed.
          if (ahead > 0 && ahead < 30 && bar.trackZ + LEN + 40 < 3000) {
            watching = { trackZ: bar.trackZ, lane: bar.lane };
            mountedThis = false;
            fired = false;
            flew = false;
          }
        }

        if (watching) {
          // A Chairlift carries the player five metres above the track, where
          // refusing the mount is correct - they are already over everything the
          // rail would have lifted them past. Those encounters are dropped from
          // the sample rather than counted as failures.
          if (rt.player.motion === 'flying') flew = true;
          steerTo(rt.lane, watching.lane);
          if (!fired && watching.trackZ - rt.distance <= lead) {
            if (action === 'jump') requestJump(rt.player);
            else if (action === 'slide') requestSlide(rt.player);
            fired = true;
          }
          if (rt.player.motion === 'grinding') mountedThis = true;

          if (rt.distance > watching.trackZ + LEN + 30) {
            if (!flew) {
              resolved++;
              if (mountedThis) mounted++;
            }
            handled.add(watching.trackZ);
            watching = null;
          }
        }

        const wasAlive = rt.alive;
        const onRail = watching !== null;
        tickRun(rt, STEP);
        // Only deaths *while taking a rail* count - from the approach, through
        // the grind, to the end of the protected landing. This autopilot has no
        // dodging logic at all, so deaths after that window are its own doing
        // and say nothing about rails.
        if (wasAlive && !rt.alive && onRail) died++;
      }
    }

    return { resolved, mounted, died };
  }

  it('finds rails to ride at all', () => {
    // The counterweight: every rate below is trivially 100% over zero rails.
    const { resolved } = rideRails(24, 'jump', 6);
    expect(resolved).toBeGreaterThan(100);
  });

  it('takes a rail from a player who steers into it and presses nothing', () => {
    // The reported failure, on real track: going at it in a straight line. No
    // jump, no slide, no timing - the thing every player tries first.
    const { resolved, mounted } = rideRails(24, 'none', 0);
    expect(resolved).toBeGreaterThan(100);
    expect(mounted / resolved).toBeGreaterThan(0.99);
  });

  it.each([
    ['jump', 0],
    ['jump', 6],
    ['jump', 14],
    ['slide', 0],
    ['slide', 6],
    ['slide', 14],
  ] as const)('takes a %s given %i metres out', (action, lead) => {
    // Fourteen metres out is a very early read and zero is the last moment; a
    // player lands somewhere between. The rate has to hold across the range,
    // because a mechanic that only works at one timing is a timing puzzle.
    const { resolved, mounted } = rideRails(24, action, lead);
    expect(mounted / resolved).toBeGreaterThan(0.99);
  });

  it('never kills a player between taking a rail and landing off it', () => {
    // Mounting is only worth anything if surviving follows from it. Rails are
    // the one route where the reward and the danger are the same object: the
    // obstacle under the bar is what the rail exists to clear, and the exit is
    // a fall the player cannot act during.
    const { died } = rideRails(24, 'jump', 6);
    expect(died).toBe(0);
  });

  it('is what keeps them alive - the same track without rails kills', () => {
    // The counterweight to the test above, and it has to isolate the *rail*
    // rather than the player's input: riding into one now mounts it, so there
    // is no "does nothing" case left to compare against. This drives the same
    // autopilot down the same seeds with every rail deactivated, leaving the
    // obstacles the rails exist to carry you over exactly where they were.
    let died = 0;

    for (let seed = 0; seed < 24; seed++) {
      const rt = createTestRuntime(seed);
      rt.running = true;
      let lane = 1;

      while (rt.alive && rt.distance < 3000) {
        for (const obstacle of rt.track.obstacles) {
          if (!obstacle.active) continue;
          const nearRail = rt.track.rails.some(
            (rail) =>
              obstacle.trackZ > rail.trackZ && obstacle.trackZ < rail.trackZ + LEN + 30,
          );
          if (!nearRail) obstacle.active = false;
        }
        for (const bar of rt.track.rails) {
          if (!bar.active) continue;
          // Commit to the lane, then take the rail away.
          const ahead = bar.trackZ - rt.distance;
          if (ahead > 0 && ahead < 30) lane = bar.lane;
          bar.active = false;
        }
        steerTo(rt.lane, lane);

        const wasAlive = rt.alive;
        tickRun(rt, STEP);
        if (wasAlive && !rt.alive) died++;
      }
    }

    expect(died).toBeGreaterThan(0);
  });
});
