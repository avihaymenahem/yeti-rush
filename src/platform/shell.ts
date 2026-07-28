/**
 * Native shell configuration: status bar and splash screen.
 *
 * Every call is a no-op on web and swallows its errors - a WebView that does
 * not implement one of these must not take the game down with it.
 */

import { Capacitor } from '@capacitor/core';
import { SplashScreen } from '@capacitor/splash-screen';
import { StatusBar, Style } from '@capacitor/status-bar';

export function isNative(): boolean {
  return Capacitor.isNativePlatform();
}

/**
 * Puts the WebView behind the status bar so the scene runs edge to edge.
 * The HUD keeps clear of it via `env(safe-area-inset-*)` in index.css.
 */
export async function initNativeShell(): Promise<void> {
  if (!isNative()) return;
  try {
    await StatusBar.setOverlaysWebView({ overlay: true });
    // Dark style = light icons. The status bar sits over the top of the sky
    // dome, which is deep blue.
    await StatusBar.setStyle({ style: Style.Dark });
  } catch (error) {
    console.warn('[shell] status bar setup failed', error);
  }
}

/**
 * Hides the launch splash. Called after the first rendered frame, not on
 * mount - `launchAutoHide` is off precisely so the player never sees the gap
 * between the WebView loading and the scene appearing.
 */
export async function hideSplash(): Promise<void> {
  if (!isNative()) return;
  try {
    await SplashScreen.hide({ fadeOutDuration: 250 });
  } catch (error) {
    console.warn('[shell] splash hide failed', error);
  }
}

/**
 * Dismisses the boot poster in index.html - the browser's equivalent of the
 * native splash, and on the phone the layer underneath it.
 *
 * Removed rather than left transparent. It is a full-screen element above the
 * canvas, and a compositor that has to keep blending it costs frames for the
 * rest of the session.
 */
export function hideBootSplash(): void {
  const boot = document.getElementById('boot');
  if (!boot) return;
  boot.classList.add('boot--gone');
  window.setTimeout(() => boot.remove(), 400);
}
