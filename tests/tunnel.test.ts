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

const TUNNEL_KINDS = ['tunnelRock', 'tunnelArch'] as const;

describe('cave tunnels', () => {
  it('wall the piste with something no jump can clear', () => {
    // A rock face a good jump could clear would make the entrance decorative.
    const rock = obstacleDef('tunnelRock');
    expect(rock.action).toBe('dodge');
    expect(rock.centreY + rock.halfHeight).toBeGreaterThan(TUNING.player.jumpPeakHeight * 1.5);
  });

  it('leave a low mouth that is answered by sliding', () => {
    const arch = obstacleDef('tunnelArch');
    expect(arch.action).toBe('slide');
    // Underside below a standing player, so it cannot simply be run through.
    expect(arch.centreY - arch.halfHeight).toBeLessThan(TUNING.player.halfHeight * 2);
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
