/**
 * The ski patrol.
 *
 * A snowmobile riding the player's tail. It exists purely for tension: with an
 * ordinary endless runner the only feedback for a near miss is that nothing
 * happened, which is no feedback at all. The patrol converts mistakes into
 * something visible closing in behind you, and clean running into it falling
 * away.
 *
 * It never kills on its own. Death is always the obstacle you hit - the patrol
 * is the reason a second mistake soon after the first feels dangerous.
 */

import { TUNING } from '@/game/config/tuning';
import { clamp } from '@/game/core/math';

export interface ChaserState {
  /** Metres behind the player. Larger is safer. */
  distance: number;
  /** True while the patrol is close enough to be worth showing. */
  visible: boolean;
}

export const CHASER = {
  /** Distance the patrol settles at while the player is running cleanly. */
  restingDistance: 26,
  /** Closest it ever gets. */
  minDistance: 5,
  /** Furthest it is tracked; beyond this it is simply not drawn. */
  maxDistance: 34,
  /**
   * Metres per second it drops back while the player runs clean.
   *
   * This was 5.5, which shook a trip off in two seconds and is the reason
   * nobody was ever caught even after the fatal threshold was fixed. It is not
   * a free choice: the danger window can only ever be as long as the recovery,
   * because the patrol is lethal for whatever part of it lies above the
   * threshold. Even a threshold of zero - "any pressure at all is fatal" -
   * cannot stretch a two-second recovery past two seconds, so this is the knob
   * that had to move and `CAUGHT_PRESSURE` was never going to be enough alone.
   *
   * Measured with the clumsy pilot in `tests/support/autopilot.ts`, 30 seeds:
   * at 5.5 and 2.5 nobody is ever caught. At 1.2 a player fluffing every second
   * jump is caught in 5 runs of 30, every third jump in 2 of 30, and every
   * fifth jump in none at all. That curve is the mechanic - repeated sloppiness
   * is punished and a single mistake is not.
   */
  recoverRate: 1.2,
  /** Metres it jumps forward on a stumble. */
  stumblePenalty: 11,
  /** It is only drawn once this close. */
  visibleWithin: 30,
} as const;

export function createChaserState(): ChaserState {
  return { distance: CHASER.restingDistance, visible: false };
}

export function resetChaser(chaser: ChaserState): void {
  chaser.distance = CHASER.restingDistance;
  chaser.visible = false;
}

/** Called when the player takes a hit they survived. */
export function chaserCloseIn(chaser: ChaserState): void {
  chaser.distance = clamp(
    chaser.distance - CHASER.stumblePenalty,
    CHASER.minDistance,
    CHASER.maxDistance,
  );
}

/**
 * @param gripScale - the equipped board's grip stat. Above 1 shakes the patrol
 *        off faster, which is what makes a forgiving board forgiving.
 * @param recovering - false while the player is still picking themselves up.
 *        Ground is not made back during a stumble: the player is down to a
 *        fraction of their speed and the patrol is not, so dropping back then
 *        is the one thing that cannot be happening.
 *
 *        This is what makes the danger window a usable width rather than what
 *        makes it exist - see `CAUGHT_PRESSURE`, which is the half that was
 *        actually broken. Contacts are ignored for the whole of
 *        `stumble.duration`, and letting the patrol recover through that window
 *        spends most of the grace period before the player can act on it: 1.3 s
 *        of real danger instead of the 2 s the mechanic is written around.
 */
export function stepChaser(
  chaser: ChaserState,
  dt: number,
  gripScale = 1,
  recovering = true,
): void {
  if (recovering && chaser.distance < CHASER.restingDistance) {
    chaser.distance = Math.min(
      CHASER.restingDistance,
      chaser.distance + CHASER.recoverRate * Math.max(0, gripScale) * dt,
    );
  }
  chaser.visible = chaser.distance <= CHASER.visibleWithin;
}

/** World Z of the patrol, behind the player. */
export function chaserWorldZ(chaser: ChaserState): number {
  return TUNING.player.z + chaser.distance;
}

/** How close the patrol is, 0 (resting) to 1 (breathing down your neck). */
export function chaserPressure(chaser: ChaserState): number {
  const span = CHASER.restingDistance - CHASER.minDistance;
  return clamp((CHASER.restingDistance - chaser.distance) / span, 0, 1);
}
