/**
 * Connects the render loop to the device lifecycle.
 *
 * Two jobs, both of which must happen from inside the Canvas because they need
 * the R3F frame state:
 *  1. Hide the launch splash on the first rendered frame, so the player never
 *     sees a blank canvas between the splash and the scene.
 *  2. Stop the render loop entirely when the app is backgrounded, and reset the
 *     fixed timestep on resume so the simulation does not lurch forward by
 *     however long the phone was in a pocket.
 */

import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import { gameTimestep } from '@/game/core/gameTimestep';
import { flushMetaSave, useMetaStore } from '@/game/state/metaStore';
import { onAppStateChange } from '@/platform/appState';
import { startMusic, stopMusic } from '@/platform/music';
import {
  BOOT_STEPS,
  hideBootSplash,
  hideSplash,
  initNativeShell,
  setBootProgress,
} from '@/platform/shell';

export function PlatformBridge() {
  const setFrameloop = useThree((state) => state.setFrameloop);
  const splashHiddenRef = useRef(false);

  useEffect(() => {
    void initNativeShell();
    // The renderer exists by the time this mounts, which is the last milestone
    // before models finish loading and a frame can be drawn.
    setBootProgress(BOOT_STEPS.scene);
  }, []);

  useEffect(
    () =>
      onAppStateChange((isActive) => {
        if (isActive) {
          // Drop the accumulated backlog before resuming, or the first frame
          // back would try to catch up on the whole time we were away.
          gameTimestep.reset();
          setFrameloop('always');
          if (useMetaStore.getState().save.settings.musicVolume > 0) startMusic();
        } else {
          setFrameloop('never');
          // Otherwise the scheduler keeps queueing notes in the player's pocket.
          stopMusic();
          // Backgrounding is the last moment we are guaranteed to run: Android
          // can kill the process without warning, and a debounced save still
          // sitting in a timer would be lost with it.
          flushMetaSave();
        }
      }),
    [setFrameloop],
  );

  useFrame(() => {
    if (splashHiddenRef.current) return;
    splashHiddenRef.current = true;
    // Belt and braces: `handOverToPoster` has almost certainly already done
    // this, but a native splash still up at the first frame would now be
    // covering a running game.
    void hideSplash();
    setBootProgress(BOOT_STEPS.ready);
    hideBootSplash();
  });

  return null;
}
