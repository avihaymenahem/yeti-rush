/**
 * The React-facing slice of game state.
 *
 * The simulation writes to `@/game/state/runtime` every tick; this store is
 * published to at ~10 Hz with a snapshot the HUD can render. Keeping the two
 * separate is what stops React from re-rendering 60 times a second.
 */

import { create } from 'zustand';
import { DEFAULT_MODE, type GameModeId } from '@/game/content/modes';
import type { PowerUpId } from '@/game/content/powerUps';
import type { DeathCause } from '@/game/state/runtime';

/**
 * `revive` sits between `running` and `gameover`: the run is over but not yet
 * banked, and the player is being offered a way out of it. Its own phase rather
 * than a flag on `gameover`, because everything that reacts to a run ending -
 * the music, the HUD, the save - must not fire until the offer is resolved.
 */
export type Phase = 'boot' | 'menu' | 'running' | 'paused' | 'revive' | 'gameover';

export interface ActivePowerUpView {
  id: PowerUpId;
  /** Seconds left. */
  remaining: number;
  /** Full duration, for drawing the drain bar. */
  duration: number;
}

export interface HudSnapshot {
  score: number;
  coins: number;
  distance: number;
  multiplier: number;
  speed: number;
  /** Seconds left in a timed mode, or null when the mode is untimed. */
  timeRemaining: number | null;
  /** Seconds left of the avalanche behind the player. Zero when clear. */
  avalanche: number;
  powerUps: ActivePowerUpView[];
}

interface GameStore extends HudSnapshot {
  phase: Phase;
  /** Why the last run ended, for the game-over copy. */
  deathCause: DeathCause;
  /** Mode of the current or last run, for the result screen. */
  mode: GameModeId;
  setPhase: (phase: Phase) => void;
  setDeathCause: (cause: DeathCause) => void;
  setMode: (mode: GameModeId) => void;
  /** Called from the game loop. No-ops when nothing visible changed. */
  publish: (snapshot: HudSnapshot) => void;
  resetHud: () => void;
}

const EMPTY_HUD: HudSnapshot = {
  score: 0,
  coins: 0,
  distance: 0,
  multiplier: 1,
  speed: 0,
  timeRemaining: null,
  avalanche: 0,
  powerUps: [],
};

/** How often the loop pushes a snapshot into React, in seconds. */
export const HUD_PUBLISH_INTERVAL = 0.1;

/** Cheap identity for the power-up row: ids plus whole seconds remaining. */
function powerUpSignature(powerUps: readonly ActivePowerUpView[]): string {
  if (powerUps.length === 0) return '';
  let signature = '';
  for (const powerUp of powerUps) signature += `${powerUp.id}:${Math.ceil(powerUp.remaining)},`;
  return signature;
}

export const useGameStore = create<GameStore>((set, get) => ({
  phase: 'boot',
  deathCause: null,
  mode: DEFAULT_MODE,
  ...EMPTY_HUD,

  setPhase: (phase) => {
    if (get().phase !== phase) set({ phase });
  },

  setDeathCause: (deathCause) => {
    if (get().deathCause !== deathCause) set({ deathCause });
  },

  setMode: (mode) => {
    if (get().mode !== mode) set({ mode });
  },

  publish: (snapshot) => {
    const state = get();
    // The HUD shows whole numbers, so only a change the player can actually
    // see is worth a re-render.
    if (
      state.score === snapshot.score &&
      state.coins === snapshot.coins &&
      state.multiplier === snapshot.multiplier &&
      Math.round(state.distance) === Math.round(snapshot.distance) &&
      // The clock is shown to a whole second, so only a tick the player can
      // actually see is worth a re-render.
      Math.ceil(state.timeRemaining ?? 0) === Math.ceil(snapshot.timeRemaining ?? 0) &&
      Math.ceil(state.avalanche) === Math.ceil(snapshot.avalanche) &&
      powerUpSignature(state.powerUps) === powerUpSignature(snapshot.powerUps)
    ) {
      return;
    }
    set(snapshot);
  },

  resetHud: () => set({ ...EMPTY_HUD, powerUps: [] }),
}));
