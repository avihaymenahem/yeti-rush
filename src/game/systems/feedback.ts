/**
 * Impact feedback: how hard the screen reacts to something happening.
 *
 * Scalars that events raise and time lowers. Every consumer reads them and
 * decides for itself what they mean, so adding a new reaction (a lens streak, a
 * controller rumble) needs no change here.
 *
 * There are three, and they are separate channels rather than one impulse at
 * three strengths because each one is a different *verb*. The flash is
 * pictorial - it is styled as snow thrown at the lens - so reusing it for a
 * trip would make a crash and a stumble the same picture at two sizes, which
 * is the fastest way to teach a player that neither means anything. Rush is a
 * surge forward. Shove is a loss of grip. A consumer that wants "something
 * happened" can take the maximum itself.
 *
 * One of the original two was camera shake, and that is gone for good - see
 * `FEEDBACK` in `visuals.ts`. Shake is the obvious thing to reach for when a
 * moment needs weight, and it is the wrong one on a handheld screen. **Nothing
 * added here may drive a camera translation**; the channels below are consumed
 * as field of view, as tint and as sound, none of which move the aim point.
 *
 * Deliberately *outside* the simulation. Nothing in this file can affect what
 * happens in a run, which is what keeps a seeded run reproducible whether or
 * not anything was ever drawn: the simulation records that a crash occurred,
 * and the render layer decides that a crash is worth a white frame. That is
 * exactly the split `GameLoop.tsx` already uses for audio and haptics.
 *
 * Mutable module state for the same reason `runtime` is: this is read and
 * written every frame, and routing it through React would re-render the tree
 * sixty times a second to move two numbers.
 */

import { FEEDBACK } from '@/game/config/visuals';
import { clamp01 } from '@/game/core/math';

export interface FeedbackState {
  /** Screen flash strength, 0 to 1. */
  flash: number;
  /**
   * Surge forward, 0 to 1. Consumed as an additive kick to the field of view
   * and as the strength of a dark edge gradient - a framing change and a
   * vignette, never a translation.
   */
  rush: number;
  /** Loss of grip, 0 to 1. Longer-lived than the flash: it is a recovery. */
  shove: number;
}

export function createFeedbackState(): FeedbackState {
  return { flash: 0, rush: 0, shove: 0 };
}

/** The single live instance, read by the flash overlay. */
export const feedback: FeedbackState = createFeedbackState();

/**
 * Raises the impulse to at least the given strength.
 *
 * The maximum, never a sum. Two events landing in one tick would otherwise
 * white the screen out for something neither of them was on its own; taking the
 * strongest means the biggest thing that happened is what the player sees,
 * which is also how they would describe the moment.
 */
export function punch(state: FeedbackState, flash: number): void {
  state.flash = Math.max(state.flash, clamp01(flash));
}

/** Raises the rush channel. Maximum, never a sum - see {@link punch}. */
export function punchRush(state: FeedbackState, rush: number): void {
  state.rush = Math.max(state.rush, clamp01(rush));
}

/** Raises the shove channel. Maximum, never a sum - see {@link punch}. */
export function punchShove(state: FeedbackState, shove: number): void {
  state.shove = Math.max(state.shove, clamp01(shove));
}

/**
 * Decays every impulse towards zero.
 *
 * Half-life rather than a linear ramp, so a hard punch and a light one feel
 * like the same kind of event at different sizes, and so the decay is
 * independent of the frame rate.
 *
 * Each channel keeps its own half-life. That is the point of them being
 * separate: a crash is instantaneous and a stumble is something the player
 * recovers from over most of a second, and a shared decay rate would make them
 * the same event again by the back door.
 *
 * Snapped to exactly zero below a floor. Exponential decay never actually
 * arrives, and a flash of 1e-8 still costs a style write every frame for the
 * rest of the session.
 */
export function decayFeedback(state: FeedbackState, dt: number): void {
  state.flash = decay(state.flash, FEEDBACK.flashHalfLife, dt);
  state.rush = decay(state.rush, FEEDBACK.rushHalfLife, dt);
  state.shove = decay(state.shove, FEEDBACK.shoveHalfLife, dt);
}

function decay(value: number, halfLife: number, dt: number): number {
  if (value <= 0) return 0;
  const next = value * Math.pow(0.5, dt / halfLife);
  return next < FEEDBACK.epsilon ? 0 : next;
}

/** Clears them, for a run starting or a screen the player walked away from. */
export function resetFeedback(state: FeedbackState): void {
  state.flash = 0;
  state.rush = 0;
  state.shove = 0;
}
