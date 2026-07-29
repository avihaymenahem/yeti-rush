/**
 * App shell, and the router's root route.
 *
 * The Canvas mounts once and stays mounted for the whole session, including
 * behind every screen. Tearing down a WebGL context per screen is slow on
 * mobile and leaks on some Android WebViews, so screens are DOM layers over a
 * live scene rather than separate views - which is exactly why this component
 * is the *root* route rather than something rendered inside one. The location
 * changes underneath it and the scene never notices.
 *
 * Two things decide what the player sees, and they are not the same kind of
 * thing. The run phase - riding, paused, dead, being offered a revive - comes
 * from the simulation store, because a run is not somewhere you can link to.
 * The screen comes from the URL, through `<Outlet />`. See `app/router.tsx`.
 */

import { Canvas } from '@react-three/fiber';
import { Outlet, useNavigate, useRouterState } from '@tanstack/react-router';
import { useCallback, useEffect } from 'react';
import * as THREE from 'three';
import { GameOver } from '@/app/GameOver';
import { Home } from '@/app/Home';
import { Hud } from '@/app/Hud';
import { InputSurface } from '@/app/InputSurface';
import { Paused } from '@/app/Paused';
import { Revive } from '@/app/Revive';
import { backTarget, SCREEN_PATHS, screenForPath, type Screen } from '@/app/screens';
import { ATMOSPHERE, CANVAS_BACKGROUND } from '@/game/config/visuals';
import { TUNING } from '@/game/config/tuning';
import { allowsDoubleJump } from '@/game/content/powerUps';
import { Scene } from '@/game/render/Scene';
import { useGameStore } from '@/game/state/gameStore';
import { useMetaStore } from '@/game/state/metaStore';
import { pauseRun, returnToMenu } from '@/game/state/runController';
import { runtime } from '@/game/state/runtime';
import type { Gesture } from '@/game/systems/input';
import { requestLaneChange } from '@/game/systems/lanes';
import { requestSlide, tap } from '@/game/systems/player';
import {
  setMusicVolume,
  setSfxVolume,
  sfxJump,
  sfxLaneChange,
  sfxSlide,
  sfxTrick,
  unlockAudio,
} from '@/platform/audio';
import { hapticLight, hapticMedium, setHapticsEnabled } from '@/platform/haptics';
import { exitApp, onBackButton } from '@/platform/appState';
import { setMusicEnabled, startMusic } from '@/platform/music';
import { BOOT_STEPS, setBootProgress } from '@/platform/shell';

export function App() {
  const phase = useGameStore((state) => state.phase);
  const loadMeta = useMetaStore((state) => state.load);
  const settings = useMetaStore((state) => state.save.settings);

  // The open screen, read from the location rather than held beside it. A
  // `useState` copy would be a second source of truth for the same fact, and
  // the back button reads it - so the two drifting apart is a back press that
  // does the wrong thing.
  const screen = useRouterState({
    select: (state) => screenForPath(state.location.pathname),
  });
  const routerNavigate = useNavigate();

  // Reading the save is genuine external I/O, and it happens exactly once.
  useEffect(() => {
    void loadMeta().then(() => setBootProgress(BOOT_STEPS.save));
  }, [loadMeta]);

  // Push the loaded preferences into the modules that own the hardware. A real
  // external-system sync, which is what an effect is for.
  useEffect(() => {
    setSfxVolume(settings.sfxVolume);
    setHapticsEnabled(settings.hapticsEnabled);
    setMusicVolume(settings.musicVolume);
    // Zero is off, and off means stopping the scheduler rather than leaving it
    // queueing notes into a silent gain node forty times a second.
    setMusicEnabled(settings.musicVolume > 0);
  }, [settings.sfxVolume, settings.hapticsEnabled, settings.musicVolume]);

  // Bring audio online from a touch anywhere, in the capture phase so a menu
  // button cannot swallow it.
  //
  // This used to hang off the gameplay input surface, which sits *below* every
  // screen - so tapping Play never unlocked anything and the score did not
  // start until the player's first swipe mid-run. The menus were simply silent.
  // A browser will only resume an AudioContext from inside a user gesture, so
  // this has to be a real listener rather than something the render can do.
  //
  // Deliberately not a one-shot. If the first touch of a session fails to bring
  // the context up - which an Android WebView will do, and which a mid-launch
  // stray event can cause - a `once` listener has spent its only chance and the
  // game stays silent for good. Both calls below are no-ops once they have
  // taken effect, so retrying on every touch costs two boolean checks.
  useEffect(() => {
    const handleTouch = () => {
      unlockAudio();
      if (useMetaStore.getState().save.settings.musicVolume > 0) startMusic();
    };
    window.addEventListener('pointerdown', handleTouch, { capture: true });
    return () => window.removeEventListener('pointerdown', handleTouch, { capture: true });
  }, []);

  const handleGesture = useCallback((gesture: Gesture) => {
    // Touches are handled by the window-level unlock above; this covers the
    // keyboard, which never produces a pointer event and would otherwise leave
    // a desktop player who only uses the arrow keys in silence.
    unlockAudio();
    if (useMetaStore.getState().save.settings.musicVolume > 0) startMusic();

    // Input is ignored outside a live run; the screens have their own buttons.
    if (!runtime.running || !runtime.alive) return;

    switch (gesture) {
      case 'left':
        if (requestLaneChange(runtime.lane, -1)) {
          hapticLight();
          sfxLaneChange();
        }
        break;
      case 'right':
        if (requestLaneChange(runtime.lane, 1)) {
          hapticLight();
          sfxLaneChange();
        }
        break;
      case 'up':
      case 'tap': {
        // What a tap means is decided in one place - see `tap` in systems/player.
        const result = tap(runtime.player, allowsDoubleJump(runtime.powerUps));
        if (result === 'none') break;
        hapticLight();
        if (result === 'trick') sfxTrick(runtime.player.trickChain);
        else sfxJump();
        break;
      }
      case 'down':
        if (requestSlide(runtime.player)) {
          hapticMedium();
          sfxSlide();
        }
        break;
      case 'none':
        break;
    }
  }, []);

  // The Android hardware back button. A real external subscription, which is
  // what an effect is for - and it reads the live phase off the store rather
  // than closing over it, so the handler never needs re-attaching.
  const navigate = useCallback(
    (next: Screen) => void routerNavigate({ to: SCREEN_PATHS[next] }),
    [routerNavigate],
  );
  const goHome = useCallback(() => navigate('home'), [navigate]);

  useEffect(
    () =>
      onBackButton(() => {
        const current = useGameStore.getState().phase;
        switch (backTarget(current, screen)) {
          case 'pause-run':
            pauseRun();
            break;
          case 'resume-menu':
            returnToMenu();
            goHome();
            break;
          case 'close-screen':
            goHome();
            break;
          case 'exit-app':
            void exitApp();
            break;
        }
      }),
    [screen, goHome],
  );

  const riding = phase === 'running';
  const paused = phase === 'paused';
  const finished = phase === 'gameover';
  const offeringRevive = phase === 'revive';
  // Home is the resting state: shown whenever the player is neither riding nor
  // looking at a result, and no other screen has been opened.
  const atHome = !riding && !paused && !finished && !offeringRevive && screen === 'home';

  return (
    <>
      <Canvas
        // Cap device pixel ratio: a 3x phone screen renders 9x the pixels for
        // no visible gain on flat-shaded low-poly art.
        dpr={[1, 2]}
        // Variance shadow maps, which is what makes the edges genuinely soft.
        // Every flavour of PCF - `PCFSoftShadowMap` very much included - samples
        // a fixed few neighbouring texels, so a thin caster like a fence rail
        // produces a two-texel shadow that stays a two-texel staircase whatever
        // the map resolution. VSM stores depth statistically and can be blurred
        // properly, so the penumbra is smooth rather than dithered.
        shadows={{ type: THREE.VSMShadowMap }}
        // Tone mapping set here so the renderer is constructed with it, rather
        // than mutated afterwards. Without a tone curve the lit snow clips to
        // pure white and every highlight reads as the same flat value.
        gl={{
          // Multisampling, for the geometry edges the shadow work cannot touch.
          // Nearly free on the tile-based GPUs phones use, where it resolves
          // inside tile memory rather than costing a full-resolution buffer.
          antialias: true,
          powerPreference: 'high-performance',
          alpha: false,
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: ATMOSPHERE.exposure,
          outputColorSpace: THREE.SRGBColorSpace,
        }}
        // The far plane has to clear the sky dome and the furthest mountain
        // range, or both are clipped away and the scene renders against the
        // clear colour. Near is pulled out to 0.5 to claw back the depth
        // precision that costs - nothing is ever closer than the player, and
        // the player is at least seven units from the camera.
        camera={{
          position: [0, TUNING.camera.height, TUNING.camera.minDistance],
          fov: TUNING.camera.fov,
          near: 0.5,
          far: 900,
        }}
        style={{ background: CANVAS_BACKGROUND }}
      >
        <Scene />
      </Canvas>

      {/* Grade and vignette, composited rather than rendered. */}
      <div className="grade" aria-hidden="true" />

      {/* Impact flash. Rendered once and never re-rendered - its opacity is
          driven from the frame loop through `platform/screenFlash`, because a
          value that changes every frame must not go through React. */}
      <div className="flash" id="flash" aria-hidden="true" />

      <InputSurface onGesture={handleGesture} />

      {riding && <Hud />}
      {paused && <Paused onHome={goHome} />}
      {offeringRevive && <Revive />}
      {atHome && <Home onNavigate={navigate} />}
      {finished && screen === 'home' && <GameOver onNavigate={navigate} onHome={goHome} />}

      {/* Shop, Missions, Scores and Settings, whichever the URL names. */}
      <Outlet />
    </>
  );
}
