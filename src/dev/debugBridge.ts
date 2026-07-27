/**
 * Development-only inspection hook.
 *
 * Exposes the live simulation on `window.yeti` so a run can be inspected,
 * seeded and driven from the console or an automated browser session. This is
 * how gameplay bugs get diagnosed against the real running game rather than a
 * reconstruction of it.
 *
 * Loaded through a dynamic import guarded by `import.meta.env.DEV`, so nothing
 * here - including the import itself - reaches a production bundle.
 */

import type { LaneIndex } from '@/game/config/tuning';
import { useGameStore } from '@/game/state/gameStore';
import { useMetaStore } from '@/game/state/metaStore';
import { endRun, returnToMenu, startRun } from '@/game/state/runController';
import { runtime } from '@/game/state/runtime';
import { obstacleDef, type ObstacleKind } from '@/game/content/obstacles';
import { laneToX, requestLaneChange } from '@/game/systems/lanes';
import { requestJump, requestSlide } from '@/game/systems/player';
import { worldZOf } from '@/game/systems/spawner';

interface NearbyEntity {
  kind: string;
  action?: string;
  lane: number;
  laneX: number;
  worldZ: number;
  trackZ: number;
}

export interface DebugBridge {
  runtime: typeof runtime;
  store: typeof useGameStore;
  meta: typeof useMetaStore;
  /** Tops up the wallet so shop flows can be exercised without grinding. */
  grantCoins: (amount: number) => void;
  startRun: typeof startRun;
  endRun: typeof endRun;
  returnToMenu: typeof returnToMenu;
  jump: () => void;
  slide: () => void;
  left: () => void;
  right: () => void;
  /** Everything on the track within `range` metres of the player, nearest first. */
  nearby: (range?: number) => {
    obstacles: NearbyEntity[];
    coins: NearbyEntity[];
    ramps: NearbyEntity[];
  };
  /**
   * Clears the track and places an exact layout ahead of the player, for
   * reproducing a specific situation without waiting for it to come up.
   */
  stage: (layout: {
    obstacles?: { kind: ObstacleKind; lane: LaneIndex; ahead: number }[];
    ramps?: { lane: LaneIndex; ahead: number }[];
    coins?: { lane: LaneIndex; ahead: number; y?: number }[];
  }) => void;
  /** A compact snapshot of the run, safe to JSON-serialise. */
  snapshot: () => Record<string, unknown>;
}

declare global {
  interface Window {
    yeti?: DebugBridge;
  }
}

export function installDebugBridge(): void {
  const bridge: DebugBridge = {
    runtime,
    store: useGameStore,
    meta: useMetaStore,
    grantCoins: (amount) => {
      const state = useMetaStore.getState();
      useMetaStore.setState({ save: { ...state.save, coins: state.save.coins + amount } });
    },
    startRun,
    endRun,
    returnToMenu,
    jump: () => void requestJump(runtime.player),
    slide: () => void requestSlide(runtime.player),
    left: () => void requestLaneChange(runtime.lane, -1),
    right: () => void requestLaneChange(runtime.lane, 1),

    nearby: (range = 40) => {
      const obstacles: NearbyEntity[] = [];
      const coins: NearbyEntity[] = [];

      for (const obstacle of runtime.track.obstacles) {
        if (!obstacle.active) continue;
        const worldZ = worldZOf(obstacle.trackZ, runtime.distance);
        if (worldZ < -range || worldZ > 8) continue;
        obstacles.push({
          kind: obstacle.kind,
          action: obstacleDef(obstacle.kind).action,
          lane: obstacle.lane,
          laneX: laneToX(obstacle.lane),
          worldZ: Number(worldZ.toFixed(2)),
          trackZ: Number(obstacle.trackZ.toFixed(2)),
        });
      }

      for (const coin of runtime.track.coins) {
        if (!coin.active) continue;
        const worldZ = worldZOf(coin.trackZ, runtime.distance);
        if (worldZ < -range || worldZ > 8) continue;
        coins.push({
          kind: 'coin',
          lane: coin.lane,
          laneX: laneToX(coin.lane),
          worldZ: Number(worldZ.toFixed(2)),
          trackZ: Number(coin.trackZ.toFixed(2)),
        });
      }

      const ramps: NearbyEntity[] = [];
      for (const pad of runtime.track.ramps) {
        if (!pad.active) continue;
        const worldZ = worldZOf(pad.trackZ, runtime.distance);
        if (worldZ < -range || worldZ > 8) continue;
        ramps.push({
          kind: pad.used ? 'ramp (used)' : 'ramp',
          lane: pad.lane,
          laneX: laneToX(pad.lane),
          worldZ: Number(worldZ.toFixed(2)),
          trackZ: Number(pad.trackZ.toFixed(2)),
        });
      }

      obstacles.sort((a, b) => b.worldZ - a.worldZ);
      coins.sort((a, b) => b.worldZ - a.worldZ);
      ramps.sort((a, b) => b.worldZ - a.worldZ);
      return { obstacles, coins, ramps };
    },

    stage: (layout) => {
      const track = runtime.track;
      for (const obstacle of track.obstacles) obstacle.active = false;
      for (const coin of track.coins) coin.active = false;
      for (const pad of track.ramps) pad.active = false;
      // Push the generator far ahead so it does not lay over the staged layout.
      track.nextChunkStart = runtime.distance + 100_000;

      layout.obstacles?.forEach((spec, index) => {
        const entity = track.obstacles[index];
        if (!entity) return;
        entity.active = true;
        entity.kind = spec.kind;
        entity.lane = spec.lane;
        entity.trackZ = runtime.distance + spec.ahead;
        entity.passed = false;
      });

      layout.ramps?.forEach((spec, index) => {
        const entity = track.ramps[index];
        if (!entity) return;
        entity.active = true;
        entity.lane = spec.lane;
        entity.trackZ = runtime.distance + spec.ahead;
        entity.used = false;
      });

      layout.coins?.forEach((spec, index) => {
        const entity = track.coins[index];
        if (!entity) return;
        entity.active = true;
        entity.lane = spec.lane;
        entity.trackZ = runtime.distance + spec.ahead;
        entity.y = spec.y ?? 0.9;
      });
    },

    snapshot: () => ({
      phase: useGameStore.getState().phase,
      running: runtime.running,
      alive: runtime.alive,
      deathCause: runtime.deathCause,
      seed: runtime.seed,
      elapsed: Number(runtime.elapsed.toFixed(3)),
      distance: Number(runtime.distance.toFixed(3)),
      speed: Number(runtime.speed.toFixed(3)),
      laneX: Number(runtime.lane.x.toFixed(3)),
      targetLane: runtime.lane.targetLane,
      motion: runtime.player.motion,
      playerY: Number(runtime.player.y.toFixed(3)),
      coins: runtime.coins,
      score: runtime.score,
      combo: runtime.combo,
      multiplier: runtime.multiplier,
    }),
  };

  window.yeti = bridge;
}
