/**
 * Player vertical motion and pose.
 *
 * The jump is a hand-tuned ballistic arc, not a physics body: gravity is
 * asymmetric (falling is faster than rising) because a mathematically correct
 * arc reads as floaty, and a short input buffer means a jump pressed just
 * before landing still fires instead of being swallowed.
 */

import { TUNING } from '@/game/config/tuning';
import type { Aabb } from '@/game/systems/collision';
import { rampGravity, rampLaunchVelocity } from '@/game/systems/ramp';
import { railHeightAt, railTopHeight } from '@/game/systems/rail';

export type PlayerMotion = 'running' | 'airborne' | 'sliding' | 'flying' | 'grinding';

export interface PlayerState {
  motion: PlayerMotion;
  /** Height of the player's feet above the snow. */
  y: number;
  /** Vertical velocity in units/second. */
  vy: number;
  /** Seconds left in the current slide. */
  slideTimer: number;
  /** Seconds left in which a pressed-early jump will still fire on landing. */
  jumpBuffer: number;
  /** Set when a slide was requested mid-air, to start it on touchdown. */
  slideQueued: boolean;
  /** True while flying a ramp arc rather than an ordinary jump. */
  ramping: boolean;
  /** Gravity for the current ramp arc; only meaningful while `ramping`. */
  rampGravity: number;
  /** Spent when a mid-air jump is used; refreshed on landing. */
  doubleJumpUsed: boolean;
  /** Height the player is being held at while flying. */
  flightHeight: number;
  /**
   * Track distance where the current grind started. Only meaningful while
   * `motion` is 'grinding'.
   *
   * The rail's *position* rather than a reference to the rail entity: entities
   * come from a recycled pool, and holding one across frames would let a rail
   * that scrolled past and got reused teleport a grinding player.
   */
  grindFromZ: number;
  /** Lane the rail being ridden is in; steering out of it ends the grind. */
  grindLane: number;
}

export function createPlayerState(): PlayerState {
  return {
    motion: 'running',
    y: 0,
    vy: 0,
    slideTimer: 0,
    jumpBuffer: 0,
    slideQueued: false,
    ramping: false,
    rampGravity: 0,
    doubleJumpUsed: false,
    flightHeight: 0,
    grindFromZ: 0,
    grindLane: -1,
  };
}

export function resetPlayerState(player: PlayerState): void {
  player.motion = 'running';
  player.y = 0;
  player.vy = 0;
  player.slideTimer = 0;
  player.jumpBuffer = 0;
  player.slideQueued = false;
  player.ramping = false;
  player.rampGravity = 0;
  player.doubleJumpUsed = false;
  player.flightHeight = 0;
  player.grindFromZ = 0;
  player.grindLane = -1;
}

export function isGrounded(player: PlayerState): boolean {
  return player.motion === 'running' || player.motion === 'sliding';
}

/** True while riding a rail. Not "grounded" - the ground is somewhere below. */
export function isGrinding(player: PlayerState): boolean {
  return player.motion === 'grinding';
}

/**
 * Handles a jump input. Returns true if the player left the ground now, so
 * callers can fire the SFX exactly once (a buffered jump reports on landing).
 */
/**
 * @param allowDoubleJump - granted by the Snow Angel power-up. One extra jump
 *        per airtime; the charge is restored on landing, not on a timer.
 */
export function requestJump(player: PlayerState, allowDoubleJump = false): boolean {
  // Flying is on rails - a jump has nothing to push against.
  if (player.motion === 'flying') return false;

  // Jumping off a rail. Without this the bar is a cage: `isGrounded` is false
  // while grinding, so the jump fell through to the double-jump branch, which
  // set an upward velocity that `stepGrind` overwrote with zero on the very
  // next tick. The only way off was to steer off, which costs the height.
  if (player.motion === 'grinding') {
    releaseRail(player);
    player.vy = TUNING.player.jumpVelocity;
    return true;
  }

  if (!isGrounded(player)) {
    if (allowDoubleJump && !player.doubleJumpUsed) {
      player.doubleJumpUsed = true;
      player.slideQueued = false;
      // A ramp flight interrupted by a double jump becomes an ordinary jump,
      // otherwise the ramp's low gravity would carry the player forever.
      player.ramping = false;
      player.rampGravity = 0;
      player.vy = TUNING.player.jumpVelocity;
      return true;
    }

    player.jumpBuffer = TUNING.player.jumpBufferTime;
    return false;
  }

  // Jumping out of a slide is allowed and cancels the slide.
  player.slideTimer = 0;
  player.slideQueued = false;
  player.motion = 'airborne';
  player.vy = TUNING.player.jumpVelocity;
  return true;
}

/** Lifts the player onto the chairlift line. */
export function startFlight(player: PlayerState, height: number): void {
  player.motion = 'flying';
  player.flightHeight = height;
  player.vy = 0;
  player.ramping = false;
  player.rampGravity = 0;
  player.slideTimer = 0;
  player.slideQueued = false;
  player.jumpBuffer = 0;
}

/** Drops the player off the chairlift into an ordinary fall. */
export function endFlight(player: PlayerState): void {
  if (player.motion !== 'flying') return;
  player.motion = 'airborne';
  player.vy = 0;
  player.flightHeight = 0;
}

/**
 * Handles a slide input. Sliding while airborne slams the player back down -
 * a dive - which is how you recover from a badly timed jump.
 */
export function requestSlide(player: PlayerState): boolean {
  // Flying is on rails; there is no ground to slide along.
  if (player.motion === 'flying') return false;

  // Sliding off a rail drops you back to the snow - the same dive an airborne
  // slide does, and the deliberate way to abandon a rail without steering off
  // it into whatever the next lane holds.
  if (player.motion === 'grinding') bailRail(player);

  if (!isGrounded(player)) {
    player.slideQueued = true;
    // Kill upward momentum and drive down hard for a snappy dive.
    player.vy = -TUNING.player.jumpVelocity;
    return false;
  }

  player.motion = 'sliding';
  player.slideTimer = TUNING.player.slideDuration;
  return true;
}

/**
 * Launches the player off a ramp.
 *
 * The arc is solved from the *distance* it should cover, not a duration, so it
 * traces the same shape through the world at 12 u/s and at 30 u/s. A chalet
 * placed to be clearable is therefore clearable for the whole run - defining
 * the arc in seconds would silently turn it into a wall as the speed ramps up.
 *
 * Symmetric gravity here (no fall multiplier): a ramp flight is meant to hang.
 */
export function launchFromRamp(player: PlayerState, speed: number): boolean {
  if (!isGrounded(player)) return false;
  if (!Number.isFinite(speed) || speed <= 0) return false;

  player.slideTimer = 0;
  player.slideQueued = false;
  player.jumpBuffer = 0;
  player.motion = 'airborne';
  player.ramping = true;
  player.rampGravity = rampGravity(speed);
  player.vy = rampLaunchVelocity(speed);
  return true;
}

/**
 * Puts the player onto a rail, `distanceAlong` metres from its near end.
 *
 * Mounting takes *intent* - a jump or a slide - and then only needs the player's
 * feet to be where the bar is. There is no input to get right:
 *
 *  - on the snow, riding into the near end steps you onto it, because that is
 *    what happens when you ride into a bar at ankle height;
 *  - in the air, the bar catches you wherever your arc crosses it, which is how
 *    every game that has ever had a grind rail behaves.
 *
 * Past the near end the bar is overhead and a grounded player runs underneath
 * untouched - that, not an input requirement, is what keeps the track beneath a
 * rail passable on its own terms and rails out of the solvability guarantee.
 *
 * Mounting used to demand a deliberate slide, on the reasoning that a rail
 * should be answered rather than stumbled onto. Two separate reports killed
 * that idea. A jump - the instinct - silently failed and dropped the player
 * onto the obstacle the rail exists to carry them over. And going at it in a
 * straight line, the first thing anyone tries with a solid object, passed
 * clean through it. A route the obvious inputs cannot take is not an optional
 * route; it is a bug with a design rationale attached.
 */
export function mountRail(
  player: PlayerState,
  railTrackZ: number,
  lane: number,
  distanceAlong: number,
): boolean {
  // Already on it, or above it on a lift. A ramp flight is committed to its own
  // arc and must not be plucked out of the air mid-chalet.
  if (player.motion === 'grinding' || player.motion === 'flying') return false;
  if (player.ramping) return false;

  const barHeight = railHeightAt(distanceAlong);

  if (isGrounded(player)) {
    // Stepping up onto it from the snow, so what matters is how high the bar
    // has climbed - not how near it is, which is trivially zero on the ground.
    if (barHeight > TUNING.rail.stepUpHeight) return false;
  } else if (Math.abs(player.y - barHeight) > TUNING.rail.catchHeight) {
    return false;
  }

  player.motion = 'grinding';
  player.grindFromZ = railTrackZ;
  player.grindLane = lane;
  player.slideTimer = 0;
  player.slideQueued = false;
  player.jumpBuffer = 0;
  player.ramping = false;
  player.rampGravity = 0;
  player.vy = 0;
  player.y = barHeight;
  return true;
}

/**
 * Throws the player off the end of a rail.
 *
 * A small upward pop rather than a plain drop, so the exit reads as being
 * launched off the end instead of the rail simply ceasing to exist. The double
 * jump is refreshed here, exactly as it is on landing - a rail exit is the
 * moment a Snow Angel is most worth having.
 */
export function releaseRail(player: PlayerState): void {
  if (player.motion !== 'grinding') return;
  player.motion = 'airborne';
  player.vy = TUNING.rail.exitVelocity;
  player.grindLane = -1;
  player.doubleJumpUsed = false;
}

/**
 * Drops the player off a rail without the exit pop - they steered off it.
 *
 * Deliberately not a death. Falling off a rail costs the height, the coins
 * above it and whatever the rail was carrying you over; that is punishment
 * enough for a route nobody was obliged to take.
 */
export function bailRail(player: PlayerState): void {
  if (player.motion !== 'grinding') return;
  player.motion = 'airborne';
  player.vy = 0;
  player.grindLane = -1;
}

/**
 * Rides the rail, given how far along it the player now is.
 *
 * Driven by distance rather than by `dt`, so the rail lifts to the same height
 * whatever the run speed - the same reasoning as the ramp arc. Returns false
 * once the player has run out of rail, having released them.
 */
export function stepGrind(player: PlayerState, distanceAlong: number): boolean {
  if (player.motion !== 'grinding') return false;

  if (distanceAlong >= TUNING.rail.length) {
    player.y = railTopHeight();
    releaseRail(player);
    return false;
  }

  player.y = railHeightAt(distanceAlong);
  player.vy = 0;
  return true;
}

/** Advances vertical motion and pose by one fixed sim step. */
export function stepPlayer(player: PlayerState, dt: number): void {
  if (player.jumpBuffer > 0) player.jumpBuffer = Math.max(0, player.jumpBuffer - dt);

  switch (player.motion) {
    // Height comes from `stepGrind`, which is driven by distance along the
    // rail. Falling through the normal cases would apply gravity on top.
    case 'grinding':
      break;

    case 'airborne': {
      const gravity = player.ramping
        ? player.rampGravity
        : TUNING.player.gravity * (player.vy < 0 ? TUNING.player.fallGravityMultiplier : 1);

      // Exact integration for constant acceleration, rather than the usual
      // `vy -= g*dt; y += vy*dt`. Plain Euler accumulates a systematic error of
      // 0.5*g*dt*t, which at ramp gravity is over 20cm by mid-flight - enough
      // to clip a chalet the arc was authored to clear. This form costs one
      // extra multiply and is exact.
      player.y += player.vy * dt - 0.5 * gravity * dt * dt;
      player.vy -= gravity * dt;

      if (player.y <= 0) {
        player.y = 0;
        player.vy = 0;
        player.motion = 'running';
        player.ramping = false;
        player.rampGravity = 0;
        player.doubleJumpUsed = false;

        // Land into whatever was queued during the airtime.
        if (player.slideQueued) {
          player.slideQueued = false;
          player.jumpBuffer = 0;
          player.motion = 'sliding';
          player.slideTimer = TUNING.player.slideDuration;
        } else if (player.jumpBuffer > 0) {
          player.jumpBuffer = 0;
          player.motion = 'airborne';
          player.vy = TUNING.player.jumpVelocity;
        }
      }
      break;
    }

    case 'sliding': {
      player.slideTimer -= dt;
      if (player.slideTimer <= 0) {
        player.slideTimer = 0;
        player.motion = 'running';
      }
      break;
    }

    case 'flying': {
      // Rise onto the lift line quickly but not instantly, so the transition
      // is legible rather than a teleport.
      const gap = player.flightHeight - player.y;
      const rise = 9 * dt;
      player.y += Math.abs(gap) <= rise ? gap : Math.sign(gap) * rise;
      player.vy = 0;
      break;
    }

    case 'running':
      break;
  }
}

/** Current collider half-height - a slide is what gets you under a barrier. */
export function playerHalfHeight(player: PlayerState): number {
  return player.motion === 'sliding' ? TUNING.player.slideHalfHeight : TUNING.player.halfHeight;
}

/** Writes the player's collider into `out`. Allocation-free for the hot path. */
export function writePlayerAabb(player: PlayerState, laneX: number, out: Aabb): void {
  const hy = playerHalfHeight(player);
  out.x = laneX;
  out.y = player.y + hy;
  out.z = TUNING.player.z;
  out.hx = TUNING.player.halfWidth;
  out.hy = hy;
  out.hz = TUNING.player.halfDepth;
}
