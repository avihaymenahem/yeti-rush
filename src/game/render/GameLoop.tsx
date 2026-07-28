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
import { FEEDBACK } from '@/game/config/visuals';
import { POWER_UP_IDS, powerUpDef, type PowerUpTimers } from '@/game/content/powerUps';
import { gameTimestep } from '@/game/core/gameTimestep';
import { clamp01 } from '@/game/core/math';
import { chaserPressure } from '@/game/systems/chaser';
import { decayFeedback, feedback, punch, resetFeedback } from '@/game/systems/feedback';
import { isGrounded } from '@/game/systems/player';
import { applyScreenFlash } from '@/platform/screenFlash';
import { setMusicIntensity } from '@/platform/music';
import {
  HUD_PUBLISH_INTERVAL,
  useGameStore,
  type ActivePowerUpView,
} from '@/game/state/gameStore';
import { finishOrOfferRevive } from '@/game/state/runController';
import { runtime } from '@/game/state/runtime';
import { tickRun } from '@/game/systems/simulation';
import {
  sfxCoin,
  sfxCrash,
  sfxLand,
  sfxNearMiss,
  sfxPhase,
  sfxPowerDown,
  sfxPowerUp,
  sfxRamp,
} from '@/platform/audio';
import { hapticHeavy, hapticLight, hapticMedium } from '@/platform/haptics';

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
  const lastPhasedRef = useRef(0);
  const lastRampsRef = useRef(0);
  const lastNearMissesRef = useRef(0);
  // Starts grounded, because the run does. Seeded the other way, the first
  // frame of every run would land.
  const wasGroundedRef = useRef(true);

  useFrame((_, delta) => {
    gameTimestep.advance(delta, (step) => tickRun(runtime, step));

    // Decayed on the real frame delta rather than the fixed step: this is how
    // long the player actually looked at the last frame, and the impulse is a
    // presentation value that never feeds back into the simulation.
    decayFeedback(feedback, delta);

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
      // The loudest thing this game does, and the only flash in it.
      punch(feedback, FEEDBACK.crashFlash);
      applyScreenFlash(feedback.flash);
      // Not `endRun` directly: the run is only banked once the second
      // chance has been declined or has timed out.
      finishOrOfferRevive();
      return;
    }
    if (!wasAliveRef.current && runtime.alive) {
      wasAliveRef.current = true;
      lastCoinsRef.current = 0;
      lastPhasedRef.current = 0;
      lastRampsRef.current = 0;
      lastNearMissesRef.current = 0;
      wasGroundedRef.current = true;
      // A fresh run must not open with the last crash still fading over it.
      resetFeedback(feedback);
    }

    if (runtime.nearMisses > lastNearMissesRef.current) {
      lastNearMissesRef.current = runtime.nearMisses;
      sfxNearMiss();
    }

    // Touchdown, from a jump, a ramp arc or stepping off a rail. Diffed here
    // rather than signalled by the simulation because nothing about it changes
    // the run - it is purely how the landing is presented.
    const grounded = isGrounded(runtime.player);
    if (grounded && !wasGroundedRef.current && runtime.running) {
      sfxLand();
      hapticLight();
    }
    wasGroundedRef.current = grounded;

    if (runtime.coins !== lastCoinsRef.current) {
      // One blip per frame however many coins landed in it, so a magnet sweep
      // does not turn into a wall of sound.
      if (runtime.coins > lastCoinsRef.current) sfxCoin(runtime.combo);
      lastCoinsRef.current = runtime.coins;
    }

    if (runtime.phased > lastPhasedRef.current) {
      lastPhasedRef.current = runtime.phased;
      sfxPhase();
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

    applyScreenFlash(feedback.flash);

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
        avalanche: runtime.avalancheTimer,
        powerUps: activePowerUpViews(runtime.powerUps),
      });
    }
  });

  return null;
}
