/**
 * Ramp arcs.
 *
 * The load-bearing property is speed invariance: the flight must trace the same
 * curve through the world at every speed. If it does not, a chalet placed to be
 * clearable early in a run silently becomes an unavoidable wall once the speed
 * ramps up - and that failure would only ever show up in a late-game run.
 */

import { describe, expect, it } from 'vitest';
import { LANES, TUNING } from '@/game/config/tuning';
import { CHUNKS } from '@/game/content/chunks';
import { obstacleDef } from '@/game/content/obstacles';
import { aabbOverlap, createAabb, type Aabb } from '@/game/systems/collision';
import { createPlayerState, isGrounded, launchFromRamp, requestJump, stepPlayer, writePlayerAabb } from '@/game/systems/player';
import { rampAirTime, rampArcHeight, rampGravity, rampLaunchVelocity } from '@/game/systems/ramp';

const STEP = TUNING.sim.step;
const SHRINK = 1 - TUNING.collision.forgiveness;
const SPEEDS = [TUNING.speed.start, 16, 20, 25, TUNING.speed.max];

/** Flies a ramp launch and samples the player's foot height against distance. */
function flightProfile(speed: number): { distance: number; y: number }[] {
  const player = createPlayerState();
  launchFromRamp(player, speed);

  const samples: { distance: number; y: number }[] = [];
  let distance = 0;

  while (!isGrounded(player) && distance < TUNING.ramp.airDistance * 3) {
    stepPlayer(player, STEP);
    distance += speed * STEP;
    samples.push({ distance, y: player.y });
  }

  return samples;
}

describe('rampArcHeight', () => {
  it('is zero at the launch point and at the landing point', () => {
    expect(rampArcHeight(0)).toBe(0);
    expect(rampArcHeight(TUNING.ramp.airDistance)).toBe(0);
  });

  it('peaks at the configured height, halfway along', () => {
    expect(rampArcHeight(TUNING.ramp.airDistance / 2)).toBeCloseTo(TUNING.ramp.peakHeight, 9);
  });

  it('is zero outside the flight', () => {
    expect(rampArcHeight(-5)).toBe(0);
    expect(rampArcHeight(TUNING.ramp.airDistance + 5)).toBe(0);
  });

  it('is symmetric about the peak', () => {
    const d = TUNING.ramp.airDistance;
    for (const u of [0.1, 0.25, 0.4]) {
      expect(rampArcHeight(d * u)).toBeCloseTo(rampArcHeight(d * (1 - u)), 9);
    }
  });

  it('never exceeds the peak height', () => {
    for (let d = 0; d <= TUNING.ramp.airDistance; d += 0.25) {
      expect(rampArcHeight(d)).toBeLessThanOrEqual(TUNING.ramp.peakHeight + 1e-9);
    }
  });
});

describe('launch parameters', () => {
  it('shortens the flight in time as speed rises', () => {
    expect(rampAirTime(30)).toBeLessThan(rampAirTime(12));
  });

  it('scales velocity and gravity so the arc covers the same ground', () => {
    for (const speed of SPEEDS) {
      const t = rampAirTime(speed);
      const v0 = rampLaunchVelocity(speed);
      const g = rampGravity(speed);
      // Peak height from the launch parameters must be the configured peak.
      expect((v0 * v0) / (2 * g)).toBeCloseTo(TUNING.ramp.peakHeight, 6);
      // And the flight must last exactly the solved airtime.
      expect((2 * v0) / g).toBeCloseTo(t, 6);
    }
  });

  it('refuses to launch an airborne player', () => {
    const player = createPlayerState();
    requestJump(player);
    expect(launchFromRamp(player, 20)).toBe(false);
  });

  it('refuses a nonsensical speed rather than producing an infinite arc', () => {
    for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const player = createPlayerState();
      expect(launchFromRamp(player, bad)).toBe(false);
      expect(player.motion).toBe('running');
    }
  });

  it('cancels a slide when launching', () => {
    const player = createPlayerState();
    player.motion = 'sliding';
    player.slideTimer = 0.5;
    expect(launchFromRamp(player, 20)).toBe(true);
    expect(player.slideTimer).toBe(0);
    expect(player.ramping).toBe(true);
  });

  it('clears the ramping flag on landing, so the next jump is a normal jump', () => {
    const player = createPlayerState();
    launchFromRamp(player, 20);
    while (!isGrounded(player)) stepPlayer(player, STEP);
    expect(player.ramping).toBe(false);
    expect(player.rampGravity).toBe(0);
    expect(player.y).toBe(0);
  });
});

describe('speed invariance', () => {
  it('reaches the same peak height at every speed', () => {
    for (const speed of SPEEDS) {
      const peak = Math.max(...flightProfile(speed).map((s) => s.y));
      expect(peak).toBeGreaterThan(TUNING.ramp.peakHeight * 0.95);
      expect(peak).toBeLessThan(TUNING.ramp.peakHeight * 1.05);
    }
  });

  it('covers the same ground at every speed', () => {
    for (const speed of SPEEDS) {
      const profile = flightProfile(speed);
      const landed = profile[profile.length - 1]!.distance;
      expect(landed).toBeGreaterThan(TUNING.ramp.airDistance * 0.93);
      expect(landed).toBeLessThan(TUNING.ramp.airDistance * 1.07);
    }
  });

  it('matches the analytic arc at every speed and every point along it', () => {
    for (const speed of SPEEDS) {
      for (const sample of flightProfile(speed)) {
        if (sample.distance >= TUNING.ramp.airDistance) continue;
        // The integrator is exact for constant acceleration, so the only
        // discrepancy is where the sampled distance falls between two ticks.
        expect(Math.abs(sample.y - rampArcHeight(sample.distance))).toBeLessThan(0.02);
      }
    }
  });
});

describe('authored ramp chunks', () => {
  const rampChunks = CHUNKS.filter((chunk) => (chunk.ramps?.length ?? 0) > 0);

  it('there is at least one', () => {
    expect(rampChunks.length).toBeGreaterThan(0);
  });

  it.each(rampChunks.map((chunk) => [chunk.id, chunk] as const))(
    '%s puts every chalet at the apex of its ramp',
    (_id, chunk) => {
      const chalets = chunk.obstacles.filter((obstacle) => obstacle.kind === 'chalet');
      expect(chalets.length).toBeGreaterThan(0);

      for (const chalet of chalets) {
        const ramp = chunk.ramps!.find(
          (candidate) => Math.abs(chalet.z - candidate.z - TUNING.ramp.chaletGap) < 1e-9,
        );
        // A chalet without a ramp at exactly the apex distance is either
        // unreachable by air or, worse, a wall the arc clips into.
        const inRampLane = chunk.ramps!.some((candidate) => candidate.lane === chalet.lane);
        if (inRampLane) expect(ramp).toBeDefined();
      }
    },
  );

  it.each(rampChunks.map((chunk) => [chunk.id, chunk] as const))(
    '%s always leaves a lane free of chalets, so the ramp is never mandatory',
    (_id, chunk) => {
      const blockedLanes = new Set(
        chunk.obstacles.filter((obstacle) => obstacle.kind === 'chalet').map((o) => o.lane),
      );
      expect(blockedLanes.size).toBeLessThan(LANES.length);
    },
  );

  it('can launch the player from every lane', () => {
    // Every ramp used to sit in the centre lane bar one tier-3 chunk, so for
    // most of a run the greedy line was always straight ahead and the outer
    // lanes never held the reward. A ramp you never have to steer towards is
    // not a choice.
    const rampLanes = new Set(rampChunks.flatMap((chunk) => chunk.ramps!.map((r) => r.lane)));
    for (let lane = 0; lane < LANES.length; lane++) {
      expect(rampLanes).toContain(lane);
    }
  });

  it('offers an off-centre ramp from the moment ramps appear at all', () => {
    // Spreading them across lanes is worth nothing if the variants only unlock
    // in the last tier, which is exactly how this was skewed before.
    const earliest = Math.min(...rampChunks.map((chunk) => chunk.tier));
    const lanesAtEarliestTier = new Set(
      rampChunks
        .filter((chunk) => chunk.tier === earliest)
        .flatMap((chunk) => chunk.ramps!.map((ramp) => ramp.lane)),
    );
    expect(lanesAtEarliestTier.size).toBe(LANES.length);
  });

  it('does not weight the centre lane above the outer ones', () => {
    const weightByLane = new Map<number, number>();
    for (const chunk of rampChunks) {
      for (const ramp of chunk.ramps!) {
        weightByLane.set(ramp.lane, (weightByLane.get(ramp.lane) ?? 0) + chunk.weight);
      }
    }

    const centre = weightByLane.get(1) ?? 0;
    const outer = (weightByLane.get(0) ?? 0) + (weightByLane.get(2) ?? 0);
    // Two outer lanes against one centre: the centre should not out-weigh both.
    expect(centre).toBeLessThanOrEqual(outer);
  });
});

describe('clearing a chalet', () => {
  const chalet = obstacleDef('chalet');

  function chaletBox(worldZ: number): Aabb {
    return {
      x: 0,
      y: chalet.centreY,
      z: worldZ,
      hx: chalet.halfWidth * SHRINK,
      hy: chalet.halfHeight * SHRINK,
      hz: chalet.halfDepth * SHRINK,
    };
  }

  /** Launches at the ramp and reports whether the chalet was cleared. */
  function fliesOverChalet(speed: number, gap: number): boolean {
    const player = createPlayerState();
    const box = createAabb();
    launchFromRamp(player, speed);

    // The chalet sits `gap` metres ahead of the launch point.
    let chaletZ = -gap;

    while (chaletZ < 8) {
      stepPlayer(player, STEP);
      chaletZ += speed * STEP;

      writePlayerAabb(player, 0, box);
      const shrunk: Aabb = {
        ...box,
        hx: box.hx * SHRINK,
        hy: box.hy * SHRINK,
        hz: box.hz * SHRINK,
      };
      if (aabbOverlap(shrunk, chaletBox(chaletZ))) return false;
    }

    return true;
  }

  it.each(SPEEDS)('clears the chalet at the authored gap, at speed %d', (speed) => {
    expect(fliesOverChalet(speed, TUNING.ramp.chaletGap)).toBe(true);
  });

  it('is not clearable by an ordinary jump, so the ramp is the only air route', () => {
    for (const speed of SPEEDS) {
      const player = createPlayerState();
      const box = createAabb();
      requestJump(player);

      let hit = false;
      let chaletZ = -TUNING.ramp.chaletGap;
      while (chaletZ < 8) {
        stepPlayer(player, STEP);
        chaletZ += speed * STEP;
        writePlayerAabb(player, 0, box);
        const shrunk: Aabb = {
          ...box,
          hx: box.hx * SHRINK,
          hy: box.hy * SHRINK,
          hz: box.hz * SHRINK,
        };
        if (aabbOverlap(shrunk, chaletBox(chaletZ))) {
          hit = true;
          break;
        }
      }

      expect(hit).toBe(true);
    }
  });
});
