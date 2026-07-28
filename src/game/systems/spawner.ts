/**
 * Track streaming.
 *
 * Chunks are laid end to end ahead of the player and their contents written
 * into fixed-size pools. Nothing is allocated or garbage collected during a
 * run - entities are flipped inactive when they pass the camera and reused.
 *
 * Positions are stored as absolute track distances, not world Z. World Z is
 * derived (`worldZOf`) from how far the player has travelled, which is what
 * lets the world scroll without accumulating float error over a long run.
 */

import { TUNING, type LaneIndex } from '@/game/config/tuning';
import {
  CHUNK_LENGTH,
  chunksForTier,
  expandCoins,
  expandObstacles,
  firstRowZ,
  forcedActionRows,
  furthestRampZ,
  isRunway,
  laneOf,
  lastRowZ,
  minRowGap,
  runwayChunks,
  type ChunkTemplate,
} from '@/game/content/chunks';
import { worstCaseSpeed } from '@/game/content/skins';
import { railLandingDistance } from '@/game/systems/rail';
import { DEFAULT_MIN_ACTION_SECONDS } from '@/game/systems/solvability';
import { obstacleDef, type ObstacleKind } from '@/game/content/obstacles';
import { POWER_UP_IDS, powerUpDef, type PowerUpId } from '@/game/content/powerUps';
import type { Rng } from '@/game/core/rng';

export interface ObstacleEntity {
  active: boolean;
  kind: ObstacleKind;
  lane: LaneIndex;
  /** Absolute distance along the track. */
  trackZ: number;
  /** Set once the player has passed it, so a combo is only counted once. */
  passed: boolean;
  /**
   * Set once the player has ridden through it on the ghost board.
   *
   * Needed because, unlike smashing, phasing leaves the obstacle standing - so
   * there is nothing to deactivate and the overlap lasts for as many ticks as
   * it takes to cross. Without this it would score once per frame.
   */
  phased: boolean;
}

export interface CoinEntity {
  active: boolean;
  lane: LaneIndex;
  trackZ: number;
  y: number;
}

/**
 * A grind rail. Like a ramp, a trigger rather than an obstacle: riding past one
 * without sliding does nothing at all, which is what keeps rails entirely
 * outside the solvability guarantee.
 */
export interface RailEntity {
  active: boolean;
  lane: LaneIndex;
  /** Absolute distance of the near end. */
  trackZ: number;
  /** Metres from mount to dismount, authored per rail. */
  length: number;
  /** Set once ridden, so the run stat counts a rail once however often it is
   *  caught and re-caught. */
  used: boolean;
}

/** A launch pad. Not an obstacle - hitting one is the reward, not the failure. */
export interface RampEntity {
  active: boolean;
  lane: LaneIndex;
  trackZ: number;
  /** Set once used, so one ramp cannot re-launch a player mid-flight. */
  used: boolean;
}

export interface PickupEntity {
  active: boolean;
  lane: LaneIndex;
  trackZ: number;
  powerUp: PowerUpId;
}

/**
 * Pool sizes. Generous enough that the visible band never runs dry, small
 * enough that a full scan stays trivial: the whole obstacle pool is a few
 * hundred bytes and the per-frame scan is bounded and predictable.
 */
export const MAX_OBSTACLES = 96;
export const MAX_COINS = 320;
export const MAX_RAMPS = 16;
export const MAX_RAILS = 12;
export const MAX_PICKUPS = 8;

export interface SpawnerState {
  obstacles: ObstacleEntity[];
  coins: CoinEntity[];
  ramps: RampEntity[];
  rails: RailEntity[];
  pickups: PickupEntity[];
  /** Track distance at which the next power-up pickup is due. */
  nextPickupAt: number;
  /** Absolute distance where the next chunk will start. */
  nextChunkStart: number;
  /** Ids of the last chunks laid, newest last. Used to avoid repeats. */
  recentChunkIds: string[];
  /**
   * Track must stay obstacle-free up to this distance. Set when a ramp is laid,
   * so whatever the player is committed to flying over, they land on clear snow.
   */
  clearUntil: number;
  /**
   * Absolute distance of the last row that forced a jump or a slide.
   *
   * Chunks are authored to keep their own forced rows far enough apart, but
   * nothing stops one chunk ending with a forced row and the next opening with
   * one. Tracking it across the boundary is what makes the spacing a property
   * of the generated track rather than of each chunk in isolation.
   */
  lastForcedActionZ: number;
  /**
   * Absolute distance of the last row the player has to react to at all.
   *
   * Separate from `lastForcedActionZ`, which only counts rows that seal every
   * lane. Steering around an open row is still a decision, and at speed it is
   * the one that dominates - see `REACTION_SECONDS`.
   */
  lastRowZ: number;
}

/** How far ahead of the player chunks are laid, in metres. */
const SPAWN_AHEAD = TUNING.track.drawDistance + CHUNK_LENGTH;

/** How far behind the player an entity survives before being recycled. */
const RECYCLE_BEHIND = TUNING.track.recycleBehind;

/** How many recent chunks to remember when avoiding immediate repeats. */
export const RECENT_MEMORY = 2;

export function createSpawner(): SpawnerState {
  const obstacles: ObstacleEntity[] = Array.from({ length: MAX_OBSTACLES }, () => ({
    active: false,
    kind: 'drift' as ObstacleKind,
    lane: 1 as LaneIndex,
    trackZ: 0,
    passed: false,
    phased: false,
  }));

  const coins: CoinEntity[] = Array.from({ length: MAX_COINS }, () => ({
    active: false,
    lane: 1 as LaneIndex,
    trackZ: 0,
    y: TUNING.coins.baseHeight,
  }));

  const ramps: RampEntity[] = Array.from({ length: MAX_RAMPS }, () => ({
    active: false,
    lane: 1 as LaneIndex,
    trackZ: 0,
    used: false,
  }));

  const rails: RailEntity[] = Array.from({ length: MAX_RAILS }, () => ({
    active: false,
    lane: 1 as LaneIndex,
    trackZ: 0,
    length: TUNING.rail.minLength,
    used: false,
  }));

  const pickups: PickupEntity[] = Array.from({ length: MAX_PICKUPS }, () => ({
    active: false,
    lane: 1 as LaneIndex,
    trackZ: 0,
    powerUp: 'magnet' as PowerUpId,
  }));

  return {
    obstacles,
    coins,
    ramps,
    rails,
    pickups,
    nextPickupAt: 0,
    nextChunkStart: 0,
    recentChunkIds: [],
    clearUntil: 0,
    lastForcedActionZ: Number.NEGATIVE_INFINITY,
    lastRowZ: Number.NEGATIVE_INFINITY,
  };
}

/**
 * Metres that must separate two forced actions.
 *
 * Derived from the same commitment window the solvability check uses, measured
 * at the fastest the game can go - the fastest board at top speed - so the
 * guarantee holds for every player rather than the average one.
 */
const REQUIRED_ACTION_GAP =
  DEFAULT_MIN_ACTION_SECONDS * worstCaseSpeed(TUNING.speed.max) * 1.05;

/**
 * Seconds a player needs between two things they must react to.
 *
 * `DEFAULT_MIN_ACTION_SECONDS` above answers a different question - how long the
 * *character* is committed after a jump or a slide - and that is all the
 * solvability check has ever modelled. It assumes a player who already knows
 * what is coming and inputs it frame-perfectly. Real players have to see the
 * row, choose a lane and move their thumb, and simple visual reaction alone is
 * around a quarter of a second before any of that.
 *
 * Measured against the old generator, half of all required actions arrived
 * within 0.35 s of the previous one at top speed, with a median of 0.33 s. That
 * is not difficulty, it is a coin flip, and it is why the run became unplayable
 * as it sped up.
 *
 * Applied as a *distance* at the current speed, so the track thins out as the
 * run accelerates instead of compressing. Fast and sparse reads as fast; fast
 * and dense reads as broken.
 */
export const REACTION_SECONDS = 0.45;

/**
 * Metres a player covers falling off the end of a rail, at the fastest the game
 * can go.
 *
 * Measured at the worst case rather than the current speed because the track is
 * laid seconds ahead of where it will be ridden, and being generous here costs
 * a little empty snow while being mean costs a death nobody could have avoided.
 */
const RAIL_LANDING_DISTANCE = railLandingDistance(worstCaseSpeed(TUNING.speed.max));

/**
 * Metres between power-up pickups. Spaced by distance rather than dropped by
 * chunk, so the pace of power-ups stays steady whatever track is generated.
 */
export const PICKUP_SPACING = 420;
const PICKUP_SPACING_JITTER = 140;

export function resetSpawner(state: SpawnerState): void {
  for (const obstacle of state.obstacles) obstacle.active = false;
  for (const coin of state.coins) coin.active = false;
  for (const ramp of state.ramps) ramp.active = false;
  for (const rail of state.rails) rail.active = false;
  for (const pickup of state.pickups) pickup.active = false;
  // The first stretch is empty so the player is never hit before they can see
  // anything - the run has to open with a moment of clear track.
  state.nextChunkStart = CHUNK_LENGTH * 2;
  state.nextPickupAt = PICKUP_SPACING * 0.5;
  state.recentChunkIds.length = 0;
  state.clearUntil = 0;
  state.lastForcedActionZ = Number.NEGATIVE_INFINITY;
  state.lastRowZ = Number.NEGATIVE_INFINITY;
}

/** True if this chunk would put a forced action too soon after the last one. */
function crowdsPreviousAction(
  state: SpawnerState,
  chunk: ChunkTemplate,
  startZ: number,
): boolean {
  const forced = forcedActionRows(chunk);
  if (forced.length === 0) return false;
  return startZ + (forced[0] as number) - state.lastForcedActionZ < REQUIRED_ACTION_GAP;
}

/** World Z of a track position, given how far the player has travelled. */
export function worldZOf(trackZ: number, distance: number): number {
  return distance - trackZ;
}

function firstInactive<T extends { active: boolean }>(pool: T[]): T | null {
  for (const item of pool) {
    if (!item.active) return item;
  }
  return null;
}

/**
 * Picks the next chunk, avoiding anything laid in the last few chunks so the
 * track does not visibly loop.
 */
export function pickChunk(
  rng: Rng,
  tier: number,
  recentIds: readonly string[],
  runwayOnly = false,
  accept?: (chunk: ChunkTemplate) => boolean,
): ChunkTemplate {
  // A runway is drawn from regardless of tier: a ramp landing has to be safe
  // even in the hardest stretch of the run.
  const pool = runwayOnly ? runwayChunks() : chunksForTier(tier);
  const eligible = accept ? pool.filter(accept) : pool;

  // Nothing in the tier fits the pace any more. A runway always does, and is
  // laid unfiltered - which is what terminates this, since runways contain no
  // rows and so can never fail a spacing test.
  if (eligible.length === 0) return pickChunk(rng, tier, recentIds, true);

  const fresh = eligible.filter((chunk) => !recentIds.includes(chunk.id));
  // If the tier is small enough that everything is recent, repeats beat crashing.
  const candidates = fresh.length > 0 ? fresh : eligible;

  return rng.weighted(
    candidates,
    candidates.map((chunk) => chunk.weight),
  );
}

/**
 * @param mirror - lays the chunk reflected left-to-right. Free variety: a
 *        reflection preserves lane adjacency, so every guarantee already
 *        checked for the chunk holds for its mirror unchanged. It also makes
 *        left/right balance a property of the generator rather than something
 *        an author has to remember to hand-mirror.
 */
function layChunk(
  state: SpawnerState,
  chunk: ChunkTemplate,
  startZ: number,
  mirror: boolean,
  rng: Rng,
  reactionGap: number,
): void {
  for (const spec of expandObstacles(chunk, startZ, mirror)) {
    const entity = firstInactive(state.obstacles);
    // Pool exhausted. Dropping the obstacle makes the track easier, never
    // unfair, which is the right way to fail.
    if (!entity) break;

    entity.active = true;
    entity.kind = spec.kind;
    entity.lane = spec.lane;
    entity.trackZ = spec.z;
    entity.passed = false;
    entity.phased = false;
  }

  // Rolled per run, so coins are scattered rather than bolted to every feature.
  // The predicate runs for every authored run whether it survives or not, which
  // keeps the RNG stream a function of the chunk alone.
  const coinRuns = chunk.coins.filter((run) => {
    const onRoute = run.rampFrom !== undefined;
    return rng.chance(onRoute ? TUNING.coins.routeRunChance : TUNING.coins.plainRunChance);
  });

  const coinSpecs = expandCoins(
    { ...chunk, coins: coinRuns },
    startZ,
    TUNING.coins.baseHeight,
    TUNING.coins.arcPeak,
    TUNING.coins.spacing,
    mirror,
  );

  for (const spec of coinSpecs) {
    const entity = firstInactive(state.coins);
    if (!entity) break;

    entity.active = true;
    entity.lane = spec.lane;
    entity.trackZ = spec.z;
    entity.y = spec.y;
  }

  // Rails roll their own length, so the same chunk is a different ride each
  // time it comes round. `railEnd` tracks the furthest any of them actually
  // reaches, which an authored value could not - and it is what the landing
  // protection below has to be measured from.
  let railEnd: number | null = null;

  for (const spec of chunk.rails ?? []) {
    const entity = firstInactive(state.rails);
    if (!entity) break;

    const { minLength, maxLength } = TUNING.rail;
    const length = rng.range(minLength, maxLength);
    const lane = laneOf(spec.lane, mirror);

    entity.active = true;
    entity.lane = lane;
    entity.trackZ = startZ + spec.z;
    entity.length = length;
    entity.used = false;

    railEnd = Math.max(railEnd ?? -Infinity, spec.z + length);

    // The coin line, laid along the bar rather than authored beside it. Rolled
    // like any other route line, so a rail is not guaranteed to pay - but far
    // more often than not, because it is the only thing a rail pays at all.
    if (!rng.chance(TUNING.coins.routeRunChance)) continue;

    const spacing = TUNING.rail.coinSpacing;
    const count = Math.max(1, Math.floor(length / spacing));
    for (let i = 0; i < count; i++) {
      const coin = firstInactive(state.coins);
      if (!coin) break;

      coin.active = true;
      coin.lane = lane;
      coin.trackZ = entity.trackZ + (i + 0.5) * spacing;
      coin.y = TUNING.coins.baseHeight + TUNING.rail.height;
    }
  }

  for (const spec of chunk.ramps ?? []) {
    const entity = firstInactive(state.ramps);
    if (!entity) break;

    entity.active = true;
    entity.lane = laneOf(spec.lane, mirror);
    entity.trackZ = startZ + spec.z;
    entity.used = false;
  }

  // Any ramp here commits the player to a flight they cannot abort, so protect
  // the track from just past the chalet through to well after touchdown.
  const rampZ = furthestRampZ(chunk);
  if (rampZ !== null) {
    const touchdown = startZ + rampZ + TUNING.ramp.airDistance;
    state.clearUntil = Math.max(state.clearUntil, touchdown + TUNING.ramp.landingClearance);
  }

  // A rail ends by throwing the player into a fall they cannot act during, so
  // its landing needs exactly the same protection a ramp's does. Leaving this
  // out is what made rails feel like a trap: the reward route ended in an
  // obstacle you were already airborne for.
  // A tunnel blinds the player for its whole depth: inside a ten-metre gallery
  // the roof and walls are between them and whatever is coming, so an obstacle
  // just past the mouth cannot be seen in time however well the run is being
  // read. Reported from play as "a boulder right outside a tunnel", and it is
  // the ramp-landing problem in a third costume - a span the player cannot act
  // through, followed by track nothing had cleared.
  //
  // Measured from the far end of the passage plus one full reaction at the pace
  // this stretch is being laid for - the same distance the row spacing uses, and
  // scaled the same way. A fixed worst-case margin would clear as much track at
  // sixteen units a second as at forty, which quietly cancels the thing that
  // keeps a fast run playable: the track is supposed to *thin out* as it speeds
  // up, and over-protecting the slow end flattens that difference away.
  for (const spec of expandObstacles(chunk, startZ, mirror)) {
    if (!spec.kind.startsWith('tunnel')) continue;
    const exit = spec.z + obstacleDef(spec.kind).halfDepth;
    state.clearUntil = Math.max(state.clearUntil, exit + reactionGap);
  }

  // A rail may outrun its own chunk. Protecting from its real far end is what
  // makes that safe: everything up to the dismount plus the fall is laid clear,
  // so a rider is never carried at bar height into an obstacle nothing checked.
  if (railEnd !== null) {
    const touchdown = startZ + railEnd + RAIL_LANDING_DISTANCE;
    state.clearUntil = Math.max(state.clearUntil, touchdown + TUNING.rail.landingClearance);
  }

  const forced = forcedActionRows(chunk);
  if (forced.length > 0) {
    state.lastForcedActionZ = startZ + (forced[forced.length - 1] as number);
  }

  const last = lastRowZ(chunk);
  if (last !== null) state.lastRowZ = startZ + last;

  state.recentChunkIds.push(chunk.id);
  if (state.recentChunkIds.length > RECENT_MEMORY) state.recentChunkIds.shift();
}

/**
 * Recycles anything the player has passed and lays new chunks ahead.
 *
 * @param speed - the pace the player will be doing when they reach the track
 *        being laid, used to keep decision rows a reactable distance apart.
 *        Chunks go down about six seconds ahead, over which the difficulty ramp
 *        barely moves, so the current cruising speed is a good estimate.
 */
export function updateSpawner(
  state: SpawnerState,
  distance: number,
  tier: number,
  rng: Rng,
  speed: number = TUNING.speed.max,
): void {
  for (const obstacle of state.obstacles) {
    if (obstacle.active && worldZOf(obstacle.trackZ, distance) > RECYCLE_BEHIND) {
      obstacle.active = false;
    }
  }

  for (const coin of state.coins) {
    if (coin.active && worldZOf(coin.trackZ, distance) > RECYCLE_BEHIND) {
      coin.active = false;
    }
  }

  for (const ramp of state.ramps) {
    if (ramp.active && worldZOf(ramp.trackZ, distance) > RECYCLE_BEHIND) {
      ramp.active = false;
    }
  }

  for (const rail of state.rails) {
    // A rail is long, and the player is still riding it well after its near end
    // has gone by, so it survives its own length past the usual cutoff.
    if (rail.active && worldZOf(rail.trackZ, distance) > RECYCLE_BEHIND + rail.length) {
      rail.active = false;
    }
  }

  for (const pickup of state.pickups) {
    if (pickup.active && worldZOf(pickup.trackZ, distance) > RECYCLE_BEHIND) {
      pickup.active = false;
    }
  }

  // Metres the player covers in one reaction, at the pace they will be doing.
  const reactionGap = REACTION_SECONDS * Math.max(1, speed);

  // Bounded so a single huge distance jump cannot lay hundreds of chunks in one
  // tick; the loop simply catches up over the following frames.
  let laid = 0;
  while (state.nextChunkStart < distance + SPAWN_AHEAD && laid < 4) {
    // A chunk that would start inside a ramp's protected span must be a runway,
    // or the player lands on whatever it happened to contain.
    const mustBeRunway = state.nextChunkStart < state.clearUntil;
    const startZ = state.nextChunkStart;

    /**
     * Rejects a chunk whose rows come faster than the player can answer them,
     * both inside the chunk and across the join with what was laid before.
     * Runways have no rows at all and are always allowed, which is what stops
     * this filtering the pool down to nothing.
     */
    const paced = (chunk: ChunkTemplate): boolean => {
      if (isRunway(chunk)) return true;
      if (minRowGap(chunk) < reactionGap) return false;
      const first = firstRowZ(chunk);
      return first === null || startZ + first - state.lastRowZ >= reactionGap;
    };

    let chunk = pickChunk(rng, tier, state.recentChunkIds, mustBeRunway, paced);

    // If the pick would stack a forced action on top of the previous one, lay a
    // runway instead. Runways contain no obstacles, so they are always a legal
    // answer and the retry cannot loop.
    if (!mustBeRunway && crowdsPreviousAction(state, chunk, startZ)) {
      chunk = pickChunk(rng, tier, state.recentChunkIds, true);
    }

    // Reflected on a coin toss. Drawn for every chunk, mirrorable or not, so
    // the RNG stream does not depend on which chunk came out of the pick.
    layChunk(state, chunk, state.nextChunkStart, rng.chance(0.5), rng, reactionGap);
    state.nextChunkStart += CHUNK_LENGTH;
    laid++;
  }

  layPickups(state, distance, rng);
}

/**
 * Drops power-ups on a distance cadence rather than per chunk, so their pace is
 * independent of whatever track happened to be generated.
 */
function layPickups(state: SpawnerState, distance: number, rng: Rng): void {
  let placed = 0;
  while (state.nextPickupAt < distance + SPAWN_AHEAD && placed < 2) {
    const entity = firstInactive(state.pickups);
    if (!entity) break;

    entity.active = true;
    entity.lane = rng.int(3) as LaneIndex;
    entity.trackZ = state.nextPickupAt;
    entity.powerUp = rng.weighted(
      POWER_UP_IDS,
      POWER_UP_IDS.map((id) => powerUpDef(id).weight),
    );

    state.nextPickupAt += PICKUP_SPACING + rng.range(-1, 1) * PICKUP_SPACING_JITTER;
    placed++;
  }
}
