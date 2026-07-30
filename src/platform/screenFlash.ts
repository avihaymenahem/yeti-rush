/**
 * The two composited overlays the frame loop drives directly.
 *
 * DOM layers written imperatively, for the same reason the grade is one: the
 * compositor can fade a solid layer without the 3D pipeline knowing anything
 * about it, whereas a fullscreen pass costs a full-resolution draw plus a render
 * target on a GPU that has neither to spare.
 *
 * Not React state. These change every frame while they are fading, and
 * re-rendering the tree to move an opacity is precisely the thing the whole
 * architecture is arranged to avoid.
 *
 * Two of them, because they are two different pictures:
 *
 * - **flash** is a cool-white radial styled as snow thrown at the lens. It is
 *   pictorial, it ends the run, and it happens once.
 * - **rush** is a narrow dark gradient down the left and right edges. It is
 *   *continuous* - the run's own speed keeps a floor under it - and the
 *   transient impulses punch above that floor. Deliberately dark: white wedges
 *   on a snow palette are the least legible overlay it is possible to draw, and
 *   the frame's problem is that it has no dark values, not that it has no
 *   light ones.
 */

import { FEEDBACK } from '@/game/config/visuals';
import { clamp01 } from '@/game/core/math';

/** One entry per driven overlay: the node once found, and the last value written. */
const overlays = {
  flash: { node: null as HTMLElement | null, applied: -1 },
  rush: { node: null as HTMLElement | null, applied: -1 },
};

type OverlayId = keyof typeof overlays;

/**
 * Writes an overlay's opacity, if it has visibly changed.
 *
 * Quantised to a hundredth. Both channels settle exponentially and would
 * otherwise write a new opacity every frame for ever, each one triggering a
 * style recalculation for a difference no display can show - and the rush
 * channel is worse than the flash, because a run held at a steady speed would
 * write the *same* value sixty times a second.
 */
function apply(id: OverlayId, value: number): void {
  const overlay = overlays[id];
  const quantised = Math.round(clamp01(value) * 100) / 100;
  if (quantised === overlay.applied) return;

  // Re-looked-up while missing rather than cached once: the first call happens
  // on the first rendered frame, which can beat React committing the overlay.
  if (!overlay.node || !overlay.node.isConnected) overlay.node = document.getElementById(id);
  if (!overlay.node) return;

  overlay.node.style.opacity = String(quantised);
  // Recorded only after the write has actually landed. Marking it applied while
  // the element was still missing would strand a value that never changes again
  // - which the speed floor, unlike the flash, genuinely can do.
  overlay.applied = quantised;
}

/** Sets the impact flash opacity. */
export function applyScreenFlash(value: number): void {
  apply('flash', value);
}

/**
 * Sets the edge-tint opacity.
 *
 * Takes one already-composed number rather than a baseline and an impulse,
 * because the composition rule is the same one `punch` in
 * `game/systems/feedback.ts` uses on the channels feeding it: the **maximum**,
 * never a sum. Two things pressing at
 * once would otherwise black the frame edges out for something neither of them
 * was on its own. Call it as
 * `applyRush(Math.max(speedRush(progress), feedback.rush))`.
 */
export function applyRush(value: number): void {
  apply('rush', value);
}

/**
 * The continuous floor the run's own speed puts under the edge tint.
 *
 * Shaped rather than linear, and capped well under 1 - see `speedRushMax` and
 * `speedRushGamma` in `FEEDBACK`. The input is a speed progress in [0, 1], and
 * it must be one with a floor above zero at the opening speed: the codebase
 * has three incompatible normalisations of that quantity and the oldest of them
 * is exactly zero at `TUNING.speed.start`, which is the speed most players
 * spend most of their time at. A cue that is dead there is a cue that does not
 * exist.
 */
export function speedRush(progress: number): number {
  return FEEDBACK.speedRushMax * Math.pow(clamp01(progress), FEEDBACK.speedRushGamma);
}
