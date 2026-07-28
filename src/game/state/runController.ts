/**
 * Run lifecycle.
 *
 * The one place that starts, ends and restarts a run. The runtime (mutable
 * simulation), the HUD store and the persisted meta all have to move together;
 * having a single function own that transition is what keeps them from
 * drifting apart.
 */

import { TUNING } from '@/game/config/tuning';
import type { RunStats } from '@/game/content/missions';
import { DEFAULT_MODE, gameModeDef, seedForMode, type GameModeId } from '@/game/content/modes';
import { skinDef } from '@/game/content/skins';
import { gameTimestep } from '@/game/core/gameTimestep';
import { useGameStore } from '@/game/state/gameStore';
import { useMetaStore } from '@/game/state/metaStore';
import { randomSeed, resetRuntime, runtime } from '@/game/state/runtime';
import { resetChaser } from '@/game/systems/chaser';
import { localDateKey } from '@/game/systems/dailyCycle';
import { worldZOf } from '@/game/systems/spawner';

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
    phased: runtime.phased,
    // One completed run. Mission progress sums this across runs.
    runs: 1,
    score: runtime.score,
    mode: runtime.mode.id,
  };
}

/**
 * Coins the next revive of this run would cost.
 *
 * Doubling, so the first is a formality and the third is a whole good run's
 * takings. A flat price would make reviving the obvious move every time, which
 * is the same as having no death at all.
 */
export function revivePrice(revives: number = runtime.revives): number {
  return Math.round(TUNING.revive.basePrice * Math.pow(TUNING.revive.priceGrowth, revives));
}

/**
 * Whether a second chance can be offered for the run that just ended.
 *
 * Timing out is not offered either. `timeUp` is the mode's own ending rather
 * than a mistake, and selling a way past it would make Time Attack a question
 * of how many coins the player has.
 */
export function canRevive(): boolean {
  if (runtime.deathCause === 'timeUp') return false;
  if (runtime.revives >= TUNING.revive.maxPerRun) return false;
  return useMetaStore.getState().save.coins >= revivePrice();
}

/**
 * Puts the player back on the track, paid for in coins.
 *
 * The run's numbers are kept - that is the entire point - but the combo is not.
 * A combo is a statement about unbroken riding and it was broken; letting it
 * survive would make a revive the cheapest way to protect a multiplier rather
 * than a way to keep going.
 *
 * Two protections, and they answer different things. `graceTimer` covers the
 * obstacle the player is *currently inside*, which no amount of clear track
 * ahead can help with. `clearUntil` covers the track they are about to reach at
 * full speed having read none of it - the committed-flight rule again, in its
 * fifth costume after ramps, rails and tunnels.
 */
export function reviveRun(): boolean {
  if (!canRevive()) return false;

  const price = revivePrice();
  if (!useMetaStore.getState().spendCoins(price)) return false;

  runtime.revives++;
  runtime.alive = true;
  runtime.deathCause = null;
  runtime.combo = 0;
  runtime.graceTimer = TUNING.revive.graceSeconds;
  runtime.stumbleTimer = 0;

  // Whatever killed them is still standing right there, and at these speeds it
  // is still inside the collision window on the very next tick.
  for (const obstacle of runtime.track.obstacles) {
    if (!obstacle.active) continue;
    if (Math.abs(worldZOf(obstacle.trackZ, runtime.distance)) < TUNING.collision.zWindow) {
      obstacle.active = false;
    }
  }
  for (const rail of runtime.track.rails) {
    if (!rail.active) continue;
    const along = runtime.distance - rail.trackZ;
    if (along > -TUNING.collision.zWindow && along < rail.length) rail.active = false;
  }

  runtime.track.clearUntil = Math.max(
    runtime.track.clearUntil,
    runtime.distance + runtime.speed * TUNING.revive.clearSeconds,
  );

  // The patrol backs off as well. Coming back with it already on your shoulder
  // would mean the next trip ends the run, which is not a second chance.
  resetChaser(runtime.chaser);

  gameTimestep.reset();
  runtime.running = true;
  useGameStore.getState().setDeathCause(null);
  useGameStore.getState().setPhase('running');
  return true;
}

/**
 * Offers the second chance, or ends the run if there is nothing to offer.
 *
 * Nothing is banked here. The run is not over until the offer is declined or
 * runs out, which is what lets a revived run keep its score.
 */
export function finishOrOfferRevive(): void {
  runtime.running = false;

  if (canRevive()) {
    useGameStore.getState().setPhase('revive');
    return;
  }
  endRun();
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
    avalanche: 0,
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
