import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.threedev.yetirush',
  appName: 'Yeti Rush',
  webDir: 'dist',
  android: {
    backgroundColor: '#5ea3d4',
    // Lets us attach chrome://inspect to the WebView. Turn off for release builds.
    webContentsDebuggingEnabled: true,
  },
  plugins: {
    SplashScreen: {
      // The app hides the splash itself once the first frame has rendered,
      // so the player never sees a blank canvas.
      launchAutoHide: false,
      backgroundColor: '#5ea3d4',
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
