import { describe, expect, it } from 'vitest';
import { TUNING } from '@/game/config/tuning';
import { distanceForHalfExtent, requiredHalfExtent } from '@/game/systems/camera';
import {
  CHASER,
  chaserCloseIn,
  chaserPressure,
  chaserWorldZ,
  createChaserState,
  resetChaser,
  stepChaser,
} from '@/game/systems/chaser';

const STEP = TUNING.sim.step;

function run(chaser: ReturnType<typeof createChaserState>, seconds: number): void {
  const ticks = Math.round(seconds / STEP);
  for (let i = 0; i < ticks; i++) stepChaser(chaser, STEP);
}

describe('chaser', () => {
  it('starts at its resting distance and out of sight', () => {
    const chaser = createChaserState();
    expect(chaser.distance).toBe(CHASER.restingDistance);
    expect(chaser.visible).toBe(false);
  });

  it('closes in on a stumble', () => {
    const chaser = createChaserState();
    chaserCloseIn(chaser);
    expect(chaser.distance).toBeLessThan(CHASER.restingDistance);
  });

  it('becomes visible once it is close', () => {
    const chaser = createChaserState();
    chaserCloseIn(chaser);
    stepChaser(chaser, STEP);
    expect(chaser.visible).toBe(true);
  });

  it('falls back to resting distance while the player runs clean', () => {
    const chaser = createChaserState();
    chaserCloseIn(chaser);
    run(chaser, 10);
    expect(chaser.distance).toBeCloseTo(CHASER.restingDistance, 6);
  });

  it('never drifts past its resting distance', () => {
    const chaser = createChaserState();
    run(chaser, 30);
    expect(chaser.distance).toBe(CHASER.restingDistance);
  });

  it('never closes past its minimum, however many stumbles', () => {
    const chaser = createChaserState();
    for (let i = 0; i < 50; i++) chaserCloseIn(chaser);
    expect(chaser.distance).toBeGreaterThanOrEqual(CHASER.minDistance);
  });

  it('stays behind the player at all times', () => {
    const chaser = createChaserState();
    for (let i = 0; i < 50; i++) {
      chaserCloseIn(chaser);
      stepChaser(chaser, STEP);
      expect(chaserWorldZ(chaser)).toBeGreaterThan(TUNING.player.z);
    }
  });

  it('reports pressure between 0 and 1', () => {
    const chaser = createChaserState();
    expect(chaserPressure(chaser)).toBeCloseTo(0, 6);

    for (let i = 0; i < 10; i++) chaserCloseIn(chaser);
    expect(chaserPressure(chaser)).toBeCloseTo(1, 6);
  });

  it('raises pressure with every stumble and lowers it as the player recovers', () => {
    const chaser = createChaserState();
    chaserCloseIn(chaser);
    const afterOne = chaserPressure(chaser);
    chaserCloseIn(chaser);
    expect(chaserPressure(chaser)).toBeGreaterThan(afterOne);

    // Long enough to undo both trips, derived rather than guessed - a literal
    // here silently encodes whatever `recoverRate` happened to be that week.
    run(chaser, (2 * CHASER.stumblePenalty) / CHASER.recoverRate);
    expect(chaserPressure(chaser)).toBeLessThan(afterOne);
  });

  it('resets fully for a new run', () => {
    const chaser = createChaserState();
    chaserCloseIn(chaser);
    stepChaser(chaser, STEP);
    resetChaser(chaser);
    expect(chaser).toEqual(createChaserState());
  });

  it('is configured so recovery is slower than a single stumble costs', () => {
    // Otherwise a stumble would be shrugged off before the player notices it.
    expect(CHASER.stumblePenalty).toBeGreaterThan(CHASER.recoverRate);
  });

  it('simulates a position that is behind the eye, which is why the drawn one is not it', () => {
    /*
     * This is a note to the next person to open this file, written as an
     * assertion so it cannot rot.
     *
     * `chaserWorldZ` is correct and must not move - `stepChaser`, the avalanche
     * and `tests/caught.test.ts` are all built on these distances, and a patrol
     * that hangs back 26 m is the mechanic. But *nothing may draw it there*. The
     * camera settles somewhere around `z = 9`, so the simulated position is
     * seventeen units the wrong side of the lens, and for the first eight
     * releases the game's only antagonist was frustum culled for effectively
     * every frame of every run. The renderer therefore reframes the machine from
     * the live camera - see `patrolDrawnZ` in `render/patrolGeometry.ts` and the
     * framing tests in `tests/patrol.test.ts`.
     *
     * So: the gap below is the *justification* for that split, not a defect. If
     * it ever closes, the reframing has become unnecessary and both halves
     * should be revisited together.
     */
    const chaser = createChaserState();
    const required = requiredHalfExtent();

    // Portrait phone through to a small tablet: the whole range the rig frames
    // for. Wider screens pull the camera in, so this is where it is closest.
    for (const aspect of [0.45, 0.4618, 0.52, 0.62, 0.75]) {
      const eyeZ = Math.max(
        TUNING.camera.minDistance,
        distanceForHalfExtent(required, TUNING.camera.fov, aspect),
      );
      expect(chaserWorldZ(chaser)).toBeGreaterThan(eyeZ + 10);
    }

    // And the counterweight: even pressed to its closest it is still not a
    // position anything should be drawn at unaltered - it sits inside the band
    // where obstacles exist and, with no collider, would drive through them.
    chaser.distance = CHASER.minDistance;
    expect(chaserWorldZ(chaser)).toBeGreaterThan(TUNING.player.z);
  });
});
