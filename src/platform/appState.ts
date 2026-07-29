/**
 * App lifecycle: foreground, background, and the hardware back button.
 *
 * When the app is backgrounded we stop the render loop entirely rather than
 * let it tick in the background: it saves battery, and it guarantees the
 * simulation does not try to catch up on a minute of missed time when the
 * player comes back.
 */

import { App } from '@capacitor/app';

export type AppStateListener = (isActive: boolean) => void;

/**
 * Subscribes to both the native lifecycle and the web visibility API - a
 * Capacitor WebView reports one, a browser tab the other.
 *
 * @returns an unsubscribe function.
 */
export function onAppStateChange(listener: AppStateListener): () => void {
  const handleVisibility = () => listener(document.visibilityState === 'visible');
  document.addEventListener('visibilitychange', handleVisibility);

  const nativeHandle = App.addListener('appStateChange', ({ isActive }) => listener(isActive));

  return () => {
    document.removeEventListener('visibilitychange', handleVisibility);
    void nativeHandle.then((handle) => handle.remove()).catch(() => {});
  };
}

/**
 * Subscribes to the Android hardware back button.
 *
 * Without this, back closes the app from anywhere - mid-run, mid-shop, mid
 * anything. On Android that is the primary navigation control and an app that
 * treats it as "quit" feels broken rather than minimal.
 *
 * A listener rather than a router. The screens here are modal layers over one
 * persistent canvas, not documents: there is nothing to address, nothing to
 * link to, and a history stack would have to be kept in step with a `screen`
 * state that is already the single source of truth. What back *means* is a pure
 * function of the current phase and screen - see `backTarget` in `app/screens`
 * - which is the part worth having and the part worth testing.
 *
 * @returns an unsubscribe function.
 */
export function onBackButton(listener: () => void): () => void {
  const handle = App.addListener('backButton', () => listener());
  return () => void handle.then((h) => h.remove()).catch(() => {});
}

/** Leaves the app. A no-op on web, where there is no app to leave. */
export async function exitApp(): Promise<void> {
  try {
    await App.exitApp();
  } catch {
    // A browser, or a WebView that will not allow it. Staying put is correct.
  }
}
