/**
 * The single driver of the simulation.
 *
 * This is the only component allowed to advance game state. It renders nothing
 * and never sets React state per frame - it ticks the fixed-timestep sim, fires
 * presentation events off the deltas, and pushes a throttled snapshot into the
 * store for the HUD.
 *
 * Sound, haptics and the impact channels are triggered here by diffing the
 * runtime between frames, rather than from inside the simulation. That keeps the
 * sim pure and deterministic - it can be run headless in a test with no audio
 * device - and keeps every presentation concern in the render layer where it
 * belongs.
 *
 * Two shapes of reaction live here and they are not the same thing:
 *
 * - **events**, diffed off a counter that only ever goes up, fired once each;
 * - **states**, held open for as long as the simulation says so. The rail grind
 *   is the only one, and it has to be a state: a clink at the start of a 1.5 s
 *   ride tells the player the mechanic has ended.
 *
 * Nothing in this file may allocate per frame. Every accumulator is a ref and
 * every helper it calls is module-level for the same reason.
 */

import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import { TUNING } from '@/game/config/tuning';
import { FEEDBACK } from '@/game/config/visuals';
import { POWER_UP_IDS, powerUpDef, type PowerUpTimers } from '@/game/content/powerUps';
import { gameTimestep } from '@/game/core/gameTimestep';
import { clamp01 } from '@/game/core/math';
import { chaserPressure } from '@/game/systems/chaser';
import { coachHint } from '@/game/systems/coach';
import { speedProgress } from '@/game/systems/difficulty';
import {
  decayFeedback,
  feedback,
  punch,
  punchRush,
  punchShove,
  resetFeedback,
} from '@/game/systems/feedback';
import { isGrinding, isGrounded } from '@/game/systems/player';
import { rampLaunchVelocity } from '@/game/systems/ramp';
import { applyRush, applyScreenFlash, speedRush } from '@/platform/screenFlash';
import { setMusicIntensity } from '@/platform/music';
import { HUD_PUBLISH_INTERVAL, useGameStore, type ActivePowerUpView } from '@/game/state/gameStore';
import { finishOrOfferRevive } from '@/game/state/runController';
import { runtime } from '@/game/state/runtime';
import { tickRun } from '@/game/systems/simulation';
import {
  setRailGrind,
  sfxCoin,
  sfxCrash,
  sfxLand,
  sfxNearMiss,
  sfxPhase,
  sfxPowerDown,
  sfxPowerUp,
  sfxRamp,
  sfxStumble,
  sfxTrickFumbled,
  sfxTrickLanded,
} from '@/platform/audio';
import { hapticBuzz, hapticHeavy, hapticLight, hapticMedium } from '@/platform/haptics';

/**
 * The hardest the player can ever hit the snow, in units per second.
 *
 * A ramp arc is solved from *distance*, so its launch - and therefore its
 * landing - speed scales with the run speed, which makes a ramp taken at the
 * top of the speed ramp the worst landing the game can produce. Everything
 * softer scales against it: an ordinary hop arrives at about half of this and
 * stepping off an 0.8 m rail at about a third, and that spread is the entire
 * reason the landing impulse is worth scaling at all.
 *
 * Normalising against `TUNING.player.jumpVelocity` is the obvious thing and it
 * is wrong: falling runs at 1.35x gravity, so even a plain jump lands *faster*
 * than it left the ground and every landing in the game would clip to full
 * strength.
 */
const HARDEST_LANDING = rampLaunchVelocity(TUNING.speed.max);

/**
 * Minimum seconds between coin haptics.
 *
 * The sound needs no such throttle - it is coalesced to one blip a frame, and a
 * blip is over before the next coin arrives. A haptic is not. Coins sit
 * `TUNING.coins.spacing` (1.4 m) apart, so a plain run collects one every 67 ms
 * at the opening speed and every 39 ms at the top; a motor asked to tick at
 * that rate never actually stops, which costs battery, floods the native
 * bridge, and - the part that matters - stops being felt as anything within one
 * coin line. About eight a second still reads as a rattle running along the
 * line, which is what the cue is for.
 *
 * Here rather than in `FEEDBACK`: it is a property of the vibration motor and
 * of how coins are spawned, not a look, and nothing else in the game can
 * meaningfully share it.
 */
const COIN_HAPTIC_INTERVAL = 0.12;

/**
 * Writes both composited overlays from the live feedback channels.
 *
 * Module-level and closing over nothing: `feedback` and `runtime` are both
 * singletons, and a closure built per frame is exactly the allocation this file
 * is not allowed to make.
 *
 * The rush overlay takes the **maximum** of the continuous speed floor and the
 * transient impulse, never their sum - the same rule `punch` applies to the
 * channels themselves. Two things pressing at once would otherwise black the
 * frame edges out for something neither of them was on its own.
 *
 * The floor is gated on the run actually being under way. `runtime.speed` keeps
 * whatever the run ended at, so without the gate the strips would sit at their
 * darkest over the results card and every menu behind it - a permanent tint
 * being precisely the thing `speedRushMax` exists to avoid.
 */
function applyOverlays(): void {
  applyScreenFlash(feedback.flash);
  const floor = runtime.running ? speedRush(speedProgress(runtime.speed)) : 0;
  applyRush(Math.max(floor, feedback.rush));
}

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
  const lastTricksRef = useRef(0);
  const lastFumblesRef = useRef(0);
  const lastStumblesRef = useRef(0);
  // Seconds until the next coin is allowed to buzz. See COIN_HAPTIC_INTERVAL.
  const coinBuzzRef = useRef(0);
  // Fastest descent seen during the current airtime, for sizing the landing.
  const deepestFallRef = useRef(0);
  // Starts grounded, because the run does. Seeded the other way, the first
  // frame of every run would land.
  const wasGroundedRef = useRef(true);

  useFrame((_, delta) => {
    gameTimestep.advance(delta, (step) => tickRun(runtime, step));

    // Decayed on the real frame delta rather than the fixed step: this is how
    // long the player actually looked at the last frame, and the impulse is a
    // presentation value that never feeds back into the simulation.
    decayFeedback(feedback, delta);
    coinBuzzRef.current = Math.max(0, coinBuzzRef.current - delta);

    // Feed the score. Cheap enough to do every frame, and doing it here means
    // the music follows the simulation rather than the render.
    //
    // `speedProgress` rather than the old `(speed - start) / (max - start)`,
    // which was identically zero at the speed every run opens at. The score
    // spent the first nine seconds of every run with no kit and the first
    // thirty-eight without sixteenths, while the player was already doing
    // 21 u/s - the music idling through the part of the run everybody judges
    // the game on. The groove now arrives with the run and the *continuous*
    // parameters carry the build instead: the arpeggio's filter opens from
    // about 2.4 kHz to 3.5 kHz, the hats fill in, and the figure jumps an
    // octave past 27 u/s. Same quantity the screen is driven from, so the two
    // can no longer disagree about how fast the run feels.
    setMusicIntensity({
      energy: speedProgress(runtime.speed),
      tension: runtime.running ? chaserPressure(runtime.chaser) : 0,
      running: runtime.running && runtime.alive,
    });

    // A state, not an event - and held open every frame rather than switched on
    // at the mount, so that stopping the frame loop stops the sound. See
    // `setRailGrind`. Driven off the motion state rather than `runtime.railGrinds`
    // because the counter only knows about mounts: bailing, jumping off and
    // running out of bar all end a grind and none of them move it.
    setRailGrind(runtime.running && runtime.alive && isGrinding(runtime.player));

    // Death is detected here rather than inside the tick so the store is only
    // ever written between ticks, never part-way through a simulation step.
    if (wasAliveRef.current && !runtime.alive) {
      wasAliveRef.current = false;
      sfxCrash();
      hapticHeavy();
      // The loudest thing this game does, and the only flash in it.
      punch(feedback, FEEDBACK.crashFlash);
      applyOverlays();
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
      lastTricksRef.current = 0;
      lastFumblesRef.current = 0;
      lastStumblesRef.current = 0;
      coinBuzzRef.current = 0;
      deepestFallRef.current = 0;
      wasGroundedRef.current = true;
      // A fresh run must not open with the last crash still fading over it.
      resetFeedback(feedback);
    }

    if (runtime.nearMisses > lastNearMissesRef.current) {
      lastNearMissesRef.current = runtime.nearMisses;
      sfxNearMiss();
      // The smallest of the three rush punches, because it is far and away the
      // most frequent - a dense stretch fires several in a second.
      punchRush(feedback, FEEDBACK.nearMissRush);
    }

    // Clipping something low. The player is slowed to a crawl for most of a
    // second and loses the whole combo, and until this landed the only sign of
    // it was the rider's flail: no sound, no haptic, nothing on screen.
    //
    // Its own channel rather than a smaller crash flash. The flash is
    // pictorial - snow thrown at the lens - so firing it here would make the
    // game's two failure states the same picture at two sizes, which teaches
    // the player that neither means anything.
    if (runtime.stumbles > lastStumblesRef.current) {
      lastStumblesRef.current = runtime.stumbles;
      sfxStumble();
      hapticBuzz();
      punchShove(feedback, FEEDBACK.stumbleShove);
    }

    if (runtime.tricksLanded > lastTricksRef.current) {
      lastTricksRef.current = runtime.tricksLanded;
      sfxTrickLanded();
      hapticMedium();
    }

    if (runtime.trickFumbles > lastFumblesRef.current) {
      lastFumblesRef.current = runtime.trickFumbles;
      sfxTrickFumbled();
    }

    // Touchdown, from a jump, a ramp arc or stepping off a rail. Diffed here
    // rather than signalled by the simulation because nothing about it changes
    // the run - it is purely how the landing is presented.
    const grounded = isGrounded(runtime.player);
    if (grounded && !wasGroundedRef.current && runtime.running) {
      sfxLand();
      hapticLight();
      // Sized by the fall, so a chalet-clearing ramp arc does not land like a
      // hop over a log. `landingRush` is the ceiling, not the value.
      punchRush(feedback, FEEDBACK.landingRush * clamp01(deepestFallRef.current / HARDEST_LANDING));
      deepestFallRef.current = 0;
    }
    wasGroundedRef.current = grounded;
    /*
     * Tracked as a running peak rather than read at the moment of impact,
     * because by the time the loop sees the landing `stepPlayer` has already
     * set `vy` to zero - and because the sim can run several fixed steps inside
     * one rendered frame, so there is no frame that reliably sees the last one.
     * The peak is reached immediately before touchdown either way, and sampling
     * a frame early costs under a metre a second out of fifteen.
     */
    if (!grounded && runtime.player.vy < -deepestFallRef.current) {
      deepestFallRef.current = -runtime.player.vy;
    }

    if (runtime.coins !== lastCoinsRef.current) {
      // One blip per frame however many coins landed in it, so a magnet sweep
      // does not turn into a wall of sound.
      if (runtime.coins > lastCoinsRef.current) {
        sfxCoin(runtime.combo);
        // The haptic needs a second, coarser throttle on top of that - see
        // COIN_HAPTIC_INTERVAL.
        if (coinBuzzRef.current <= 0) {
          coinBuzzRef.current = COIN_HAPTIC_INTERVAL;
          hapticLight();
        }
      }
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
      // The biggest thing that happens without ending the run, so the biggest
      // punch that is not the crash.
      punchRush(feedback, FEEDBACK.launchRush);
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

    applyOverlays();

    hudTimerRef.current += delta;
    if (hudTimerRef.current >= HUD_PUBLISH_INTERVAL) {
      hudTimerRef.current = 0;
      useGameStore.getState().publish({
        score: runtime.score,
        coins: runtime.coins,
        distance: runtime.distance,
        multiplier: runtime.multiplier,
        timeRemaining: runtime.timeRemaining,
        avalanche: runtime.avalancheTimer,
        trickPending: runtime.player.pendingTrickScore,
        trickChain: runtime.player.trickChain,
        // The meter under the score, and the line on the results card. Both are
        // simulated already; neither had ever been published.
        combo: runtime.combo,
        bestCombo: runtime.bestCombo,
        // Only ever computed at publish rate, not per frame - it walks the
        // nearby track, and ten times a second is well inside a reaction.
        coach: coachHint(runtime),
        powerUps: activePowerUpViews(runtime.powerUps),
      });
    }
  });

  return null;
}
