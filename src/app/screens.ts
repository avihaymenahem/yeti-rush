/**
 * The screens the shell can show outside a run.
 *
 * Kept in its own module so `App` can route on it without every screen
 * importing the shell, and so adding a screen is one entry here plus one case
 * in the shell.
 */

export type Screen = 'home' | 'shop' | 'missions' | 'scores' | 'settings';

/** What the Android back button should do from where the player is now. */
export type BackAction = 'close-screen' | 'pause-run' | 'resume-menu' | 'exit-app';

/**
 * Resolves the back button against the current state.
 *
 * A pure function rather than a router, because that is the whole of what a
 * router would have given us here. These screens are modal layers over one
 * persistent canvas - there is nothing to address and nothing to deep-link to -
 * so a history stack would only be a second copy of `screen` to keep in step
 * with the first. What is genuinely worth getting right is the *decision*, and
 * a decision is testable without a dependency.
 *
 * Only the home screen with no run in progress falls through to leaving the
 * app, which is the one place an Android player expects back to mean quit.
 */
export function backTarget(phase: string, screen: Screen): BackAction {
  // Mid-run, back is the pause button - never an exit. Dumping a player out of
  // a personal best because their thumb found the gesture bar is unforgivable.
  if (phase === 'running') return 'pause-run';
  // Paused or looking at a result: back returns to the menu rather than the run.
  if (phase === 'paused' || phase === 'gameover') return 'resume-menu';
  // The revive offer is a decision with a clock on it, and back is not an
  // answer to it - it declines, which is what `resume-menu` does from there.
  if (phase === 'revive') return 'resume-menu';
  if (screen !== 'home') return 'close-screen';
  return 'exit-app';
}
