/**
 * One fixed simulation tick.
 *
 * Everything that changes over time goes through here in a defined order, so
 * the sim stays deterministic for a given seed and input sequence.
 *
 * Order matters. Movement runs first, then streaming, then collision: testing
 * against last tick's entity positions would let the player clip through an
 * obstacle at high speed. Ramps are checked before obstacles, because the
 * launch is what carries the player over the chalet tested immediately after.
 */

import { TUNING } from '@/game/config/tuning';
import { obstacleDef } from '@/game/content/obstacles';
import {
  coinPickupMultiplier,
  flightHeight,
  isInvulnerable,
  scoreMultiplier,
  smashesObstacles,
  speedMultiplier,
  stepPowerUps,
} from '@/game/content/powerUps';
import type { RuntimeState } from '@/game/state/runtime';
import { chaserCloseIn, chaserPressure, stepChaser } from '@/game/systems/chaser';
import { aabbOverlap, distanceSquared, withinZWindow } from '@/game/systems/collision';
import { speedAt, tierAt } from '@/game/systems/difficulty';
import { laneToX, stepLane } from '@/game/systems/lanes';
import {
  bailRail,
  endFlight,
  launchFromRamp,
  mountRail,
  startFlight,
  stepGrind,
  stepPlayer,
  writePlayerAabb,
} from '@/game/systems/player';
import { updateSpawner, worldZOf } from '@/game/systems/spawner';

/** Obstacles cleared per step of the score multiplier. */
const COMBO_PER_STEP = 10;
/** Highest multiplier the combo alone can reach. */
const MAX_MULTIPLIER = 5;
/** Score awarded for smashing an obstacle on the avalanche board. */
const SMASH_SCORE = 25;
/** Radius within which a power-up pickup is collected. */
const PICKUP_RADIUS = 1.3;
/**
 * Patrol pressure at or above which a stumble is fatal.
 *
 * Set so that a single stumble puts the player over the line: trip once and the
 * next trip catches you, but run clean for about two seconds and the patrol has
 * dropped back far enough to survive another. That two-second window is the
 * whole tension mechanic - higher and it takes three trips to die, which reads
 * as the patrol being decorative.
 */
const CAUGHT_PRESSURE = 0.5;

export function tickRun(rt: RuntimeState, dt: number): void {
  if (!rt.running || !rt.alive) return;

  rt.elapsed += dt;
  if (rt.stumbleTimer > 0) rt.stumbleTimer = Math.max(0, rt.stumbleTimer - dt);

  // Timed modes end on the clock rather than on a crash. Checked first so the
  // final tick cannot also register a collision and report the wrong cause.
  if (rt.timeRemaining !== null) {
    rt.timeRemaining -= dt;
    if (rt.timeRemaining <= 0) {
      rt.timeRemaining = 0;
      rt.alive = false;
      rt.deathCause = 'timeUp';
      rt.running = false;
      return;
    }
  }

  rt.speed =
    speedAt(rt.elapsed) *
    speedMultiplier(rt.powerUps) *
    rt.board.speed *
    (rt.stumbleTimer > 0 ? TUNING.stumble.speedMultiplier : 1);
  rt.distance += rt.speed * dt;

  stepPowerUps(rt.powerUps, dt, rt.expiredPowerUps);
  applyFlightState(rt);

  stepLane(rt.lane, dt, rt.board.control);
  rideRail(rt);
  stepPlayer(rt.player, dt);
  stepChaser(rt.chaser, dt, rt.board.grip);

  // Paced against the sustained cruising speed, not `rt.speed`: a stumble or an
  // Avalanche Board burst is a moment, while the track being laid is six
  // seconds ahead and should reflect what the player will actually be doing.
  updateSpawner(
    rt.track,
    rt.distance,
    tierAt(rt.distance),
    rt.rng,
    speedAt(rt.elapsed) * rt.board.speed,
  );

  writePlayerAabb(rt.player, rt.lane.x, rt.scratch.player);

  triggerRails(rt);
  triggerRamps(rt);
  if (rt.player.ramping || rt.player.motion === 'grinding') {
    writePlayerAabb(rt.player, rt.lane.x, rt.scratch.player);
  }

  collideObstacles(rt);
  if (!rt.alive) return;

  collectPickups(rt);
  collectCoins(rt);
  updateScore(rt);
}

/** Keeps the player's motion in sync with whether a flight power-up is active. */
function applyFlightState(rt: RuntimeState): void {
  const height = flightHeight(rt.powerUps);

  if (height !== null && rt.player.motion !== 'flying') {
    startFlight(rt.player, height);
  } else if (height === null && rt.player.motion === 'flying') {
    endFlight(rt.player);
  }
}

/**
 * Advances a grind, and ends it if the player steered off the rail.
 *
 * Steering off is a bail rather than a crash. The rail was optional, the height
 * and the coin line above it are the reward, and losing both is the cost - a
 * death there would punish curiosity, which is the opposite of what an optional
 * route is for.
 */
function rideRail(rt: RuntimeState): void {
  const { player } = rt;
  if (player.motion !== 'grinding') return;

  if (rt.lane.targetLane !== player.grindLane) {
    bailRail(player);
    return;
  }

  stepGrind(player, rt.distance - player.grindFromZ);
}

/**
 * Mounts a rail the player has reached in any way at all.
 *
 * Tested along the rail's whole length rather than against a trigger box at its
 * near end. The box was one of the bugs behind rails failing to mount: it lived
 * inside the six-metre collision window, so an eighteen-metre rail was only
 * catchable in the first couple of metres of it.
 *
 * Whether the player mounts is left entirely to `mountRail`, which decides on
 * geometry alone - where their feet are against where the bar is. Nothing here
 * asks what they pressed.
 */
function triggerRails(rt: RuntimeState): void {
  const { player } = rt;
  if (player.motion === 'grinding' || player.motion === 'flying') return;

  for (const bar of rt.track.rails) {
    if (!bar.active) continue;
    // The lane being steered towards, not the one being left: committing to a
    // rail mid-lane-change should land on it rather than fall between.
    if (rt.lane.targetLane !== bar.lane) continue;

    const along = rt.distance - bar.trackZ;
    if (along < 0 || along >= TUNING.rail.length) continue;

    if (!mountRail(player, bar.trackZ, bar.lane, along)) continue;

    // Re-catching a rail after popping off it mid-grind is a trick, not a
    // cheat, so remounting is allowed - `used` only guards the run stat.
    if (!bar.used) {
      bar.used = true;
      rt.railGrinds++;
    }
  }
}

function triggerRamps(rt: RuntimeState): void {
  const { player, entity } = rt.scratch;
  const { ramp } = TUNING;

  for (const pad of rt.track.ramps) {
    if (!pad.active || pad.used) continue;

    const worldZ = worldZOf(pad.trackZ, rt.distance);
    if (!withinZWindow(worldZ, TUNING.player.z)) continue;

    entity.x = laneToX(pad.lane);
    entity.y = ramp.centreY;
    entity.z = worldZ;
    entity.hx = ramp.halfWidth;
    entity.hy = ramp.halfHeight;
    entity.hz = ramp.halfDepth;

    if (!aabbOverlap(player, entity)) continue;

    // Airborne players pass straight over a ramp rather than being re-launched.
    if (launchFromRamp(rt.player, rt.speed)) {
      pad.used = true;
      rt.rampLaunches++;
    }
  }
}

function collideObstacles(rt: RuntimeState): void {
  const { player, entity } = rt.scratch;
  const shrink = Math.max(0, 1 - TUNING.collision.forgiveness);
  const invulnerable = isInvulnerable(rt.powerUps);
  const smashing = smashesObstacles(rt.powerUps);

  for (const obstacle of rt.track.obstacles) {
    if (!obstacle.active) continue;

    const worldZ = worldZOf(obstacle.trackZ, rt.distance);
    if (!withinZWindow(worldZ, TUNING.player.z)) continue;

    const def = obstacleDef(obstacle.kind);
    entity.x = laneToX(obstacle.lane);
    entity.y = def.centreY;
    entity.z = worldZ;
    entity.hx = def.halfWidth * shrink;
    entity.hy = def.halfHeight * shrink;
    entity.hz = def.halfDepth * shrink;

    // The player collider is shrunk too - both sides being forgiving is what
    // makes a near miss read as skill rather than luck.
    const px = player.hx;
    const py = player.hy;
    const pz = player.hz;
    player.hx = px * shrink;
    player.hy = py * shrink;
    player.hz = pz * shrink;
    const hit = aabbOverlap(player, entity);
    player.hx = px;
    player.hy = py;
    player.hz = pz;

    if (hit) {
      if (smashing) {
        // Plough straight through it.
        obstacle.active = false;
        rt.smashed++;
        rt.score += SMASH_SCORE;
        continue;
      }

      // Flying or otherwise protected: pass through without consequence.
      if (invulnerable) continue;

      // Still picking themselves up from the last trip - one contact per
      // stumble, or a cluster of drifts would be an instant loss.
      if (rt.stumbleTimer > 0) continue;

      // A low obstacle trips the player; anything solid ends the run outright.
      // Modes can make a trip fatal outright, which is what Blizzard does.
      if (def.action === 'jump' && !rt.mode.lethalStumbles) {
        // Tripped while the patrol is already on top of you: caught.
        if (chaserPressure(rt.chaser) >= CAUGHT_PRESSURE) {
          rt.alive = false;
          rt.deathCause = 'caught';
          rt.running = false;
          return;
        }

        obstacle.active = false;
        rt.stumbles++;
        rt.stumbleTimer = TUNING.stumble.duration;
        rt.combo = 0;
        chaserCloseIn(rt.chaser);
        continue;
      }

      rt.alive = false;
      rt.deathCause = 'obstacle';
      rt.running = false;
      return;
    }

    // Cleared it. Counting on the way past, not on the way in, means a combo
    // is only ever awarded for an obstacle actually survived.
    if (!obstacle.passed && worldZ > TUNING.player.halfDepth) {
      obstacle.passed = true;
      rt.combo++;
    }
  }
}

function collectPickups(rt: RuntimeState): void {
  const { player, entity } = rt.scratch;
  const radiusSquared = PICKUP_RADIUS * PICKUP_RADIUS;

  for (const pickup of rt.track.pickups) {
    if (!pickup.active) continue;

    const worldZ = worldZOf(pickup.trackZ, rt.distance);
    if (!withinZWindow(worldZ, TUNING.player.z, PICKUP_RADIUS)) continue;

    entity.x = laneToX(pickup.lane);
    entity.y = TUNING.coins.baseHeight + 0.2;
    entity.z = worldZ;

    if (distanceSquared(player, entity) > radiusSquared) continue;

    pickup.active = false;
    // Re-collecting refreshes to the full duration rather than stacking, so a
    // lucky pickup run cannot bank a minute of invincibility.
    rt.powerUps[pickup.powerUp] = rt.powerUpDurations[pickup.powerUp];
    rt.collectedPowerUp = pickup.powerUp;
    rt.powerUpsCollected++;
  }
}

function collectCoins(rt: RuntimeState): void {
  const { player, entity } = rt.scratch;
  const radius = TUNING.coins.pickupRadius * coinPickupMultiplier(rt.powerUps);
  const radiusSquared = radius * radius;

  for (const coin of rt.track.coins) {
    if (!coin.active) continue;

    const worldZ = worldZOf(coin.trackZ, rt.distance);
    if (!withinZWindow(worldZ, TUNING.player.z, radius)) continue;

    entity.x = laneToX(coin.lane);
    entity.y = coin.y;
    entity.z = worldZ;

    if (distanceSquared(player, entity) <= radiusSquared) {
      coin.active = false;
      rt.coins++;
    }
  }
}

function updateScore(rt: RuntimeState): void {
  if (rt.combo > rt.bestCombo) rt.bestCombo = rt.combo;

  const comboMultiplier = Math.min(MAX_MULTIPLIER, 1 + Math.floor(rt.combo / COMBO_PER_STEP));
  rt.multiplier = comboMultiplier * scoreMultiplier(rt.powerUps);

  const distanceScore = rt.distance * TUNING.scoring.pointsPerUnit;
  // The board's fortune stat lands on coins only, not distance, so a
  // high-fortune board rewards collecting rather than merely surviving.
  const coinScore = rt.coins * TUNING.scoring.pointsPerCoin * rt.multiplier * rt.board.fortune;
  const smashScore = rt.smashed * SMASH_SCORE;
  // The mode multiplier is applied last, over the whole run, so a harder mode
  // is worth playing rather than just harder.
  rt.score = Math.floor((distanceScore + coinScore + smashScore) * rt.mode.scoreMultiplier);
}

export { CAUGHT_PRESSURE, COMBO_PER_STEP, MAX_MULTIPLIER, PICKUP_RADIUS, SMASH_SCORE };
