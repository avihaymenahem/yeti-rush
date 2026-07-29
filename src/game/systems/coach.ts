/**
 * The opening coach.
 *
 * Decides which of the three inputs to prompt for, right now. Pure: it reads
 * the runtime and returns a hint, and nothing it does can change a run. That is
 * what lets it be tested over real generated track rather than a staged lane.
 *
 * Reactive rather than scripted, and that is the whole design. A tutorial lane
 * teaches inputs in a place the player then has to leave; prompting when
 * something jumpable is actually on its way teaches the same input at the
 * moment it is needed, on the real slope, and costs the generator nothing. It
 * also means the coach can never make a run unwinnable, because the only thing
 * it asks of the track is a quiet opening - and that goes through `clearUntil`,
 * which has existed for ramp landings since long before this.
 */

import { TUNING } from '@/game/config/tuning';
import { obstacleDef } from '@/game/content/obstacles';
import type { RuntimeState } from '@/game/state/runtime';
import { worldZOf } from '@/game/systems/spawner';

export type CoachHint = 'move' | 'jump' | 'slide';

/**
 * Updates what the player has demonstrated.
 *
 * Inferred from the player's own state rather than from the gesture handler, so
 * a swipe, an arrow key and a scripted tap all count identically - and an input
 * that was rejected (a slide into a wall, a jump while grinding) does not count
 * as having been learnt, because nothing visibly happened.
 */
export function noteLearned(rt: RuntimeState): void {
  if (!rt.coaching) return;

  // Leaving the centre lane is the only unambiguous evidence of a steer: `x`
  // drifts during the ease, but the target only moves when a swipe took.
  if (rt.lane.targetLane !== 1) rt.learned.move = true;
  // A ramp launch is not a jump the player made, so it does not count.
  if (rt.player.motion === 'airborne' && !rt.player.ramping) rt.learned.jump = true;
  if (rt.player.motion === 'sliding' || rt.player.slideQueued) rt.learned.slide = true;
}

/**
 * The hint to show, or null.
 *
 * Order matters. Steering is prompted first and unconditionally, because it is
 * the input the whole game is made of and the opening is deliberately empty -
 * there is nothing else to say during it. After that the prompt follows the
 * track: whatever is coming decides what is taught next, so a player who meets
 * a low drift first learns to jump first.
 */
export function coachHint(rt: RuntimeState): CoachHint | null {
  if (!rt.coaching) return null;
  if (rt.distance > TUNING.coach.givesUpAfter) return null;
  if (rt.learned.move && rt.learned.jump && rt.learned.slide) return null;

  if (!rt.learned.move) return 'move';

  const horizon = rt.speed * TUNING.coach.lookaheadSeconds;
  let nearest: { ahead: number; hint: CoachHint } | null = null;

  for (const obstacle of rt.track.obstacles) {
    if (!obstacle.active) continue;

    const ahead = -worldZOf(obstacle.trackZ, rt.distance);
    if (ahead <= 0 || ahead > horizon) continue;
    // Only what is actually in the way. A prompt to jump over something two
    // lanes across teaches the wrong lesson about when to jump.
    if (obstacle.lane !== rt.lane.targetLane) continue;

    const { action } = obstacleDef(obstacle.kind);
    if (action === 'dodge') continue;
    if (rt.learned[action]) continue;

    if (!nearest || ahead < nearest.ahead) nearest = { ahead, hint: action };
  }

  // Rails answer to a jump and nothing else, so they teach it just as well.
  if (!rt.learned.jump) {
    for (const rail of rt.track.rails) {
      if (!rail.active || rail.lane !== rt.lane.targetLane) continue;
      const ahead = -worldZOf(rail.trackZ, rt.distance);
      if (ahead <= 0 || ahead > horizon) continue;
      if (!nearest || ahead < nearest.ahead) nearest = { ahead, hint: 'jump' };
    }
  }

  return nearest?.hint ?? null;
}
