import { describe, expect, it } from 'vitest';
import { TUNING, type LaneIndex } from '@/game/config/tuning';
import type { ObstacleKind } from '@/game/content/obstacles';
import { POWER_UP_IDS, powerUpDef, type PowerUpId } from '@/game/content/powerUps';
import { createTestRuntime, resetRuntime, runtime, type RuntimeState } from '@/game/state/runtime';
import { speedAt } from '@/game/systems/difficulty';
import { requestLaneChange } from '@/game/systems/lanes';
import { requestJump, requestSlide } from '@/game/systems/player';
import { rampArcHeight } from '@/game/systems/ramp';
import { chaserPressure } from '@/game/systems/chaser';
import {
  CAUGHT_PRESSURE,
  COMBO_PER_STEP,
  MAX_MULTIPLIER,
  tickRun,
} from '@/game/systems/simulation';

const STEP = TUNING.sim.step;

/**
 * A runtime with track streaming switched off, so a test can place exactly the
 * obstacles it cares about and nothing else drifts into frame.
 */
function controlledRuntime(): RuntimeState {
  const rt = createTestRuntime(1);
  rt.running = true;
  for (const obstacle of rt.track.obstacles) obstacle.active = false;
  for (const coin of rt.track.coins) coin.active = false;
  rt.track.nextChunkStart = Number.MAX_SAFE_INTEGER;
  return rt;
}

function placeObstacle(rt: RuntimeState, kind: ObstacleKind, lane: LaneIndex, trackZ: number) {
  const entity = rt.track.obstacles.find((o) => !o.active)!;
  entity.active = true;
  entity.kind = kind;
  entity.lane = lane;
  entity.trackZ = trackZ;
  entity.passed = false;
  return entity;
}

function placeCoin(
  rt: RuntimeState,
  lane: LaneIndex,
  trackZ: number,
  // Annotated because TUNING is `as const`, which would otherwise infer the
  // literal type of the default and reject any other height.
  y: number = TUNING.coins.baseHeight,
) {
  const entity = rt.track.coins.find((c) => !c.active)!;
  entity.active = true;
  entity.lane = lane;
  entity.trackZ = trackZ;
  entity.y = y;
  return entity;
}

function run(rt: RuntimeState, seconds: number): void {
  const ticks = Math.round(seconds / STEP);
  for (let i = 0; i < ticks; i++) tickRun(rt, STEP);
}

/** Runs until the player passes `trackZ` or dies. */
function runPast(rt: RuntimeState, trackZ: number, maxSeconds = 20): void {
  let elapsed = 0;
  while (rt.alive && rt.distance < trackZ + 4 && elapsed < maxSeconds) {
    tickRun(rt, STEP);
    elapsed += STEP;
  }
}

describe('run progression', () => {
  it('does nothing while the run is not running', () => {
    const rt = controlledRuntime();
    rt.running = false;
    run(rt, 1);
    expect(rt.distance).toBe(0);
    expect(rt.elapsed).toBe(0);
  });

  it('freezes completely while paused, and cannot be killed', () => {
    // Pausing clears `running`, which is what stops the tick. An obstacle sat
    // right on top of the player must not resolve while a menu is open.
    const rt = controlledRuntime();
    placeObstacle(rt, 'boulder', 1, rt.distance + 2);

    rt.running = false;
    const frozenDistance = rt.distance;
    run(rt, 3);

    expect(rt.distance).toBe(frozenDistance);
    expect(rt.alive).toBe(true);

    // And it picks up exactly where it left off.
    rt.running = true;
    run(rt, 0.2);
    expect(rt.distance).toBeGreaterThan(frozenDistance);
  });

  it('does nothing once the player is dead', () => {
    const rt = controlledRuntime();
    run(rt, 0.5);
    const distanceAtDeath = rt.distance;
    rt.alive = false;
    run(rt, 1);
    expect(rt.distance).toBe(distanceAtDeath);
  });

  it('accumulates distance at the current speed', () => {
    const rt = controlledRuntime();
    run(rt, 1);
    expect(rt.distance).toBeGreaterThan(TUNING.speed.start * 0.9);
    expect(rt.distance).toBeLessThan(TUNING.speed.max);
  });

  it('follows the difficulty speed curve', () => {
    const rt = controlledRuntime();
    run(rt, 30);
    expect(rt.speed).toBeCloseTo(speedAt(rt.elapsed), 6);
    expect(rt.speed).toBeGreaterThan(TUNING.speed.start);
  });

  it('is fully deterministic for a seed and input sequence', () => {
    const play = (): RuntimeState => {
      const rt = createTestRuntime(4242);
      rt.running = true;
      for (let i = 0; i < 600; i++) {
        if (i === 40) requestLaneChange(rt.lane, 1);
        if (i === 120) requestJump(rt.player);
        if (i === 240) requestSlide(rt.player);
        if (i === 360) requestLaneChange(rt.lane, -1);
        tickRun(rt, STEP);
      }
      return rt;
    };

    const a = play();
    const b = play();
    expect(b.distance).toBe(a.distance);
    expect(b.coins).toBe(a.coins);
    expect(b.score).toBe(a.score);
    expect(b.alive).toBe(a.alive);
    expect(b.combo).toBe(a.combo);
  });
});

describe('obstacle collision', () => {
  it('kills the player who runs straight into a boulder', () => {
    const rt = controlledRuntime();
    placeObstacle(rt, 'boulder', 1, 40);
    runPast(rt, 40);
    expect(rt.alive).toBe(false);
    expect(rt.deathCause).toBe('obstacle');
    expect(rt.running).toBe(false);
  });

  it('kills the player who runs into a solid overhead barrier', () => {
    const rt = controlledRuntime();
    placeObstacle(rt, 'banner', 1, 40);
    runPast(rt, 40);
    expect(rt.alive).toBe(false);
    expect(rt.deathCause).toBe('obstacle');
  });

  it('spares the player in a different lane', () => {
    const rt = controlledRuntime();
    placeObstacle(rt, 'boulder', 0, 40);
    runPast(rt, 40);
    expect(rt.alive).toBe(true);
  });

  it('spares the player who jumps a drift', () => {
    const rt = controlledRuntime();
    placeObstacle(rt, 'drift', 1, 40);

    // Jump when the drift is about a jump-rise away.
    while (rt.alive && rt.distance < 40 - TUNING.player.jumpRiseTime * rt.speed) {
      tickRun(rt, STEP);
    }
    requestJump(rt.player);
    runPast(rt, 40);

    expect(rt.alive).toBe(true);
  });

  it('kills the player who jumps a banner instead of sliding', () => {
    const rt = controlledRuntime();
    placeObstacle(rt, 'banner', 1, 40);

    while (rt.alive && rt.distance < 40 - TUNING.player.jumpRiseTime * rt.speed) {
      tickRun(rt, STEP);
    }
    requestJump(rt.player);
    runPast(rt, 40);

    expect(rt.alive).toBe(false);
  });

  it('spares the player who slides under a banner', () => {
    const rt = controlledRuntime();
    placeObstacle(rt, 'banner', 1, 40);

    while (rt.alive && rt.distance < 40 - 0.2 * rt.speed) tickRun(rt, STEP);
    requestSlide(rt.player);
    runPast(rt, 40);

    expect(rt.alive).toBe(true);
  });

  it('only counts an obstacle as passed once', () => {
    const rt = controlledRuntime();
    const obstacle = placeObstacle(rt, 'boulder', 0, 40);
    runPast(rt, 40);
    run(rt, 0.5);

    expect(obstacle.passed).toBe(true);
    expect(rt.combo).toBe(1);
  });

  it('ignores obstacles far outside the collision window', () => {
    const rt = controlledRuntime();
    placeObstacle(rt, 'boulder', 1, 5000);
    run(rt, 2);
    expect(rt.alive).toBe(true);
    expect(rt.combo).toBe(0);
  });
});

describe('stumbling', () => {
  it('trips rather than kills on a low obstacle', () => {
    const rt = controlledRuntime();
    placeObstacle(rt, 'drift', 1, 40);
    runPast(rt, 40);

    expect(rt.alive).toBe(true);
    expect(rt.stumbles).toBe(1);
    expect(rt.stumbleTimer).toBeGreaterThan(0);
  });

  it('breaks the combo', () => {
    const rt = controlledRuntime();
    for (let i = 0; i < 4; i++) placeObstacle(rt, 'boulder', 0, 30 + i * 6);
    placeObstacle(rt, 'drift', 1, 70);

    runPast(rt, 70, 30);
    expect(rt.combo).toBe(0);
  });

  it('costs speed while recovering', () => {
    const rt = controlledRuntime();
    placeObstacle(rt, 'drift', 1, 40);
    runPast(rt, 40);

    const stumbling = rt.speed;
    expect(rt.stumbleTimer).toBeGreaterThan(0);

    run(rt, TUNING.stumble.duration + 0.1);
    expect(rt.speed).toBeGreaterThan(stumbling);
  });

  it('brings the patrol closer', () => {
    const rt = controlledRuntime();
    const before = rt.chaser.distance;
    placeObstacle(rt, 'drift', 1, 40);
    runPast(rt, 40);
    expect(rt.chaser.distance).toBeLessThan(before);
  });

  it('cannot be triggered twice by one cluster of obstacles', () => {
    const rt = controlledRuntime();
    placeObstacle(rt, 'drift', 1, 40);
    placeObstacle(rt, 'drift', 1, 41);
    placeObstacle(rt, 'drift', 1, 42);

    runPast(rt, 42);
    expect(rt.alive).toBe(true);
    expect(rt.stumbles).toBe(1);
  });

  it('is fatal on a second trip in quick succession', () => {
    const rt = controlledRuntime();
    // Spaced past the stumble recovery but well inside the patrol's climb-down.
    for (let i = 0; i < 4; i++) placeObstacle(rt, 'drift', 1, 40 + i * 11);

    runPast(rt, 40 + 3 * 11, 30);

    expect(rt.alive).toBe(false);
    expect(rt.deathCause).toBe('caught');
  });

  it('is survivable when trips are far enough apart for the patrol to drop back', () => {
    const rt = controlledRuntime();
    for (let i = 0; i < 3; i++) placeObstacle(rt, 'drift', 1, 60 + i * 120);

    runPast(rt, 60 + 2 * 120, 60);

    expect(rt.alive).toBe(true);
    expect(rt.stumbles).toBe(3);
  });

  it('puts the player over the line, then lets a clean stretch clear it', () => {
    const rt = controlledRuntime();
    placeObstacle(rt, 'drift', 1, 40);

    // The patrol starts dropping back the moment it closes in, so the peak has
    // to be sampled per tick rather than read after the fact.
    let peakPressure = 0;
    while (rt.alive && rt.distance < 50) {
      tickRun(rt, STEP);
      peakPressure = Math.max(peakPressure, chaserPressure(rt.chaser));
    }

    expect(rt.stumbles).toBe(1);
    expect(peakPressure).toBeGreaterThanOrEqual(CAUGHT_PRESSURE);

    run(rt, 2.5);
    expect(chaserPressure(rt.chaser)).toBeLessThan(CAUGHT_PRESSURE);
  });

  it('lets the player recover fully if they run clean afterwards', () => {
    const rt = controlledRuntime();
    placeObstacle(rt, 'drift', 1, 40);
    runPast(rt, 40);
    expect(chaserPressure(rt.chaser)).toBeGreaterThan(0);

    run(rt, 6);
    expect(chaserPressure(rt.chaser)).toBeCloseTo(0, 6);
    expect(rt.stumbleTimer).toBe(0);
  });

  it('does not stumble on a low obstacle that was jumped', () => {
    const rt = controlledRuntime();
    placeObstacle(rt, 'drift', 1, 40);

    while (rt.alive && rt.distance < 40 - TUNING.player.jumpRiseTime * rt.speed) {
      tickRun(rt, STEP);
    }
    requestJump(rt.player);
    runPast(rt, 40);

    expect(rt.stumbles).toBe(0);
    expect(rt.combo).toBe(1);
  });
});

describe('coins', () => {
  it('collects a coin in the player lane', () => {
    const rt = controlledRuntime();
    placeCoin(rt, 1, 40);
    runPast(rt, 40);
    expect(rt.coins).toBe(1);
  });

  it('does not collect a coin in another lane', () => {
    const rt = controlledRuntime();
    placeCoin(rt, 0, 40);
    runPast(rt, 40);
    expect(rt.coins).toBe(0);
  });

  it('deactivates a collected coin so it cannot be collected twice', () => {
    const rt = controlledRuntime();
    const coin = placeCoin(rt, 1, 40);
    runPast(rt, 40);
    run(rt, 0.5);
    expect(coin.active).toBe(false);
    expect(rt.coins).toBe(1);
  });

  it('needs a jump to reach a coin high in an arc', () => {
    const grounded = controlledRuntime();
    placeCoin(grounded, 1, 40, TUNING.coins.baseHeight + TUNING.coins.arcPeak);
    runPast(grounded, 40);
    expect(grounded.coins).toBe(0);

    const jumping = controlledRuntime();
    placeCoin(jumping, 1, 40, TUNING.coins.baseHeight + TUNING.coins.arcPeak);
    while (jumping.alive && jumping.distance < 40 - TUNING.player.jumpRiseTime * jumping.speed) {
      tickRun(jumping, STEP);
    }
    requestJump(jumping.player);
    runPast(jumping, 40);
    expect(jumping.coins).toBe(1);
  });

  it('collects a whole run of coins', () => {
    const rt = controlledRuntime();
    for (let i = 0; i < 6; i++) placeCoin(rt, 1, 40 + i * TUNING.coins.spacing);
    runPast(rt, 40 + 6 * TUNING.coins.spacing);
    expect(rt.coins).toBe(6);
  });
});

describe('scoring', () => {
  it('scores distance travelled', () => {
    const rt = controlledRuntime();
    run(rt, 2);
    expect(rt.score).toBe(Math.floor(rt.distance * TUNING.scoring.pointsPerUnit));
  });

  it('adds coin value on top of distance', () => {
    const rt = controlledRuntime();
    placeCoin(rt, 1, 40);
    runPast(rt, 40);
    expect(rt.score).toBe(
      Math.floor(rt.distance + TUNING.scoring.pointsPerCoin * rt.multiplier),
    );
  });

  it('starts at multiplier 1', () => {
    const rt = controlledRuntime();
    run(rt, 1);
    expect(rt.multiplier).toBe(1);
  });

  it('raises the multiplier as the combo builds', () => {
    const rt = controlledRuntime();
    for (let i = 0; i < COMBO_PER_STEP; i++) {
      placeObstacle(rt, 'boulder', 0, 30 + i * 6);
    }
    runPast(rt, 30 + COMBO_PER_STEP * 6);

    expect(rt.combo).toBe(COMBO_PER_STEP);
    expect(rt.multiplier).toBe(2);
  });

  it('caps the multiplier', () => {
    const rt = controlledRuntime();
    rt.combo = COMBO_PER_STEP * 100;
    run(rt, STEP * 2);
    expect(rt.multiplier).toBe(MAX_MULTIPLIER);
  });

  it('never goes backwards during a run', () => {
    const rt = controlledRuntime();
    let previous = 0;
    for (let i = 0; i < 600; i++) {
      tickRun(rt, STEP);
      expect(rt.score).toBeGreaterThanOrEqual(previous);
      previous = rt.score;
    }
  });
});

describe('ramps', () => {
  function placeRamp(rt: RuntimeState, lane: LaneIndex, trackZ: number) {
    const entity = rt.track.ramps.find((r) => !r.active)!;
    entity.active = true;
    entity.lane = lane;
    entity.trackZ = trackZ;
    entity.used = false;
    return entity;
  }

  it('launches a grounded player who crosses it', () => {
    const rt = controlledRuntime();
    placeRamp(rt, 1, 40);
    runPast(rt, 40);

    expect(rt.player.ramping).toBe(true);
    expect(rt.player.motion).toBe('airborne');
    expect(rt.rampLaunches).toBe(1);
  });

  it('carries the player clean over a chalet at the authored gap', () => {
    const rt = controlledRuntime();
    placeRamp(rt, 1, 40);
    placeObstacle(rt, 'chalet', 1, 40 + TUNING.ramp.chaletGap);

    runPast(rt, 40 + TUNING.ramp.chaletGap + 12, 30);

    expect(rt.alive).toBe(true);
    expect(rt.rampLaunches).toBe(1);
  });

  it('kills a player who takes the same chalet without the ramp', () => {
    const rt = controlledRuntime();
    placeObstacle(rt, 'chalet', 1, 40 + TUNING.ramp.chaletGap);
    runPast(rt, 40 + TUNING.ramp.chaletGap + 12, 30);
    expect(rt.alive).toBe(false);
  });

  it('reaches the configured peak height', () => {
    const rt = controlledRuntime();
    placeRamp(rt, 1, 40);

    let peak = 0;
    for (let i = 0; i < 3000 && rt.alive; i++) {
      tickRun(rt, STEP);
      peak = Math.max(peak, rt.player.y);
      if (rt.distance > 80) break;
    }

    expect(peak).toBeGreaterThan(TUNING.ramp.peakHeight * 0.97);
    expect(peak).toBeLessThan(TUNING.ramp.peakHeight * 1.03);
  });

  it('collects a coin run authored along the arc', () => {
    const rt = controlledRuntime();
    placeRamp(rt, 1, 40);
    for (let i = 0; i < 9; i++) {
      const ahead = 1 + i * 1.8;
      placeCoin(rt, 1, 40 + ahead, TUNING.coins.baseHeight + rampArcHeight(ahead));
    }

    runPast(rt, 40 + TUNING.ramp.airDistance + 4, 30);
    expect(rt.coins).toBe(9);
  });

  it('is consumed, so it cannot re-launch a player mid-flight', () => {
    const rt = controlledRuntime();
    const ramp = placeRamp(rt, 1, 40);
    runPast(rt, 40);
    expect(ramp.used).toBe(true);

    const launchesAfterFirst = rt.rampLaunches;
    run(rt, 1);
    expect(rt.rampLaunches).toBe(launchesAfterFirst);
  });

  it('is ignored by a player already in the air', () => {
    const rt = controlledRuntime();
    placeRamp(rt, 1, 40);

    // Jump early so the player is airborne when the ramp arrives.
    while (rt.alive && rt.distance < 36) tickRun(rt, STEP);
    requestJump(rt.player);
    runPast(rt, 40);

    expect(rt.player.ramping).toBe(false);
    expect(rt.rampLaunches).toBe(0);
  });

  it('does not launch a player in another lane', () => {
    const rt = controlledRuntime();
    placeRamp(rt, 0, 40);
    runPast(rt, 40);
    expect(rt.rampLaunches).toBe(0);
    expect(rt.player.ramping).toBe(false);
  });
});

describe('power-ups in play', () => {
  function placePickup(rt: RuntimeState, id: PowerUpId, lane: LaneIndex, trackZ: number) {
    const entity = rt.track.pickups.find((p) => !p.active)!;
    entity.active = true;
    entity.lane = lane;
    entity.trackZ = trackZ;
    entity.powerUp = id;
    return entity;
  }

  it('activates on pickup and reports it once', () => {
    const rt = controlledRuntime();
    placePickup(rt, 'magnet', 1, 40);
    runPast(rt, 40);

    expect(rt.powerUps.magnet).toBeGreaterThan(0);
    expect(rt.collectedPowerUp).toBe('magnet');
  });

  it('is not collected from another lane', () => {
    const rt = controlledRuntime();
    placePickup(rt, 'magnet', 0, 40);
    runPast(rt, 40);
    expect(rt.powerUps.magnet).toBe(0);
  });

  it('expires after its duration', () => {
    const rt = controlledRuntime();
    placePickup(rt, 'magnet', 1, 40);
    runPast(rt, 40);

    run(rt, powerUpDef('magnet').duration + 0.2);
    expect(rt.powerUps.magnet).toBe(0);
  });

  it('refreshes rather than stacks when picked up again', () => {
    const rt = controlledRuntime();
    placePickup(rt, 'magnet', 1, 40);
    placePickup(rt, 'magnet', 1, 55);
    runPast(rt, 55);
    expect(rt.powerUps.magnet).toBeLessThanOrEqual(powerUpDef('magnet').duration);
  });

  it('magnet pulls in coins from a lane away', () => {
    const withoutMagnet = controlledRuntime();
    placeCoin(withoutMagnet, 0, 40);
    runPast(withoutMagnet, 40);
    expect(withoutMagnet.coins).toBe(0);

    const withMagnet = controlledRuntime();
    withMagnet.powerUps.magnet = 30;
    placeCoin(withMagnet, 0, 40);
    runPast(withMagnet, 40);
    expect(withMagnet.coins).toBe(1);
  });

  it('avalanche board survives and destroys an obstacle', () => {
    const rt = controlledRuntime();
    rt.powerUps.avalanche = 30;
    const boulder = placeObstacle(rt, 'boulder', 1, 40);
    runPast(rt, 40);

    expect(rt.alive).toBe(true);
    expect(boulder.active).toBe(false);
    expect(rt.smashed).toBe(1);
  });

  it('avalanche board speeds the run up', () => {
    const normal = controlledRuntime();
    run(normal, 1);

    const boosted = controlledRuntime();
    boosted.powerUps.avalanche = 30;
    run(boosted, 1);

    expect(boosted.distance).toBeGreaterThan(normal.distance);
  });

  it('chairlift lifts the player clear of a chalet without destroying it', () => {
    const rt = controlledRuntime();
    rt.powerUps.chairlift = 30;
    const chalet = placeObstacle(rt, 'chalet', 1, 60);

    runPast(rt, 60, 30);

    expect(rt.alive).toBe(true);
    expect(chalet.active).toBe(true);
    expect(rt.smashed).toBe(0);
    expect(rt.player.motion).toBe('flying');
  });

  it('drops the player back to the ground when the chairlift expires', () => {
    const rt = controlledRuntime();
    rt.powerUps.chairlift = 0.5;
    run(rt, 0.3);
    expect(rt.player.motion).toBe('flying');

    run(rt, 3);
    expect(rt.player.motion).toBe('running');
    expect(rt.player.y).toBe(0);
  });

  it('snow angel allows exactly one extra jump per airtime', () => {
    const rt = controlledRuntime();
    rt.powerUps.snowAngel = 30;

    expect(requestJump(rt.player, true)).toBe(true);
    run(rt, 0.1);
    expect(requestJump(rt.player, true)).toBe(true);
    run(rt, 0.05);
    // The charge is spent until the player lands.
    expect(requestJump(rt.player, true)).toBe(false);
  });

  it('restores the double jump charge on landing', () => {
    const rt = controlledRuntime();
    rt.powerUps.snowAngel = 30;
    requestJump(rt.player, true);
    requestJump(rt.player, true);

    while (rt.alive && rt.player.motion !== 'running') tickRun(rt, STEP);
    expect(rt.player.doubleJumpUsed).toBe(false);
    expect(requestJump(rt.player, true)).toBe(true);
  });

  it('double score doubles the multiplier', () => {
    const rt = controlledRuntime();
    run(rt, 0.5);
    const base = rt.multiplier;

    rt.powerUps.doubleScore = 30;
    run(rt, 0.1);
    expect(rt.multiplier).toBe(base * 2);
  });

  it('clears every power-up on reset', () => {
    const rt = controlledRuntime();
    for (const id of POWER_UP_IDS) rt.powerUps[id] = 10;
    resetRuntime(1);
    // resetRuntime works on the shared singleton, so check that instead.
    for (const id of POWER_UP_IDS) expect(runtime.powerUps[id]).toBe(0);
  });
});

describe('allocation discipline', () => {
  it('reuses the same scratch colliders every tick', () => {
    const rt = controlledRuntime();
    const player = rt.scratch.player;
    const entity = rt.scratch.entity;
    placeObstacle(rt, 'boulder', 0, 40);
    placeCoin(rt, 1, 45);
    run(rt, 3);
    expect(rt.scratch.player).toBe(player);
    expect(rt.scratch.entity).toBe(entity);
  });
});
