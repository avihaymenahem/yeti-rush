/**
 * App foreground/background tracking.
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
