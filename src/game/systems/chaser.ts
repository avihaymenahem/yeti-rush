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
  /** Metres per second it drops back while the player runs clean. */
  recoverRate: 5.5,
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
 */
export function stepChaser(chaser: ChaserState, dt: number, gripScale = 1): void {
  if (chaser.distance < CHASER.restingDistance) {
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
