import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.threedev.yetirush',
  appName: 'Yeti Rush',
  webDir: 'dist',
  android: {
    backgroundColor: '#5ea3d4',
    /*
     * `webContentsDebuggingEnabled` is deliberately absent.
     *
     * It used to be set to `true` so chrome://inspect could attach, with a
     * comment saying to turn it off before release - which is a reminder, not a
     * mechanism, and it shipped in all eight releases. A release build with an
     * inspectable WebView hands anyone with the phone a console inside the app.
     *
     * Omitting the key is better than setting it false: Capacitor defaults it
     * to whether the app is debuggable (`CapConfig.java`, the `isDebug`
     * fallback), so debug builds stay inspectable and release builds do not,
     * with nothing to remember either way.
     */
  },
  plugins: {
    SplashScreen: {
      // The app hides the splash itself once the first frame has rendered,
      // so the player never sees a blank canvas.
      launchAutoHide: false,
      // Cross-fades the system splash into the boot poster the WebView is
      // already showing underneath it. Both are the same night blue, so what
      // the player sees is the launcher icon dissolving into the poster.
      launchFadeOutDuration: 220,
      // Night sky at the top of the poster, not the daylight blue the WebView
      // sits on. Kept in step with SPLASH_BACKGROUND in game/config/visuals.ts.
      backgroundColor: '#051844',
      // Only reached on the legacy path. The plugin routes every Android
      // version through `installSplashScreen` first, which draws the system
      // splash and ignores the drawable entirely - which is why the poster is
      // shown by the WebView instead. See `handOverToPoster` in platform/shell.
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
    },
    StatusBar: {
      overlaysWebView: true,
      // Light icons: the status bar overlays the top of the sky dome, which is
      // now deep blue rather than the pale wash it used to be.
      style: 'DARK',
      backgroundColor: '#00000000',
    },
  },
};

export default config;
