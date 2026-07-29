/**
 * The routing table.
 *
 * Two directions have to agree and are written in different places: the router
 * decides what is *shown* from the path, and the Android back button decides
 * what to *do* from the screen. When those were two hand-maintained lists of
 * the same five strings, a renamed route was a back button that quietly stopped
 * closing one screen.
 *
 * So the table is one object and both directions are derived from it, and what
 * is tested here is that the derivation actually round-trips - plus the two
 * cases a player can reach that no route describes: an unknown path, and a path
 * carrying a base prefix.
 */

import { describe, expect, it } from 'vitest';
import { backTarget, SCREEN_PATHS, screenForPath, type Screen } from '@/app/screens';

const SCREENS = Object.keys(SCREEN_PATHS) as Screen[];

describe('screens and their paths', () => {
  it('gives every screen a path of its own', () => {
    const paths = SCREENS.map((screen) => SCREEN_PATHS[screen]);
    expect(new Set(paths).size).toBe(paths.length);
    for (const path of paths) expect(path.startsWith('/')).toBe(true);
  });

  it('round-trips every screen through its path', () => {
    // The one that catches a rename. Both directions read the same table, so
    // this can only fail if the normalising in `screenForPath` stops agreeing
    // with the shape of the paths.
    for (const screen of SCREENS) {
      expect(screenForPath(SCREEN_PATHS[screen])).toBe(screen);
    }
  });

  it('keeps home at the root', () => {
    // Load the app at its bare URL and you get the menu. Anything else here
    // means the first thing a new player sees is a sub-screen.
    expect(SCREEN_PATHS.home).toBe('/');
    expect(screenForPath('/')).toBe('home');
    expect(screenForPath('')).toBe('home');
  });
});

describe('paths nobody meant to write', () => {
  it('falls back to the menu rather than showing nothing', () => {
    /*
     * On the web demo the URL is shareable, so a stale or mistyped one will be
     * followed eventually. The failure mode being avoided is not a 404 page -
     * it is a blank layer over a live canvas with no way out of it.
     */
    for (const path of ['/nope', '/shop/extra', '/SHOP', '/settings2']) {
      expect(screenForPath(path)).toBe('home');
    }
  });

  it('reads a screen out from under a base path', () => {
    // Only the last segment is ours. The demo is served from a repository
    // subpath, so anything that ever puts the route in the real pathname
    // arrives with `/yeti-rush` in front of it.
    expect(screenForPath('/yeti-rush/shop')).toBe('shop');
    expect(screenForPath('/yeti-rush/')).toBe('home');
  });

  it('ignores a trailing slash', () => {
    expect(screenForPath('/shop/')).toBe('shop');
  });
});

describe('what the back button does with a route', () => {
  it('closes any screen that is not home', () => {
    // The join between the two halves. `backButton.test.ts` covers the decision
    // in full; this covers it being fed from the location.
    for (const screen of SCREENS.filter((s) => s !== 'home')) {
      expect(backTarget('menu', screenForPath(SCREEN_PATHS[screen]))).toBe('close-screen');
    }
  });

  it('still leaves the app from the root, and only from there', () => {
    expect(backTarget('menu', screenForPath('/'))).toBe('exit-app');
    // A URL naming nothing resolves to home, so back leaves from there too -
    // which is right, because home is what the player is looking at.
    expect(backTarget('menu', screenForPath('/nonsense'))).toBe('exit-app');
  });

  it('never exits mid-run, whatever the URL says', () => {
    // The reason routing did not simply take over the back button. A run is not
    // a history entry, so handing back to history would quit the app from a
    // paused game.
    for (const screen of SCREENS) {
      expect(backTarget('running', screen)).toBe('pause-run');
      expect(backTarget('paused', screen)).toBe('resume-menu');
    }
  });
});
