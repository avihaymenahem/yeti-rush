/**
 * Impact feedback: how hard the screen reacts to something happening.
 *
 * One scalar that events raise and time lowers. Every consumer reads it and
 * decides for itself what it means, so adding a new reaction (a lens streak, a
 * controller rumble) needs no change here.
 *
 * It was two, the other being camera shake, and that is gone for good - see
 * `FEEDBACK` in `visuals.ts`. Shake is the obvious thing to reach for when a
 * moment needs weight, and it is the wrong one on a handheld screen.
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
}

export function createFeedbackState(): FeedbackState {
  return { flash: 0 };
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

/**
 * Decays the impulse towards zero.
 *
 * Half-life rather than a linear ramp, so a hard punch and a light one feel
 * like the same kind of event at different sizes, and so the decay is
 * independent of the frame rate.
 *
 * Snapped to exactly zero below a floor. Exponential decay never actually
 * arrives, and a flash of 1e-8 still costs a style write every frame for the
 * rest of the session.
 */
export function decayFeedback(state: FeedbackState, dt: number): void {
  state.flash = decay(state.flash, FEEDBACK.flashHalfLife, dt);
}

function decay(value: number, halfLife: number, dt: number): number {
  if (value <= 0) return 0;
  const next = value * Math.pow(0.5, dt / halfLife);
  return next < FEEDBACK.epsilon ? 0 : next;
}

/** Clears it, for a run starting or a screen the player walked away from. */
export function resetFeedback(state: FeedbackState): void {
  state.flash = 0;
}
