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

/**
 * How far along launch each milestone is, for the bar in index.html.
 *
 * Guesses, and openly so - the two slowest things at launch are fetching a
 * bundle and building a WebGL scene, and neither reports progress that can be
 * read. What is real is the *order*: each of these fires from a place that
 * genuinely cannot run until the one before it has happened, so the bar never
 * claims progress that has not been made even though it cannot say how much.
 */
export const BOOT_STEPS = {
  /** The poster has decoded. Raised from index.html, before any of this runs. */
  poster: 0.3,
  /** The bundle parsed and executed. */
  bundle: 0.5,
  /** The save has been read off disk. */
  save: 0.68,
  /** The renderer exists and the scene graph is mounting. */
  scene: 0.85,
  /** A frame is on screen. The only one that is not a guess. */
  ready: 1,
} as const;

/**
 * Moves the launch bar forward.
 *
 * A no-op if the inline script is not there, which is the case in tests and in
 * any host that renders the app into its own page.
 */
export function setBootProgress(value: number): void {
  (window as { __yetiBoot?: (value: number) => void }).__yetiBoot?.(value);
}

/**
 * Hands the launch over from the native splash to the boot poster.
 *
 * The reason this exists at all: the Capacitor plugin routes *every* Android
 * version through `installSplashScreen`, so the launch screen is always the
 * system one - the launcher icon on a flat colour - and `@drawable/splash` is
 * never drawn. The poster only ever appears if the WebView shows it.
 *
 * So the native splash is dropped as soon as the poster underneath it has
 * decoded, rather than held until the first rendered frame. The handover is
 * invisible because both are the same night blue, and what the player waits on
 * afterwards is the poster with a progress bar rather than an app icon.
 *
 * Waits for the image rather than firing immediately, because hiding the native
 * splash before the poster has pixels would show the bare WebView.
 */
export async function handOverToPoster(): Promise<void> {
  if (!isNative()) return;

  const poster = document.getElementById('boot-poster') as HTMLImageElement | null;
  if (poster && !poster.complete) {
    await new Promise<void>((resolve) => {
      const done = () => resolve();
      poster.addEventListener('load', done, { once: true });
      // A decode failure must not strand the player on the system splash.
      poster.addEventListener('error', done, { once: true });
      window.setTimeout(done, 2500);
    });
  }

  await hideSplash();
}
