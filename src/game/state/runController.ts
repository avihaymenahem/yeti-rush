/**
 * Run lifecycle.
 *
 * The one place that starts, ends and restarts a run. The runtime (mutable
 * simulation), the HUD store and the persisted meta all have to move together;
 * having a single function own that transition is what keeps them from
 * drifting apart.
 */

import type { RunStats } from '@/game/content/missions';
import { DEFAULT_MODE, gameModeDef, seedForMode, type GameModeId } from '@/game/content/modes';
import { skinDef } from '@/game/content/skins';
import { gameTimestep } from '@/game/core/gameTimestep';
import { useGameStore } from '@/game/state/gameStore';
import { useMetaStore } from '@/game/state/metaStore';
import { randomSeed, resetRuntime, runtime } from '@/game/state/runtime';
import { localDateKey } from '@/game/systems/dailyCycle';

/**
 * Starts a fresh run.
 *
 * @param modeId - which rule set to play under.
 * @param seed - forced seed, for tests and for reproducing a reported run.
 *        Date-seeded modes ignore the default and derive from today instead.
 */
export function startRun(modeId: GameModeId = DEFAULT_MODE, seed?: number): void {
  const mode = gameModeDef(modeId);
  const { save } = useMetaStore.getState();

  const runSeed = seed ?? seedForMode(mode, localDateKey(new Date()), randomSeed);

  // Upgrades, the board's handling and the mode's rules are all snapshotted at
  // this moment, so buying an upgrade or switching boards mid-session cannot
  // alter a run already in progress.
  resetRuntime(runSeed, save.upgrades, skinDef(save.equippedSkin).stats, mode);
  runtime.running = true;

  const store = useGameStore.getState();
  store.resetHud();
  store.setDeathCause(null);
  store.setMode(mode.id);
  store.setPhase('running');
}

/** The finished run's numbers, in the shape missions and records expect. */
function runStats(): RunStats & { score: number; mode: string } {
  return {
    distance: runtime.distance,
    coins: runtime.coins,
    bestCombo: runtime.bestCombo,
    rampLaunches: runtime.rampLaunches,
    powerUpsCollected: runtime.powerUpsCollected,
    smashed: runtime.smashed,
    // One completed run. Mission progress sums this across runs.
    runs: 1,
    score: runtime.score,
    mode: runtime.mode.id,
  };
}

/**
 * Ends the current run. Called from the game loop the tick after the
 * simulation reports a death, so the store is never written mid-tick.
 */
export function endRun(): void {
  runtime.running = false;

  const store = useGameStore.getState();
  store.publish({
    score: runtime.score,
    coins: runtime.coins,
    distance: runtime.distance,
    multiplier: runtime.multiplier,
    speed: runtime.speed,
    timeRemaining: runtime.timeRemaining,
    // The run is over; nothing is still ticking down.
    powerUps: [],
  });
  store.setDeathCause(runtime.deathCause);
  store.setPhase('gameover');

  // Banks coins, records and mission progress. Runs after the HUD update so a
  // slow storage write can never delay the game-over screen appearing.
  useMetaStore.getState().commitRun(runStats());
}

/**
 * Pauses a live run.
 *
 * Clearing `running` is what actually stops it: the simulation tick returns
 * immediately, so nothing advances and no collision can land while the player
 * is looking at a menu.
 */
export function pauseRun(): void {
  if (!runtime.running || !runtime.alive) return;
  runtime.running = false;
  useGameStore.getState().setPhase('paused');
}

export function resumeRun(): void {
  if (runtime.running || !runtime.alive) return;
  // Drop whatever time accumulated while paused, or the first tick back would
  // advance the world by the length of the pause.
  gameTimestep.reset();
  runtime.running = true;
  useGameStore.getState().setPhase('running');
}

/** Abandons a paused run and goes back to the menu without banking it. */
export function quitRun(): void {
  runtime.running = false;
  runtime.alive = false;
  useGameStore.getState().setPhase('menu');
}

/** Returns to the menu without starting a run. */
export function returnToMenu(): void {
  runtime.running = false;
  useGameStore.getState().setPhase('menu');
}
