/**
 * Grind rails.
 *
 * A **level** steel bar running down a lane, mounted by ollieing onto it, with
 * its length authored per rail. Ride into one on the snow and you go down;
 * jump onto it and you grind until it runs out or you steer off.
 *
 * This replaced a rail that rose from ankle height to nearly four metres and was
 * ridden onto at its low end. That version was a lift wearing a rail's name: it
 * carried the player *over* things rather than asking anything of them, and the
 * one input everybody tries at a rail was not how you got on.
 *
 * The consequence worth stating, because it inverts a rule that held for the old
 * one: a rail is no longer free. It stands in its lane, so the solvability proof
 * counts it as a jumpable rather than being told it is not there. Ramps are
 * still exempt - taking one can only help - but a bar you can crash into cannot
 * be.
 */

import { describe, expect, it } from 'vitest';
import { TUNING, type LaneIndex } from '@/game/config/tuning';
import { CHUNKS } from '@/game/content/chunks';
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
import { railExitAirTime, railHeight, railLandingDistance } from '@/game/systems/rail';
import { tickRun } from '@/game/systems/simulation';

const STEP = TUNING.sim.step;
const RAIL = TUNING.rail;

describe('the bar', () => {
  it('is level - the same height everywhere along it', () => {
    // The whole difference from the version this replaced. A rail that climbs is
    // a ramp, and gets used like one.
    expect(railHeight()).toBe(RAIL.height);
  });

  it('sits too high to run under', () => {
    // If a standing player fitted beneath it, riding into a rail would be free
    // and landing the ollie would be worth nothing.
    const underside = RAIL.height - RAIL.halfHeight;
    expect(underside).toBeLessThan(TUNING.player.halfHeight * 2);
  });

  it('sits too low to slide under', () => {
    // There is one answer to a rail and it is to jump. The height is set so that
    // this is a fact about the geometry rather than a rule imposed on top of it:
    // the underside is below a sliding player, so there is nothing to duck
    // beneath and the collider never has to contradict what it looks like.
    const underside = RAIL.height - RAIL.halfHeight;
    expect(TUNING.player.slideHalfHeight * 2).toBeGreaterThan(underside);
  });

  it('is low enough that an ollie clears it early in the arc', () => {
    // Feet have to pass the bar height well before the apex, or catching it
    // would mean jumping at one exact distance rather than roughly the right one.
    expect(RAIL.height).toBeLessThan(TUNING.player.jumpPeakHeight * 0.5);
  });

  it('drops the player a short way when it ends', () => {
    // A dismount, not a launch. The sloped rail threw the player off its high
    // end into a long committed fall the generator had to reserve track for.
    expect(railExitAirTime()).toBeLessThan(0.3);
    expect(railLandingDistance(TUNING.speed.max)).toBeLessThan(12);
  });
});

describe('mounting', () => {
  it('takes a jump, which is the one input a rail asks for', () => {
    const player = createPlayerState();
    expect(requestJump(player)).toBe(true);
    player.y = RAIL.height;

    expect(mountRail(player, 0, 1, 0)).toBe(true);
    expect(player.motion).toBe('grinding');
    expect(player.y).toBeCloseTo(RAIL.height, 6);
  });

  it('refuses a player on the snow, however they are moving', () => {
    // Running or sliding, they are underneath it. Stepping onto a bar from the
    // ground is what made the old rail a lift.
    for (const motion of ['running', 'sliding', 'flying'] as const) {
      const player = createPlayerState();
      player.motion = motion;
      expect(mountRail(player, 0, 1, 0)).toBe(false);
      expect(player.motion).toBe(motion);
    }
  });

  it('catches an ollie anywhere along the bar', () => {
    // Jump timing is never going to be metre-perfect. Wherever the arc crosses
    // the bar, that is where the grind starts.
    for (const along of [0, 3, 7, 12]) {
      const player = createPlayerState();
      player.motion = 'airborne';
      player.y = RAIL.height;
      player.vy = -2;

      expect(mountRail(player, 40, 1, along)).toBe(true);
      expect(player.grindFromZ).toBe(40);
    }
  });

  it('does not catch a jump passing well clear of it', () => {
    const player = createPlayerState();
    player.motion = 'airborne';
    player.y = RAIL.height + RAIL.catchHeight + 0.3;
    expect(mountRail(player, 0, 1, 0)).toBe(false);
  });

  it('leaves a committed ramp flight alone', () => {
    // A ramp arc is a fixed flight the player cannot abort; a rail plucking them
    // out of it would drop them somewhere the chalet still stands.
    const player = createPlayerState();
    player.motion = 'airborne';
    player.ramping = true;
    player.y = RAIL.height;
    expect(mountRail(player, 0, 1, 0)).toBe(false);
  });
});

describe('riding', () => {
  function mounted() {
    const player = createPlayerState();
    player.motion = 'airborne';
    player.y = RAIL.height;
    mountRail(player, 0, 1, 0);
    return player;
  }

  it('holds the player at bar height for the rail it is on', () => {
    const player = mounted();
    for (const along of [1, 4, 8]) {
      expect(stepGrind(player, along, 12)).toBe(true);
      expect(player.y).toBeCloseTo(RAIL.height, 6);
    }
  });

  it('ends at the length the rail was authored with, not a fixed one', () => {
    // The point of an authored length. A short bar has to finish short.
    for (const length of [4, 9, 16]) {
      const player = mounted();
      expect(stepGrind(player, length - 0.5, length)).toBe(true);
      expect(stepGrind(player, length, length)).toBe(false);
      expect(player.motion).toBe('airborne');
    }
  });

  it('ignores gravity while grinding', () => {
    const player = mounted();
    for (let i = 0; i < 30; i++) stepPlayer(player, STEP);
    expect(player.y).toBeCloseTo(RAIL.height, 6);
    expect(player.motion).toBe('grinding');
  });

  it('lets the player jump off it', () => {
    const player = mounted();
    expect(requestJump(player)).toBe(true);
    expect(player.motion).toBe('airborne');
    expect(player.vy).toBeCloseTo(TUNING.player.jumpVelocity, 6);
  });

  it('lets the player slide off it', () => {
    const player = mounted();
    requestSlide(player);
    expect(player.motion).toBe('airborne');
    expect(player.vy).toBeLessThan(0);
  });

  it('drops without a pop when they steer off', () => {
    const player = mounted();
    bailRail(player);
    expect(player.motion).toBe('airborne');
    expect(player.vy).toBe(0);
  });

  it('refreshes the double jump on release, as landing does', () => {
    const player = mounted();
    player.doubleJumpUsed = true;
    releaseRail(player);
    expect(player.doubleJumpUsed).toBe(false);
  });

  it('returns to the snow after coming off rather than hanging', () => {
    const player = mounted();
    bailRail(player);
    for (let i = 0; i < 240 && player.motion === 'airborne'; i++) stepPlayer(player, STEP);
    expect(player.motion).toBe('running');
    expect(player.y).toBe(0);
  });
});

/** A runtime with streaming off, so only the staged rail exists. */
function stagedRuntime(): RuntimeState {
  const rt = createTestRuntime(5);
  rt.running = true;
  for (const obstacle of rt.track.obstacles) obstacle.active = false;
  for (const coin of rt.track.coins) coin.active = false;
  for (const rail of rt.track.rails) rail.active = false;
  for (const pickup of rt.track.pickups) pickup.active = false;
  rt.track.nextPickupAt = Number.MAX_SAFE_INTEGER;
  rt.track.nextChunkStart = Number.MAX_SAFE_INTEGER;
  return rt;
}

function placeRail(rt: RuntimeState, lane: LaneIndex, trackZ: number, length: number) {
  const entity = rt.track.rails.find((r) => !r.active)!;
  entity.active = true;
  entity.lane = lane;
  entity.trackZ = trackZ;
  entity.length = length;
  entity.used = false;
  return entity;
}

/** Approaches a staged rail, optionally jumping `lead` metres before it. */
function ride(lead: number | null, length = 10, action: 'jump' | 'slide' = 'jump') {
  const rt = stagedRuntime();
  placeRail(rt, 1, 60, length);

  let fired = false;
  let grinded = false;

  while (rt.alive && rt.distance < 60 + length + 12) {
    if (lead !== null && !fired && rt.distance >= 60 - lead) {
      if (action === 'jump') requestJump(rt.player);
      else requestSlide(rt.player);
      fired = true;
    }
    tickRun(rt, STEP);
    if (rt.player.motion === 'grinding') grinded = true;
  }

  return { grinded, grinds: rt.railGrinds, alive: rt.alive, stumbles: rt.stumbles };
}

describe('a rail in a live run', () => {
  const leads: number[] = [];
  for (let lead = 1; lead <= 14; lead += 0.5) leads.push(Number(lead.toFixed(1)));
  const catching = leads.filter((lead) => ride(lead).grinded);

  it('can be caught from a wide range of run-ups', () => {
    // Swept rather than hand-picked. One lead that happens to work proves the
    // mount can fire; only a range proves it is something a thumb can aim at.
    expect(catching.length).toBeGreaterThan(8);
  });

  it('counts the grind once', () => {
    const result = ride(catching[Math.floor(catching.length / 2)] as number);
    expect(result.grinds).toBe(1);
    expect(result.alive).toBe(true);
  });

  it('ends the run for a player who rides straight into it', () => {
    // The counterweight, and it has to be a death rather than a trip. A drift or
    // a log is something you clip and ride out of; a steel bar at shin height is
    // not, and a rail that merely slowed you down would make ignoring it cheaper
    // than learning to ollie it.
    const result = ride(null);
    expect(result.grinded).toBe(false);
    expect(result.alive).toBe(false);
    expect(result.stumbles).toBe(0);
  });

  it('ends the run for a player who tries to duck under it', () => {
    // Sliding is not a way past. The counterweight to the sweep above: if any
    // input got you through, catching the bar would be optional and the range of
    // working run-ups would be measuring nothing.
    const result = ride(2, 10, 'slide');
    expect(result.grinded).toBe(false);
    expect(result.alive).toBe(false);
  });

  it('drops the player when they steer out of its lane', () => {
    const rt = stagedRuntime();
    placeRail(rt, 1, 60, 14);

    let steered = false;
    while (rt.alive && rt.distance < 74) {
      if (rt.distance >= 54 && rt.player.motion !== 'grinding' && !steered) requestJump(rt.player);
      if (!steered && rt.player.motion === 'grinding') {
        requestLaneChange(rt.lane, 1);
        steered = true;
      }
      tickRun(rt, STEP);
      if (steered && rt.player.motion !== 'grinding') break;
    }

    expect(steered).toBe(true);
    expect(rt.player.motion).not.toBe('grinding');
    // Coming off costs the rest of the line, not the run.
    expect(rt.alive).toBe(true);
  });

  it('rides the whole of a long bar and only the whole of a short one', () => {
    // Authored length, end to end through the real simulation rather than
    // through `stepGrind` alone.
    const short = stagedRuntime();
    placeRail(short, 1, 60, 4);
    const long = stagedRuntime();
    placeRail(long, 1, 60, 16);

    const heldFor = (rt: RuntimeState, length: number) => {
      let start: number | null = null;
      let end: number | null = null;
      let fired = false;
      while (rt.alive && rt.distance < 60 + length + 12) {
        if (!fired && rt.distance >= 57) {
          requestJump(rt.player);
          fired = true;
        }
        tickRun(rt, STEP);
        if (rt.player.motion === 'grinding') {
          start ??= rt.distance;
          end = rt.distance;
        }
      }
      return start === null ? 0 : (end as number) - start;
    };

    const shortHeld = heldFor(short, 4);
    const longHeld = heldFor(long, 16);
    expect(longHeld).toBeGreaterThan(shortHeld * 2);
  });
});

describe('authored rails', () => {
  const railChunks = CHUNKS.filter((chunk) => (chunk.rails?.length ?? 0) > 0);

  it('exist', () => {
    expect(railChunks.length).toBeGreaterThan(0);
  });

  it('come in more than one length', () => {
    // A library with one length has one idea in it, and the authored `length`
    // would be a parameter nobody used.
    const lengths = new Set(
      railChunks.flatMap((chunk) =>
        (chunk.rails ?? []).map((rail) => rail.length ?? RAIL.length),
      ),
    );
    expect(lengths.size).toBeGreaterThan(2);
  });

  it('appear in more than one lane', () => {
    const lanes = new Set(railChunks.flatMap((chunk) => (chunk.rails ?? []).map((r) => r.lane)));
    expect(lanes.size).toBeGreaterThan(1);
  });

  it('carry a coin line along the bar', () => {
    // The payoff. A rail that pays nothing is a hazard with extra steps, and
    // this one no longer rescues the player from anything to make up for it.
    for (const chunk of railChunks) {
      const railed = chunk.coins.filter((run) => run.railFrom !== undefined);
      expect(railed.length, `${chunk.id} has no coins on its rail`).toBeGreaterThan(0);
    }
  });
});
