/**
 * The single driver of the simulation.
 *
 * This is the only component allowed to advance game state. It renders nothing
 * and never sets React state per frame - it ticks the fixed-timestep sim, fires
 * presentation events off the deltas, and pushes a throttled snapshot into the
 * store for the HUD.
 *
 * Sound and haptics are triggered here by diffing the runtime between frames,
 * rather than from inside the simulation. That keeps the sim pure and
 * deterministic - it can be run headless in a test with no audio device - and
 * keeps every presentation concern in the render layer where it belongs.
 */

import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import { TUNING } from '@/game/config/tuning';
import { POWER_UP_IDS, powerUpDef, type PowerUpTimers } from '@/game/content/powerUps';
import { gameTimestep } from '@/game/core/gameTimestep';
import { clamp01 } from '@/game/core/math';
import { chaserPressure } from '@/game/systems/chaser';
import { setMusicIntensity } from '@/platform/music';
import {
  HUD_PUBLISH_INTERVAL,
  useGameStore,
  type ActivePowerUpView,
} from '@/game/state/gameStore';
import { endRun } from '@/game/state/runController';
import { runtime } from '@/game/state/runtime';
import { tickRun } from '@/game/systems/simulation';
import { sfxCoin, sfxCrash, sfxPowerDown, sfxPowerUp, sfxRamp, sfxSmash } from '@/platform/audio';
import { hapticHeavy, hapticMedium } from '@/platform/haptics';

/**
 * Builds the HUD's view of active power-ups. Allocates, but only ten times a
 * second and only while something is active - not per frame.
 */
function activePowerUpViews(timers: PowerUpTimers): ActivePowerUpView[] {
  const views: ActivePowerUpView[] = [];
  for (const id of POWER_UP_IDS) {
    if (timers[id] <= 0) continue;
    views.push({ id, remaining: timers[id], duration: powerUpDef(id).duration });
  }
  return views;
}

export function GameLoop() {
  const hudTimerRef = useRef(0);
  const wasAliveRef = useRef(true);
  const lastCoinsRef = useRef(0);
  const lastSmashedRef = useRef(0);
  const lastRampsRef = useRef(0);

  useFrame((_, delta) => {
    gameTimestep.advance(delta, (step) => tickRun(runtime, step));

    // Feed the score. Cheap enough to do every frame, and doing it here means
    // the music follows the simulation rather than the render.
    setMusicIntensity({
      energy: clamp01(
        (runtime.speed - TUNING.speed.start) / (TUNING.speed.max - TUNING.speed.start),
      ),
      tension: runtime.running ? chaserPressure(runtime.chaser) : 0,
      running: runtime.running && runtime.alive,
    });

    // Death is detected here rather than inside the tick so the store is only
    // ever written between ticks, never part-way through a simulation step.
    if (wasAliveRef.current && !runtime.alive) {
      wasAliveRef.current = false;
      sfxCrash();
      hapticHeavy();
      endRun();
      return;
    }
    if (!wasAliveRef.current && runtime.alive) {
      wasAliveRef.current = true;
      lastCoinsRef.current = 0;
      lastSmashedRef.current = 0;
      lastRampsRef.current = 0;
    }

    if (runtime.coins !== lastCoinsRef.current) {
      // One blip per frame however many coins landed in it, so a magnet sweep
      // does not turn into a wall of sound.
      if (runtime.coins > lastCoinsRef.current) sfxCoin(runtime.combo);
      lastCoinsRef.current = runtime.coins;
    }

    if (runtime.smashed > lastSmashedRef.current) {
      lastSmashedRef.current = runtime.smashed;
      sfxSmash();
    }

    if (runtime.rampLaunches > lastRampsRef.current) {
      lastRampsRef.current = runtime.rampLaunches;
      sfxRamp();
      hapticMedium();
    }

    if (runtime.collectedPowerUp) {
      runtime.collectedPowerUp = null;
      sfxPowerUp();
      hapticMedium();
    }

    if (runtime.expiredPowerUps.length > 0) {
      runtime.expiredPowerUps.length = 0;
      sfxPowerDown();
    }

    hudTimerRef.current += delta;
    if (hudTimerRef.current >= HUD_PUBLISH_INTERVAL) {
      hudTimerRef.current = 0;
      useGameStore.getState().publish({
        score: runtime.score,
        coins: runtime.coins,
        distance: runtime.distance,
        multiplier: runtime.multiplier,
        speed: runtime.speed,
        timeRemaining: runtime.timeRemaining,
        powerUps: activePowerUpViews(runtime.powerUps),
      });
    }
  });

  return null;
}
