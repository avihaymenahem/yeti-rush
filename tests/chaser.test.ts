import { describe, expect, it } from 'vitest';
import { TUNING } from '@/game/config/tuning';
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

    run(chaser, 4);
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
});
