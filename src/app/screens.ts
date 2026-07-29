/**
 * The screens the shell can show outside a run, and the URLs they live at.
 *
 * Kept in its own module so `App` can route on it without every screen
 * importing the shell, and so adding a screen is one entry here plus one route.
 */

export type Screen = 'home' | 'shop' | 'missions' | 'scores' | 'settings';

/**
 * Screen to path, and back.
 *
 * One table rather than a path string typed into each route file, because the
 * two directions have to agree: the router decides what is *shown* from the
 * path, and the Android back button decides what to *do* from the screen. Two
 * hand-maintained lists of the same five strings is a bug with a schedule.
 */
export const SCREEN_PATHS: Readonly<Record<Screen, string>> = {
  home: '/',
  shop: '/shop',
  missions: '/missions',
  scores: '/scores',
  settings: '/settings',
};

/**
 * Which screen a path is showing.
 *
 * Anything unrecognised is home. A player who lands on a stale or mistyped URL
 * gets the menu, not a blank layer over a running game - and on the web demo
 * that URL is shareable, so it will happen.
 */
export function screenForPath(pathname: string): Screen {
  // Trailing slashes and the Pages subpath both arrive here; only the last
  // segment is ours.
  const normalised = `/${pathname.split('/').filter(Boolean).pop() ?? ''}`;
  const match = (Object.keys(SCREEN_PATHS) as Screen[]).find(
    (screen) => SCREEN_PATHS[screen] === normalised,
  );
  return match ?? 'home';
}

/** What the Android back button should do from where the player is now. */
export type BackAction = 'close-screen' | 'pause-run' | 'resume-menu' | 'exit-app';

/**
 * Resolves the back button against the current state.
 *
 * Still a pure function even though there is now a real router underneath, and
 * deliberately so: the decision depends on the *run phase* as much as on the
 * location, and no router knows whether the player is mid-jump. Handing back to
 * history would exit the app from a paused run, because the run is not a
 * history entry. So the router owns the URL and this owns the decision.
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
