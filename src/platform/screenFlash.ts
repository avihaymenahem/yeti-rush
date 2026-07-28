/**
 * The full-screen impact flash.
 *
 * A DOM overlay driven imperatively, for the same reason the grade is one: the
 * compositor can fade a solid layer without the 3D pipeline knowing anything
 * about it, whereas a fullscreen pass costs a full-resolution draw plus a render
 * target on a GPU that has neither to spare.
 *
 * Not React state. This changes every frame while it is fading, and re-rendering
 * the tree to move an opacity is precisely the thing the whole architecture is
 * arranged to avoid.
 */

let element: HTMLElement | null = null;
/** Last value written, so an unchanged frame costs nothing. */
let applied = -1;

function target(): HTMLElement | null {
  // Re-looked-up while missing rather than cached once: the first call happens
  // on the first rendered frame, which can beat React committing the overlay.
  if (!element || !element.isConnected) element = document.getElementById('flash');
  return element;
}

/**
 * Sets the flash opacity, if it has visibly changed.
 *
 * Quantised to a hundredth. The impulse decays exponentially and would
 * otherwise write a new opacity every frame for ever, each one triggering a
 * style recalculation for a difference no display can show.
 */
export function applyScreenFlash(value: number): void {
  const quantised = Math.round(Math.max(0, value) * 100) / 100;
  if (quantised === applied) return;
  applied = quantised;

  const node = target();
  if (node) node.style.opacity = String(quantised);
}
