/**
 * Routing.
 *
 * Five routes over one persistent canvas. The root route *is* the app shell, so
 * the `<Canvas>` is mounted by the router's own root component and never
 * unmounts as the location changes - which is the constraint everything here is
 * arranged around. Tearing down a WebGL context per screen is slow on mobile
 * and leaks on some Android WebViews, so screens have to be DOM layers over a
 * live scene, routed or not.
 *
 * ## Hash history, not browser history
 *
 * The bundle is served from two places that cannot both support real paths.
 * GitHub Pages serves the demo from a repository subpath with no rewrite rules,
 * so a reload on `/yeti-rush/shop` is a 404 from Pages before any JavaScript
 * runs. The Android WebView serves from Capacitor's asset server, where the
 * same request has nothing to resolve against either. A hash keeps the whole
 * route on the client side of the request, so `#/shop` reloads correctly in
 * both without a single line of host configuration.
 *
 * ## What the router does not decide
 *
 * The run phase. Whether the player is riding, paused, dead or being offered a
 * revive is simulation state, not a location - a run is not something you can
 * link to, and making it one would mean a back press out of a paused game
 * counted as leaving the app. `App` reads the phase from the store and the
 * screen from here, and `backTarget` in `screens.ts` combines them.
 */

import {
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
  useNavigate,
} from '@tanstack/react-router';
import { App } from '@/app/App';
import { Missions } from '@/app/Missions';
import { Scores } from '@/app/Scores';
import { SCREEN_PATHS } from '@/app/screens';
import { Settings } from '@/app/Settings';
import { Shop } from '@/app/Shop';

/**
 * Closing any screen means going home.
 *
 * A hook rather than a prop threaded down from the shell, so a screen can be
 * mounted by the router without the shell having to know it exists.
 */
function useClose(): () => void {
  const navigate = useNavigate();
  return () => void navigate({ to: SCREEN_PATHS.home });
}

const rootRoute = createRootRoute({ component: App });

/**
 * Home is an empty route.
 *
 * The menu itself is rendered by `App`, because whether it is visible depends
 * on the run phase - it must not appear over a paused run or a results screen.
 * This route exists so `/` resolves to something rather than 404ing.
 */
const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: SCREEN_PATHS.home,
  component: () => null,
});

const shopRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: SCREEN_PATHS.shop,
  component: function ShopRoute() {
    return <Shop onClose={useClose()} />;
  },
});

const missionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: SCREEN_PATHS.missions,
  component: function MissionsRoute() {
    return <Missions onClose={useClose()} />;
  },
});

const scoresRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: SCREEN_PATHS.scores,
  component: function ScoresRoute() {
    return <Scores onClose={useClose()} />;
  },
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: SCREEN_PATHS.settings,
  component: function SettingsRoute() {
    return <Settings onClose={useClose()} />;
  },
});

const routeTree = rootRoute.addChildren([
  homeRoute,
  shopRoute,
  missionsRoute,
  scoresRoute,
  settingsRoute,
]);

export const router = createRouter({
  routeTree,
  history: createHashHistory(),
  // A URL that names no screen is the menu, not an error page. On the web demo
  // these are shareable, so a stale link will be followed by somebody.
  defaultNotFoundComponent: () => null,
  // Nothing here is loaded over a network, so there is no pending state worth
  // showing and no reason to hold a transition open.
  defaultPendingMs: 0,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
