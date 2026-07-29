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
  phasesThroughObstacles,
  scoreMultiplier,
  speedMultiplier,
  stepPowerUps,
} from '@/game/content/powerUps';
import type { RuntimeState } from '@/game/state/runtime';
import {
  CHASER,
  chaserCloseIn,
  chaserPressure,
  resetChaser,
  stepChaser,
} from '@/game/systems/chaser';
import { noteLearned } from '@/game/systems/coach';
import { aabbOverlap, distanceSquared, withinZWindow } from '@/game/systems/collision';
import { speedAt, tierAt } from '@/game/systems/difficulty';
import { laneToX, stepLane } from '@/game/systems/lanes';
import {
  bailRail,
  isGrounded,
  endFlight,
  launchFromRamp,
  mountRail,
  startFlight,
  settleTricks,
  stepGrind,
  stepPlayer,
  writePlayerAabb,
} from '@/game/systems/player';
import { updateSpawner, worldZOf } from '@/game/systems/spawner';

/** Obstacles cleared per step of the score multiplier. */
const COMBO_PER_STEP = 10;
/** Highest multiplier the combo alone can reach. */
const MAX_MULTIPLIER = 5;
/** Score awarded for riding through an obstacle on the ghost board. */
const PHASE_SCORE = 25;
/** Radius within which a power-up pickup is collected. */
const PICKUP_RADIUS = 1.3;
/**
 * Patrol pressure at or above which a stumble is fatal.
 *
 * Trip once and the next trip catches you; run clean for six or seven seconds
 * and the patrol has dropped back far enough to survive another. That window is
 * the whole tension mechanic.
 *
 * This used to be 0.5 and *never fired once*, in any run anyone ever played.
 * Two windows cancelled out. A stumble puts the patrol at 15 m, pressure 0.52,
 * over the old line by a whisker - but every contact is ignored for the whole
 * 0.7 s of `stumble.duration` while the player picks themselves up, and the
 * patrol dropped back throughout. By the moment a second trip was possible it
 * was at 18.9 m and pressure 0.34, and only ever getting further away. The
 * branch was unreachable by construction.
 *
 * Fixing it took three things, and the order they were found in is worth
 * keeping: this threshold made the branch *reachable*, pausing recovery during
 * a stumble (see `stepChaser`) stopped the grace being spent before the player
 * could act on it, and slowing `recoverRate` made it happen often enough to
 * exist. After the first two, thirty measured runs by a deliberately clumsy
 * pilot still produced no catches at all.
 *
 * Derived rather than chosen, so it stays honest if the numbers around it move.
 * After the immunity ends the patrol is at `restingDistance - stumblePenalty`
 * and closes the gap at `recoverRate`, so this is simply how much of that
 * recovery is fatal - a little over six seconds of it, at these numbers.
 * Which is to say "the patrol has not finished dropping back yet", also what it
 * ought to mean.
 */
const CAUGHT_PRESSURE = 0.18;

export function tickRun(rt: RuntimeState, dt: number): void {
  if (!rt.running || !rt.alive) return;

  rt.elapsed += dt;
  if (rt.stumbleTimer > 0) rt.stumbleTimer = Math.max(0, rt.stumbleTimer - dt);
  if (rt.graceTimer > 0) rt.graceTimer = Math.max(0, rt.graceTimer - dt);

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

  stepAvalanche(rt, dt);

  rt.speed =
    speedAt(rt.elapsed) *
    speedMultiplier(rt.powerUps) *
    rt.board.speed *
    (rt.avalancheTimer > 0 ? TUNING.avalanche.speedBoost : 1) *
    (rt.stumbleTimer > 0 ? TUNING.stumble.speedMultiplier : 1);
  rt.distance += rt.speed * dt;

  stepPowerUps(rt.powerUps, dt, rt.expiredPowerUps);
  applyFlightState(rt);

  stepLane(rt.lane, dt, rt.board.control);
  rideRail(rt);

  // Tricks are settled here rather than inside `stepPlayer`, which has no
  // runtime to pay into. Keyed on becoming grounded rather than on the ramp
  // ending, so a flight cut short by a double jump still banks what it earned.
  const wasAirborne = !isGrounded(rt.player);
  stepPlayer(rt.player, dt);
  if (wasAirborne && isGrounded(rt.player) && rt.player.trickChain + rt.player.trickTimer > 0) {
    const banked = settleTricks(rt.player);
    if (banked > 0) {
      rt.trickScore += banked;
      rt.tricksLanded++;
    } else {
      rt.trickFumbles++;
    }
  }
  // Not while an avalanche is holding it in place, and not while the player is
  // down - see `stepChaser` for why the second one matters.
  if (rt.avalancheTimer <= 0) stepChaser(rt.chaser, dt, rt.board.grip, rt.stumbleTimer <= 0);

  // Paced against the sustained cruising speed, not `rt.speed`: a stumble or an
  // ghost board burst is a moment, while the track being laid is six
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
  // Last, so it sees the state this tick actually ended in.
  noteLearned(rt);
}

/**
 * Starts, runs and ends the avalanche.
 *
 * The only thing it actually changes is where the patrol is. Pinned at
 * `minDistance` the pressure is at its maximum, which is above
 * `CAUGHT_PRESSURE` - so for the duration, the trip that normally costs a combo
 * ends the run. Nothing about the generated track is touched, so every
 * guarantee the spawner makes still holds during one.
 *
 * The patrol is *held* there rather than pushed once, because `stepChaser`
 * would otherwise start walking it back the very next tick.
 */
function stepAvalanche(rt: RuntimeState, dt: number): void {
  // Scheduled by distance rather than by time, so a slow board and a fast one
  // meet the same number of them over the same stretch of mountain.
  if (rt.avalancheTimer <= 0 && rt.distance >= rt.nextAvalancheAt) {
    rt.avalancheTimer = TUNING.avalanche.duration;
    rt.nextAvalancheAt = rt.distance + TUNING.avalanche.interval;
  } else if (rt.avalancheTimer > 0) {
    rt.avalancheTimer = Math.max(0, rt.avalancheTimer - dt);
    if (rt.avalancheTimer === 0) {
      // Outran it. The patrol falls away and the run is paid for the nerve.
      rt.avalanchesSurvived++;
      resetChaser(rt.chaser);
      return;
    }
  }

  if (rt.avalancheTimer <= 0) return;

  // Pinned on the *starting* tick as well as every one after it. Arriving a
  // frame late is not a rounding detail: the banner and the rule change would
  // disagree for that frame, which is the frame a player is most likely to be
  // reacting to the banner.
  rt.chaser.distance = CHASER.minDistance;
  rt.chaser.visible = true;
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

  const bar = rt.track.rails.find(
    (rail) => rail.active && rail.trackZ === player.grindFromZ,
  );
  stepGrind(player, rt.distance - player.grindFromZ, bar?.length);
}

/**
 * Puts a jumping player onto a rail, and trips one who rode into it.
 *
 * Both halves matter and they are the same rule seen from either side. A grind
 * rail is a solid steel bar a metre off the snow: ollie onto it and you ride,
 * ride into it and you go down. The first version let a grounded player step
 * onto the low end, which made it a lift rather than a grind - and a version
 * before that let a running player pass clean through the middle of it, which
 * was worse.
 *
 * Unlike a ramp, a rail is therefore *not* free. It occupies its lane, and
 * `railObstacles` hands it to the solvability check as a jumpable at its near
 * end so the guarantee accounts for it rather than being told it is not there.
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
    if (along < 0 || along >= bar.length) continue;

    if (mountRail(player, bar.trackZ, bar.lane, along)) {
      // Re-catching a rail after popping off it mid-grind is a trick, not a
      // cheat, so remounting is allowed - `used` only guards the run stat.
      if (!bar.used) {
        bar.used = true;
        rt.railGrinds++;
      }
      continue;
    }

    // On the snow and in its lane: a collision, and it is what makes landing the
    // ollie worth anything.
    //
    // Sliding is caught too, and the bar's height is set so that this is honest
    // rather than enforced: its underside sits below a sliding player, so there
    // is nothing to duck beneath. A rail has one answer and it is to jump -
    // an obstacle with two answers teaches neither of them.
    if (isGrounded(player) && !isInvulnerable(rt.powerUps) && rt.graceTimer <= 0) {
      // Ends the run outright rather than tripping. A drift or a log is
      // something you clip and ride out of; a steel bar at shin height is not,
      // and a rail that merely slowed you down would make ignoring it the
      // cheaper option than learning to ollie it.
      rt.alive = false;
      rt.deathCause = 'obstacle';
      rt.running = false;
      return;
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

/**
 * How much clearance there was as an obstacle went past, in world units.
 *
 * Negative means the boxes overlapped - which happens, and is not a
 * contradiction: this measures against the *full* colliders while the hit test
 * uses ones shrunk by `collision.forgiveness`, so a pass inside the forgiveness
 * margin scores as the tightest near miss there is. That is deliberate. The
 * moment worth rewarding is the one the player thought they had lost.
 *
 * The larger of the two axes, because an AABB is separated as soon as *either*
 * is: a barrier jumped from an adjacent lane was cleared by height, and the
 * fact that the lane offset was small does not make it a close call. Z is left
 * out because this is only ever asked at the instant of passing, where the two
 * always overlap along it.
 */
export function passingGap(
  playerX: number,
  playerY: number,
  halfWidth: number,
  halfHeight: number,
  obstacleX: number,
  obstacleY: number,
  obstacleHalfWidth: number,
  obstacleHalfHeight: number,
): number {
  const lateral = Math.abs(playerX - obstacleX) - (halfWidth + obstacleHalfWidth);
  const vertical = Math.abs(playerY - obstacleY) - (halfHeight + obstacleHalfHeight);
  return Math.max(lateral, vertical);
}

function collideObstacles(rt: RuntimeState): void {
  const { player, entity } = rt.scratch;
  const shrink = Math.max(0, 1 - TUNING.collision.forgiveness);
  // The revive grace counts here too: a player put back on the track inside
  // the thing that killed them has to be let out of it.
  const invulnerable = isInvulnerable(rt.powerUps) || rt.graceTimer > 0;
  const phasing = phasesThroughObstacles(rt.powerUps);

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
      if (phasing) {
        // Straight through, and it is still standing afterwards. Scored once
        // per obstacle rather than once per tick: the overlap lasts as long as
        // it takes to cross a boulder, which at these speeds is several frames.
        if (!obstacle.phased) {
          obstacle.phased = true;
          rt.phased++;
        }
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

      // `entity` still holds the shrunk half-extents from the hit test, so the
      // full sizes come from the definition rather than from it.
      const gap = passingGap(
        player.x,
        player.y,
        player.hx,
        player.hy,
        entity.x,
        def.centreY,
        def.halfWidth,
        def.halfHeight,
      );
      // Not for something ridden straight through: the gap there is deeply
      // negative - the player was *inside* it - and it would pay a near-miss
      // bonus for every obstacle on the track while the ghost board is up.
      if (!obstacle.phased && gap < TUNING.collision.nearMissGap) rt.nearMisses++;
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
  const phaseScore = rt.phased * PHASE_SCORE;
  // Paid on the way out of an avalanche rather than during it, so the reward is
  // for surviving one and not for being inside one.
  const avalancheScore = rt.avalanchesSurvived * TUNING.avalanche.bonus;
  // Flat, like the phase bonus: tricks already have their own escalation in the
  // chain, and multiplying that by the combo as well compounds twice.
  const trickScore = rt.trickScore;
  // Flat, and outside the combo multiplier. A near miss is already its own
  // reward curve - they cluster in the dense late track where the multiplier is
  // highest anyway, and multiplying them too turns a good run into a runaway.
  const nearMissScore = rt.nearMisses * TUNING.scoring.pointsPerNearMiss;
  // The mode multiplier is applied last, over the whole run, so a harder mode
  // is worth playing rather than just harder.
  rt.score = Math.floor(
    (distanceScore + coinScore + phaseScore + nearMissScore + avalancheScore + trickScore) * rt.mode.scoreMultiplier,
  );
}

export { CAUGHT_PRESSURE, COMBO_PER_STEP, MAX_MULTIPLIER, PHASE_SCORE, PICKUP_RADIUS };
