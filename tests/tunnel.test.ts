/**
 * Cave tunnels.
 *
 * A rock face across the whole piste with exactly one way through. Mechanically
 * this is something the generator could already express - two blocked lanes and
 * one open is a row answered by steering - so what is tested here is not new
 * machinery but the thing that machinery is trusted to produce: a wall that
 * really does seal every lane but one, and an entrance that really is passable.
 */

import { describe, expect, it } from 'vitest';
import { LANES, TUNING, type LaneIndex } from '@/game/config/tuning';
import { CHUNKS, obstacleLanes } from '@/game/content/chunks';
import { obstacleDef } from '@/game/content/obstacles';
import { worstCaseSpeed } from '@/game/content/skins';
import { createRng } from '@/game/core/rng';
import { tierAt } from '@/game/systems/difficulty';
import { createSpawner, updateSpawner } from '@/game/systems/spawner';

const TUNNEL_KINDS = ['tunnelRock'] as const;

describe('cave tunnels', () => {
  it('wall the piste with something no jump can clear', () => {
    // A rock face a good jump could clear would make the entrance decorative.
    const rock = obstacleDef('tunnelRock');
    expect(rock.action).toBe('dodge');
    expect(rock.centreY + rock.halfHeight).toBeGreaterThan(TUNING.player.jumpPeakHeight * 1.5);
  });

  it('leave the way through clear from the snow to above a jump', () => {
    // Nothing is ducked in a tunnel. The roof over the open lane is part of the
    // wall's *geometry* rather than an obstacle of its own, so the passage is
    // clear all the way up - which is what makes this an avalanche gallery
    // rather than a cave mouth. A low roof and a required slide made it a second
    // banner wearing a rock texture, and asked the player to answer a tunnel
    // with the input they use on bunting.
    const kinds = new Set(
      CHUNKS.flatMap((chunk) => chunk.obstacles.map((obstacle) => obstacle.kind)),
    );
    expect(kinds.has('tunnelRock')).toBe(true);
    // No obstacle kind stands in a tunnel's open lane at all.
    expect([...kinds].filter((kind) => kind.startsWith('tunnel'))).toEqual(['tunnelRock']);
  });

  const tunnels = CHUNKS.filter((chunk) =>
    chunk.obstacles.some((o) => (TUNNEL_KINDS as readonly string[]).includes(o.kind)),
  );

  it('are actually authored', () => {
    expect(tunnels.length).toBeGreaterThan(0);
  });

  it('always leave exactly one lane to go through', () => {
    // The whole mechanic. Two open lanes is just a pair of boulders; none at all
    // is a wall, and no amount of reading it would help.
    for (const chunk of tunnels) {
      for (const z of new Set(chunk.obstacles.map((obstacle) => obstacle.z))) {
        // Only impassable rock seals. The entrance is whatever it does not
        // cover, and that lane is either empty or carries the arch - which is
        // passable, and so is not a wall.
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
    // Always the same lane and a tunnel is answered by drifting there once and
    // never reading one again. Mirroring covers left against right; this is what
    // makes sure the centre gets used too.
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

/**
 * What follows a tunnel.
 *
 * Inside a ten-metre gallery the roof and walls are between the player and
 * whatever is coming, so an obstacle just past the mouth cannot be read in time
 * however well the run is being played. This is the ramp-landing problem in a
 * third costume - a span the player cannot act through, followed by track
 * nothing had cleared - and it is protected the same way.
 */
describe('coming out of a tunnel', () => {
  const REACTION = 0.45;

  function generate(seed: number, totalDistance: number) {
    const rng = createRng(seed);
    const spawner = createSpawner();
    const tunnels = new Map<string, number>();
    const obstacles = new Map<string, { z: number; kind: string }>();

    for (let distance = 0; distance <= totalDistance; distance += 10) {
      updateSpawner(spawner, distance, tierAt(distance), rng, worstCaseSpeed(TUNING.speed.max));

      for (const obstacle of spawner.obstacles) {
        if (!obstacle.active) continue;
        const key = `${obstacle.trackZ.toFixed(3)}:${obstacle.lane}:${obstacle.kind}`;
        if (obstacle.kind.startsWith('tunnel')) {
          tunnels.set(key, obstacle.trackZ + obstacleDef(obstacle.kind).halfDepth);
        } else {
          obstacles.set(key, { z: obstacle.trackZ, kind: obstacle.kind });
        }
      }
    }

    return { exits: [...tunnels.values()], obstacles: [...obstacles.values()] };
  }

  it('leaves clear track for a full reaction past the mouth, across 200 seeds', () => {
    const clear = REACTION * worstCaseSpeed(TUNING.speed.max);
    const violations: { seed: number; gap: number; kind: string }[] = [];

    for (let seed = 1; seed <= 200; seed++) {
      const { exits, obstacles } = generate(seed, 3000);

      for (const exit of exits) {
        for (const obstacle of obstacles) {
          if (obstacle.z <= exit || obstacle.z > exit + clear) continue;
          violations.push({
            seed,
            gap: Number((obstacle.z - exit).toFixed(1)),
            kind: obstacle.kind,
          });
        }
      }
    }

    expect(violations.slice(0, 8)).toEqual([]);
    expect(violations).toHaveLength(0);
  });

  it('still puts tunnels on the track at all', () => {
    // The counterweight. Every bound above is trivially met by a generator that
    // never lays a tunnel, and the protection works by laying *clear* chunks -
    // so a bug that suppressed tunnels entirely would look like a pass.
    let found = 0;
    for (let seed = 1; seed <= 40; seed++) found += generate(seed, 3000).exits.length;
    expect(found).toBeGreaterThan(20);
  });

  it('still lays real obstacles elsewhere', () => {
    // The other half of the same counterweight: protection that cleared the
    // whole track would also pass, and would be a different bug entirely.
    let found = 0;
    for (let seed = 1; seed <= 20; seed++) found += generate(seed, 3000).obstacles.length;
    expect(found).toBeGreaterThan(200);
  });
});
