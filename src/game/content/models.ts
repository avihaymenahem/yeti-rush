/**
 * Which CC0 model represents each thing in the world, and how it is fitted.
 *
 * Colliders stay authoritative: every model here is scaled to match the
 * collider already defined in `obstacles.ts`, not the other way round. Art
 * should never quietly change the hitbox - `tests/models.test.ts` asserts each
 * fitted size matches its collider.
 *
 * Kinds absent from `OBSTACLE_MODELS` render as primitives. The overhead
 * barriers are deliberately among them: nothing in either kit reads as
 * "duck under this" at a glance, and a clear silhouette matters more for an
 * obstacle the player has a fifth of a second to parse than fidelity does.
 */

import logLargeUrl from '@/assets/models/log_large.glb';
import rockTallDUrl from '@/assets/models/rock_tallD.glb';
import snowPileUrl from '@/assets/models/snow-pile.glb';
import treeSnowAUrl from '@/assets/models/tree-snow-a.glb';
import treeSnowBUrl from '@/assets/models/tree-snow-b.glb';
import treeSnowCUrl from '@/assets/models/tree-snow-c.glb';
import type { ObstacleKind } from '@/game/content/obstacles';
import type { ModelSpec } from '@/game/render/useModel';

/**
 * Every collider in this game is ground-aligned (its base sits at y = 0), and
 * so is every prepared model, which is why instances can be placed at y = 0.
 */
export const OBSTACLE_MODELS: Partial<Record<ObstacleKind, ModelSpec>> = {
  // Collider 1.8 x 0.7 x 1.0. Fitted per axis: the raw pile is twice as deep as
  // its collider, and a drift reads the same whatever its depth.
  drift: { url: snowPileUrl, textured: true, fitBox: [1.9, 0.7, 1.2] },
  // Collider 1.8 x 0.8 x 0.7; the model already lies across the track. Left
  // brown - a bare log is one of the few warm things that belongs in snow.
  log: { url: logLargeUrl, fitWidth: 1.9 },
  // Collider 1.7 x 3.0 x 1.4. Fitted by height, since the height is what makes
  // this un-jumpable and therefore a dodge. Cooled towards slate, because the
  // Nature Kit rock is sandy brown and reads as desert against an alpine sky.
  boulder: {
    url: rockTallDUrl,
    fitHeight: 3.0,
    recolor: { color: '#8d9aa5', amount: 0.72 },
  },
};

/** Snow-laden pines lining the run. */
export const PINE_MODELS: ModelSpec[] = [
  { url: treeSnowAUrl, textured: true, fitHeight: 4.2 },
  { url: treeSnowBUrl, textured: true, fitHeight: 4.8 },
  { url: treeSnowCUrl, textured: true, fitHeight: 3.8 },
];

/** Everything to warm before the first run. */
export const ALL_MODEL_URLS: string[] = [
  ...Object.values(OBSTACLE_MODELS).map((spec) => spec.url),
  ...PINE_MODELS.map((spec) => spec.url),
];
