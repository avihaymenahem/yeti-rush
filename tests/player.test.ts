import { describe, expect, it } from 'vitest';
import { TUNING } from '@/game/config/tuning';
import { createAabb } from '@/game/systems/collision';
import {
  createPlayerState,
  isGrounded,
  playerHalfHeight,
  requestJump,
  requestSlide,
  resetPlayerState,
  stepPlayer,
  writePlayerAabb,
  type PlayerState,
} from '@/game/systems/player';

const STEP = TUNING.sim.step;

function run(player: PlayerState, seconds: number): void {
  const ticks = Math.round(seconds / STEP);
  for (let i = 0; i < ticks; i++) stepPlayer(player, STEP);
}

/** Runs until the player is back on the ground, with a safety bound. */
function runUntilGrounded(player: PlayerState, maxSeconds = 5): number {
  let elapsed = 0;
  while (!isGrounded(player) && elapsed < maxSeconds) {
    stepPlayer(player, STEP);
    elapsed += STEP;
  }
  return elapsed;
}

/**
 * Steps to the exact frame the player touches down and stops there - unlike
 * `runUntilGrounded`, this does not run past a relaunch fired by a buffered
 * jump, so the landing frame itself can be inspected.
 */
function stepToTouchdown(player: PlayerState, maxTicks = 600): void {
  let ticks = 0;
  while (player.y > 0 && ticks < maxTicks) {
    stepPlayer(player, STEP);
    ticks++;
  }
  expect(ticks).toBeLessThan(maxTicks);
}

describe('jumping', () => {
  it('starts grounded', () => {
    expect(isGrounded(createPlayerState())).toBe(true);
  });

  it('leaves the ground and reports it', () => {
    const player = createPlayerState();
    expect(requestJump(player)).toBe(true);
    expect(player.motion).toBe('airborne');
  });

  it('reaches roughly the configured peak height', () => {
    const player = createPlayerState();
    requestJump(player);
    let peak = 0;
    for (let i = 0; i < 200 && !isGrounded(player); i++) {
      stepPlayer(player, STEP);
      peak = Math.max(peak, player.y);
    }
    // Discrete integration undershoots slightly; within 5% is the right arc.
    expect(peak).toBeGreaterThan(TUNING.player.jumpPeakHeight * 0.95);
    expect(peak).toBeLessThan(TUNING.player.jumpPeakHeight * 1.05);
  });

  it('always comes back down and lands exactly at ground level', () => {
    const player = createPlayerState();
    requestJump(player);
    runUntilGrounded(player);
    expect(isGrounded(player)).toBe(true);
    expect(player.y).toBe(0);
    expect(player.vy).toBe(0);
  });

  it('falls faster than it rises, so the arc does not feel floaty', () => {
    const player = createPlayerState();
    requestJump(player);

    let riseTime = 0;
    while (player.vy > 0) {
      stepPlayer(player, STEP);
      riseTime += STEP;
    }
    const fallTime = runUntilGrounded(player);

    expect(fallTime).toBeLessThan(riseTime);
  });

  it('ignores a second jump while airborne', () => {
    const player = createPlayerState();
    requestJump(player);
    run(player, 0.1);
    const heightBefore = player.y;
    expect(requestJump(player)).toBe(false);
    expect(player.y).toBe(heightBefore);
  });

  it('fires a jump buffered just before landing', () => {
    // Measure an undisturbed jump so we know exactly when touchdown happens.
    const control = createPlayerState();
    requestJump(control);
    const airtime = runUntilGrounded(control);

    const player = createPlayerState();
    requestJump(player);
    // Stop half a buffer window short of the ground, then press jump early.
    run(player, airtime - TUNING.player.jumpBufferTime / 2);
    expect(isGrounded(player)).toBe(false);

    requestJump(player);
    expect(player.jumpBuffer).toBeGreaterThan(0);

    stepToTouchdown(player);

    // The landing consumed the buffer and relaunched on the same frame.
    expect(player.motion).toBe('airborne');
    expect(player.vy).toBeGreaterThan(0);
    expect(player.jumpBuffer).toBe(0);
  });

  it('does not fire a jump buffered too early', () => {
    const player = createPlayerState();
    requestJump(player);
    // Press at the very top of the arc - far more than the buffer window.
    run(player, TUNING.player.jumpRiseTime);
    requestJump(player);

    runUntilGrounded(player);
    expect(player.motion).toBe('running');
  });
});

describe('sliding', () => {
  it('shortens the collider while sliding', () => {
    const player = createPlayerState();
    expect(playerHalfHeight(player)).toBe(TUNING.player.halfHeight);
    requestSlide(player);
    expect(playerHalfHeight(player)).toBe(TUNING.player.slideHalfHeight);
    expect(TUNING.player.slideHalfHeight).toBeLessThan(TUNING.player.halfHeight);
  });

  it('ends after the configured duration', () => {
    const player = createPlayerState();
    requestSlide(player);
    run(player, TUNING.player.slideDuration - STEP);
    expect(player.motion).toBe('sliding');
    run(player, STEP * 2);
    expect(player.motion).toBe('running');
  });

  it('can be cancelled by jumping out of it', () => {
    const player = createPlayerState();
    requestSlide(player);
    run(player, 0.1);
    expect(requestJump(player)).toBe(true);
    expect(player.motion).toBe('airborne');
    expect(player.slideTimer).toBe(0);
  });

  it('slams the player down when used mid-air', () => {
    const player = createPlayerState();
    requestJump(player);
    run(player, 0.1);
    const timeWithoutDive = (() => {
      const control = createPlayerState();
      requestJump(control);
      run(control, 0.1);
      return runUntilGrounded(control);
    })();

    expect(requestSlide(player)).toBe(false);
    expect(player.vy).toBeLessThan(0);
    const timeWithDive = runUntilGrounded(player);

    expect(timeWithDive).toBeLessThan(timeWithoutDive);
  });

  it('starts the queued slide on landing after a dive', () => {
    const player = createPlayerState();
    requestJump(player);
    run(player, 0.1);
    requestSlide(player);
    runUntilGrounded(player);
    expect(player.motion).toBe('sliding');
    expect(player.slideTimer).toBeCloseTo(TUNING.player.slideDuration, 6);
  });
});

describe('collider', () => {
  it('sits on the ground with its centre at half its height', () => {
    const player = createPlayerState();
    const box = createAabb();
    writePlayerAabb(player, 2.2, box);

    expect(box.x).toBe(2.2);
    expect(box.y).toBeCloseTo(TUNING.player.halfHeight, 9);
    expect(box.z).toBe(TUNING.player.z);
    // Bottom of the collider rests exactly on the snow.
    expect(box.y - box.hy).toBeCloseTo(0, 9);
  });

  it('rises with the player during a jump', () => {
    const player = createPlayerState();
    requestJump(player);
    run(player, 0.15);

    const box = createAabb();
    writePlayerAabb(player, 0, box);
    expect(box.y - box.hy).toBeCloseTo(player.y, 9);
    expect(player.y).toBeGreaterThan(0);
  });

  it('drops its top edge while sliding', () => {
    const standing = createAabb();
    const sliding = createAabb();

    const player = createPlayerState();
    writePlayerAabb(player, 0, standing);
    requestSlide(player);
    writePlayerAabb(player, 0, sliding);

    expect(sliding.y + sliding.hy).toBeLessThan(standing.y + standing.hy);
    expect(sliding.y - sliding.hy).toBeCloseTo(0, 9);
  });
});

describe('resetPlayerState', () => {
  it('returns a mid-air, mid-slide player to a clean running state', () => {
    const player = createPlayerState();
    requestJump(player);
    run(player, 0.1);
    requestSlide(player);

    resetPlayerState(player);

    expect(player).toEqual(createPlayerState());
  });
});
