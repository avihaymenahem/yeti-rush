/**
 * Mutable per-run simulation state.
 *
 * This is the one place the game loop writes to, and it is deliberately a
 * plain mutable object outside React. Driving 60 Hz simulation through React
 * state would re-render the tree every frame and will not hold frame rate on a
 * mid-range Android device. React reads a throttled snapshot of this instead
 * (see `@/game/state/gameStore`).
 */

import { CENTRE_LANE } from '@/game/config/tuning';
import {
  clearPowerUpTimers,
  createPowerUpTimers,
  durationsFor,
  type PowerUpId,
  type PowerUpTimers,
} from '@/game/content/powerUps';
import { DEFAULT_MODE, GAME_MODES, type GameModeDef } from '@/game/content/modes';
import { NEUTRAL_STATS, type BoardStats } from '@/game/content/skins';
import { createRng, type Rng } from '@/game/core/rng';
import { createChaserState, resetChaser, type ChaserState } from '@/game/systems/chaser';
import { createAabb, type Aabb } from '@/game/systems/collision';
import { speedAt } from '@/game/systems/difficulty';
import { createLaneState, resetLaneState, type LaneState } from '@/game/systems/lanes';
import { createPlayerState, resetPlayerState, type PlayerState } from '@/game/systems/player';
import { createSpawner, resetSpawner, type SpawnerState } from '@/game/systems/spawner';

export type DeathCause = 'obstacle' | 'caught' | 'timeUp' | null;

export interface RuntimeState {
  /** False before the run starts and after the player dies; the sim idles. */
  running: boolean;
  alive: boolean;
  deathCause: DeathCause;

  /** The mode's rules, snapshotted for the same reason the board stats are. */
  mode: GameModeDef;
  /** Seconds left when the mode is timed, or null when it is not. */
  timeRemaining: number | null;

  /** Seconds of active running, drives the speed and difficulty curves. */
  elapsed: number;
  /** World units travelled. The world scrolls by this; the player never moves. */
  distance: number;
  /** Current world scroll speed in units/second. */
  speed: number;

  lane: LaneState;
  player: PlayerState;
  track: SpawnerState;

  /** Coins collected this run. */
  coins: number;
  /** Run score, before any end-of-run bonuses. */
  score: number;
  /** Obstacles cleared without dying. */
  combo: number;
  /** Score multiplier earned by the current combo. */
  multiplier: number;
  /** Ramps taken this run. Drives a mission and the end-of-run summary. */
  rampLaunches: number;
  /** Rails ridden this run. Counts mounts, not distance grinded. */
  railGrinds: number;
  /** Crossbars landed on cleanly this run. */
  crossbarTaps: number;
  /** Obstacles destroyed by the avalanche board. */
  smashed: number;
  /** Times the player tripped and recovered this run. */
  stumbles: number;
  /** Seconds left of the current stumble recovery. Zero when running clean. */
  stumbleTimer: number;

  /** Highest combo reached this run, for missions and the summary. */
  bestCombo: number;
  /** Power-ups picked up this run. */
  powerUpsCollected: number;

  /** Remaining seconds per power-up. */
  powerUps: PowerUpTimers;
  /**
   * Duration each power-up lasts this run, after shop upgrades. Snapshotted at
   * run start so the simulation never has to reach into the meta store, which
   * keeps it pure and headless-testable.
   */
  powerUpDurations: PowerUpTimers;
  /**
   * The equipped board's handling profile, snapshotted for the same reason.
   * Also means changing boards mid-session cannot alter a run in progress.
   */
  board: BoardStats;
  /** Power-ups that expired on the current tick. Reused, never reallocated. */
  expiredPowerUps: PowerUpId[];
  /**
   * Set on the tick a power-up is picked up, for the presentation layer to
   * consume and clear. Avoids the renderer having to diff the timers.
   */
  collectedPowerUp: PowerUpId | null;

  chaser: ChaserState;

  /** Seeded generator for this run - all track randomness derives from it. */
  rng: Rng;
  seed: number;

  /**
   * Scratch colliders, reused every tick. Collision runs over every nearby
   * entity each frame; allocating boxes there would churn the heap constantly.
   */
  scratch: { player: Aabb; entity: Aabb };
}

function createRuntimeState(seed: number): RuntimeState {
  const state: RuntimeState = {
    running: false,
    alive: true,
    deathCause: null,
    mode: GAME_MODES[DEFAULT_MODE],
    timeRemaining: null,
    elapsed: 0,
    distance: 0,
    speed: speedAt(0),
    lane: createLaneState(CENTRE_LANE),
    player: createPlayerState(),
    track: createSpawner(),
    coins: 0,
    score: 0,
    combo: 0,
    multiplier: 1,
    rampLaunches: 0,
    railGrinds: 0,
    crossbarTaps: 0,
    smashed: 0,
    stumbles: 0,
    stumbleTimer: 0,
    bestCombo: 0,
    powerUpsCollected: 0,
    powerUps: createPowerUpTimers(),
    powerUpDurations: durationsFor({}),
    board: { ...NEUTRAL_STATS },
    expiredPowerUps: [],
    collectedPowerUp: null,
    chaser: createChaserState(),
    rng: createRng(seed),
    seed,
    scratch: { player: createAabb(), entity: createAabb() },
  };

  resetSpawner(state.track);
  return state;
}

/**
 * The single live runtime instance. A module singleton rather than context
 * because `useFrame` callbacks must reach it without prop drilling, and there
 * is exactly one simulation at a time.
 */
export const runtime: RuntimeState = createRuntimeState(1);

/**
 * Resets every field in place, so existing references stay valid.
 *
 * @param upgrades - the player's shop upgrade levels, folded into this run's
 *        power-up durations. Defaults to none, for tests and headless runs.
 */
export function resetRuntime(
  seed: number,
  upgrades: Record<string, number> = {},
  board: BoardStats = NEUTRAL_STATS,
  mode: GameModeDef = GAME_MODES[DEFAULT_MODE],
): void {
  runtime.running = false;
  runtime.alive = true;
  runtime.deathCause = null;
  runtime.mode = mode;
  runtime.timeRemaining = mode.timeLimit;
  // Modes can start part-way up the difficulty curve, which is what makes
  // Blizzard open at top speed instead of taking three minutes to get there.
  runtime.elapsed = mode.startElapsed;
  runtime.distance = 0;
  runtime.speed = speedAt(0);
  runtime.coins = 0;
  runtime.score = 0;
  runtime.combo = 0;
  runtime.multiplier = 1;
  runtime.rampLaunches = 0;
  runtime.railGrinds = 0;
  runtime.crossbarTaps = 0;
  runtime.smashed = 0;
  runtime.stumbles = 0;
  runtime.stumbleTimer = 0;
  runtime.bestCombo = 0;
  runtime.powerUpsCollected = 0;
  runtime.collectedPowerUp = null;
  runtime.expiredPowerUps.length = 0;
  runtime.seed = seed;
  runtime.rng = createRng(seed);
  clearPowerUpTimers(runtime.powerUps);
  Object.assign(runtime.powerUpDurations, durationsFor(upgrades));
  Object.assign(runtime.board, board);
  resetChaser(runtime.chaser);
  resetLaneState(runtime.lane, CENTRE_LANE);
  resetPlayerState(runtime.player);
  resetSpawner(runtime.track);
}

/** A fresh runtime for tests, isolated from the live singleton. */
export function createTestRuntime(seed = 1): RuntimeState {
  return createRuntimeState(seed);
}

/** A seed derived from wall-clock time, for a fresh unseeded run. */
export function randomSeed(): number {
  return (Date.now() ^ (Math.random() * 0xffffffff)) | 0;
}
