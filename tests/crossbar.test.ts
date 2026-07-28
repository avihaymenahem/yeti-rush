/**
 * Jib crossbars.
 *
 * A steel bar set across the piste rather than along it. Unlike a grind rail
 * there is nothing to ride: the world scrolls along Z, so a bar perpendicular to
 * it passes underneath in a few hundredths of a second at any speed. What it
 * offers instead is precision - clear it high and nothing happens, or clip the
 * top of your arc off it and get paid.
 *
 * Two things here would break the rest of the game if they went wrong. A
 * crossbar is *mechanically a jumpable*, so the solvability check has to see it
 * as one; and its authored `span` has to become real per-lane obstacles, or a
 * bar across the whole piste would be read as a single blocked lane and the
 * spacing rule that keeps forced actions apart would never fire for it.
 */

import { describe, expect, it } from 'vitest';
import { LANES, TUNING, type LaneIndex } from '@/game/config/tuning';
import {
  CHUNKS,
  expandObstacles,
  forcedActionRows,
  obstacleLanes,
  type ChunkTemplate,
} from '@/game/content/chunks';
import { obstacleDef } from '@/game/content/obstacles';
import { createTestRuntime, type RuntimeState } from '@/game/state/runtime';
import { requestJump } from '@/game/systems/player';
import { tickRun } from '@/game/systems/simulation';

const STEP = TUNING.sim.step;
const BAR = obstacleDef('crossbar');
const BAR_TOP = BAR.centreY + BAR.halfHeight;

describe('the bar itself', () => {
  it('is a jumpable, so the solvability check already understands it', () => {
    // The whole reason this needed no new support anywhere: a crossbar is an
    // obstacle with a jump answer, exactly like a log.
    expect(BAR.action).toBe('jump');
  });

  it('is low enough to clear with an ordinary jump', () => {
    // If the bar were near the apex, clearing it would be frame-perfect and a
    // forced full-width one would be a wall rather than a jump.
    expect(BAR_TOP).toBeLessThan(TUNING.player.jumpPeakHeight * 0.7);
  });

  it('stands above a slide, so ducking is not a way past it', () => {
    // A jumpable that can also be slid under has two answers, and an obstacle
    // with two answers teaches neither.
    expect(BAR_TOP).toBeGreaterThan(TUNING.player.slideHalfHeight * 2);
  });
});

describe('authored span', () => {
  it('covers one lane by default', () => {
    expect(obstacleLanes({ kind: 'crossbar', lane: 1, z: 0 })).toEqual([1]);
  });

  it('covers the lanes it says it does', () => {
    expect(obstacleLanes({ kind: 'crossbar', lane: 0, z: 0, span: 2 })).toEqual([0, 1]);
    expect(obstacleLanes({ kind: 'crossbar', lane: 0, z: 0, span: 3 })).toEqual([0, 1, 2]);
  });

  it('clamps a span running off the edge rather than wrapping it', () => {
    // Wrapping would put a bar in the far lane with a gap in the middle, which
    // is not a bar. Clamping shortens it, which is.
    expect(obstacleLanes({ kind: 'crossbar', lane: 2, z: 0, span: 3 })).toEqual([2]);
    expect(obstacleLanes({ kind: 'crossbar', lane: 1, z: 0, span: 5 })).toEqual([1, 2]);
  });

  it('becomes one real obstacle per lane when placed', () => {
    const chunk: ChunkTemplate = {
      id: 'test',
      tier: 0,
      weight: 1,
      obstacles: [{ kind: 'crossbar', lane: 0, z: 10, span: 3 }],
      coins: [],
    };

    const placed = expandObstacles(chunk, 100);
    expect(placed).toHaveLength(3);
    expect(placed.map((p) => p.lane).sort()).toEqual([0, 1, 2]);
    // One bar is one row: every segment sits at the same distance.
    expect(new Set(placed.map((p) => p.z))).toEqual(new Set([110]));
  });

  it('mirrors as a whole rather than one end of it', () => {
    // Expanded before mirroring, each covered lane reflects independently - so a
    // two-lane bar on the left comes back as a two-lane bar on the right, not as
    // something straddling the middle.
    const chunk: ChunkTemplate = {
      id: 'test',
      tier: 0,
      weight: 1,
      obstacles: [{ kind: 'crossbar', lane: 0, z: 10, span: 2 }],
      coins: [],
    };

    const mirrored = expandObstacles(chunk, 0, true).map((p) => p.lane).sort();
    expect(mirrored).toEqual([1, 2]);
  });

  it('makes a full-width bar count as a forced action', () => {
    // The failure this guards against is silent. Read as a single entry, a bar
    // across the whole piste looks like one blocked lane, the row is classed as
    // steerable, and the rule keeping two forced actions apart never fires for
    // the obstacle that most needs it.
    const chunk: ChunkTemplate = {
      id: 'test',
      tier: 0,
      weight: 1,
      obstacles: [{ kind: 'crossbar', lane: 0, z: 10, span: LANES.length }],
      coins: [],
    };

    expect(forcedActionRows(chunk)).toEqual([10]);
  });

  it('leaves a partial bar steerable', () => {
    // The counterweight: if every bar were forced, the test above would be
    // measuring the span code rather than the row logic.
    const chunk: ChunkTemplate = {
      id: 'test',
      tier: 0,
      weight: 1,
      obstacles: [{ kind: 'crossbar', lane: 0, z: 10, span: 2 }],
      coins: [],
    };

    expect(forcedActionRows(chunk)).toEqual([]);
  });
});

/** A runtime with streaming off, so only the staged bar exists. */
function stagedRuntime(): RuntimeState {
  const rt = createTestRuntime(11);
  rt.running = true;
  for (const obstacle of rt.track.obstacles) obstacle.active = false;
  for (const coin of rt.track.coins) coin.active = false;
  for (const rail of rt.track.rails) rail.active = false;
  for (const pickup of rt.track.pickups) pickup.active = false;
  rt.track.nextPickupAt = Number.MAX_SAFE_INTEGER;
  rt.track.nextChunkStart = Number.MAX_SAFE_INTEGER;
  return rt;
}

function placeBar(rt: RuntimeState, lane: LaneIndex, trackZ: number) {
  const entity = rt.track.obstacles.find((o) => !o.active)!;
  entity.active = true;
  entity.kind = 'crossbar';
  entity.lane = lane;
  entity.trackZ = trackZ;
  entity.passed = false;
  return entity;
}

/** Runs until past `trackZ`, jumping `lead` metres before it if asked. */
function approach(rt: RuntimeState, trackZ: number, lead: number | null) {
  let jumped = false;
  while (rt.alive && rt.distance < trackZ + 6) {
    if (lead !== null && !jumped && rt.distance >= trackZ - lead) {
      requestJump(rt.player);
      jumped = true;
    }
    tickRun(rt, STEP);
  }
}

/** Jumps `lead` metres before the bar and reports what happened. */
function tryLead(lead: number) {
  const rt = stagedRuntime();
  placeBar(rt, 1, 60);

  let jumped = false;
  let vyAtTap: number | null = null;

  while (rt.alive && rt.distance < 68) {
    if (!jumped && rt.distance >= 60 - lead) {
      requestJump(rt.player);
      jumped = true;
    }
    const before = rt.crossbarTaps;
    tickRun(rt, STEP);
    if (rt.crossbarTaps > before) vyAtTap = rt.player.vy;
  }

  return { taps: rt.crossbarTaps, coins: rt.coins, alive: rt.alive, stumbles: rt.stumbles, vyAtTap };
}

describe('landing on a crossbar', () => {
  // Swept rather than hand-picked. A single lead that happens to work proves the
  // tap can fire; only a range proves it is a window a human could aim at.
  const leads: number[] = [];
  for (let lead = 6; lead <= 18; lead += 0.25) leads.push(Number(lead.toFixed(2)));
  const hits = leads.filter((lead) => tryLead(lead).taps === 1);

  it('has a window wide enough to aim at', () => {
    // Contiguous metres of run-up from which a jump lands on the bar. Much under
    // a metre and this is a coin toss dressed up as a mechanic - which is
    // exactly what it was when the tap was gated behind an AABB overlap, since
    // feet resting on top of a bar do not overlap it at all.
    expect(hits.length).toBeGreaterThan(4);
  });

  it('pays out when the arc comes down onto the top of it', () => {
    const result = tryLead(hits[Math.floor(hits.length / 2)] as number);
    expect(result.taps).toBe(1);
    expect(result.coins).toBe(TUNING.crossbar.tapCoins);
    expect(result.alive).toBe(true);
    expect(result.stumbles).toBe(0);
  });

  it('adds no airtime, so it cannot become a committed flight', () => {
    // Deliberate, and the reason there is no bounce however much one would
    // flatter it. Airtime is a span where the player can steer but not jump or
    // slide, which is the thing ramp landings and rail exits have to reserve
    // protected track for. A pop firing unpredictably off a *reward* would put a
    // third such span into the generator that nothing had laid deliberately.
    const result = tryLead(hits[Math.floor(hits.length / 2)] as number);
    // Still descending immediately after: the tap did not push back.
    expect(result.vyAtTap).not.toBeNull();
    expect(result.vyAtTap as number).toBeLessThan(0);
  });

  it('trips a player who runs straight into it', () => {
    // The counterweight to every payout above. If riding into a bar were free,
    // clearing one would be worth nothing and tapping it would be a formality.
    const rt = stagedRuntime();
    placeBar(rt, 1, 60);
    approach(rt, 60, null);

    expect(rt.crossbarTaps).toBe(0);
    expect(rt.stumbles + (rt.alive ? 0 : 1)).toBeGreaterThan(0);
  });

  it('does not pay a player rising into it from underneath', () => {
    // A mistimed jump, not a trick. Rewarding it would teach the wrong instinct.
    expect(tryLead(1).taps).toBe(0);
  });

  it('leaves a clean high clearance unrewarded rather than free money', () => {
    // Sailing over is the safe play and stays worth nothing, so the payout is
    // genuinely bought with precision.
    const early = leads.filter((lead) => lead < (hits[0] as number) - 1);
    const cleared = early.map(tryLead).filter((r) => r.taps === 0 && r.stumbles === 0);
    expect(cleared.length).toBeGreaterThan(0);
  });
});

describe('authored crossbar chunks', () => {
  const chunks = CHUNKS.filter((chunk) =>
    chunk.obstacles.some((obstacle) => obstacle.kind === 'crossbar'),
  );

  it('exist at all', () => {
    expect(chunks.length).toBeGreaterThan(0);
  });

  it('come in more than one length', () => {
    // The point of an authored span. One length is a fixed obstacle wearing a
    // parameter.
    const spans = new Set(
      chunks.flatMap((chunk) =>
        chunk.obstacles
          .filter((obstacle) => obstacle.kind === 'crossbar')
          .map((obstacle) => obstacleLanes(obstacle).length),
      ),
    );
    expect(spans.size).toBeGreaterThan(1);
  });

  it('include one that leaves a lane open and one that does not', () => {
    // Both shapes have to exist or the bar is only ever a forced jump, or only
    // ever ignorable - and either way it is one obstacle rather than a decision.
    const forced = chunks.filter((chunk) => forcedActionRows(chunk).length > 0);
    expect(forced.length).toBeGreaterThan(0);
    expect(chunks.length - forced.length).toBeGreaterThan(0);
  });
});

/**
 * Cave tunnels.
 *
 * A rock face across the whole piste with exactly one way through. It reuses
 * the crossbar's `span`, so what is tested here is not new machinery but the
 * thing that machinery is being trusted to produce: a wall that really does
 * seal every lane but one, and an entrance that really is passable.
 */
describe('cave tunnels', () => {
  const tunnelKinds = ['tunnelRock', 'tunnelArch'] as const;

  it('walls the piste with something no jump can clear', () => {
    // A rock face a good jump could clear would make the entrance decorative.
    const rock = obstacleDef('tunnelRock');
    expect(rock.action).toBe('dodge');
    expect(rock.centreY + rock.halfHeight).toBeGreaterThan(TUNING.player.jumpPeakHeight * 1.5);
  });

  it('leaves a low mouth that is answered by sliding', () => {
    const arch = obstacleDef('tunnelArch');
    expect(arch.action).toBe('slide');
    // Underside below a standing player, so it cannot simply be run through.
    expect(arch.centreY - arch.halfHeight).toBeLessThan(TUNING.player.halfHeight * 2);
  });

  const tunnels = CHUNKS.filter((chunk) =>
    chunk.obstacles.some((o) => (tunnelKinds as readonly string[]).includes(o.kind)),
  );

  it('are actually authored', () => {
    expect(tunnels.length).toBeGreaterThan(0);
  });

  it('always leave exactly one lane to go through', () => {
    // The whole mechanic. Two open lanes is just a pair of boulders; none at all
    // is a wall, and no amount of reading it would help.
    for (const chunk of tunnels) {
      const rowZs = new Set(chunk.obstacles.map((obstacle) => obstacle.z));

      for (const z of rowZs) {
        // Only the impassable rock counts as sealing. The entrance is whatever
        // it does not cover, and that lane is either empty or carries the arch -
        // which is passable, and so is not a wall.
        const sealed = new Set(
          chunk.obstacles
            .filter((o) => o.z === z && obstacleDef(o.kind).action === 'dodge')
            .flatMap(obstacleLanes),
        );

        expect(sealed.size, `${chunk.id} at z=${z} seals ${sealed.size} lanes`).toBe(
          LANES.length - 1,
        );
      }
    }
  });

  it('put the entrance in more than one place across the library', () => {
    // Always the same lane and the chunk is answered by drifting there and
    // never reading it again. Mirroring covers left against right; this is what
    // makes sure the centre is used too.
    const entrances = new Set<number>();
    for (const chunk of tunnels) {
      const sealed = new Set(
        chunk.obstacles
          .filter((o) => obstacleDef(o.kind).action === 'dodge')
          .flatMap(obstacleLanes),
      );
      for (let lane = 0; lane < LANES.length; lane++) {
        if (!sealed.has(lane as LaneIndex)) entrances.add(lane);
      }
    }
    expect(entrances.size).toBeGreaterThan(1);
  });
});
