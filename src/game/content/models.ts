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
import rockTallCUrl from '@/assets/models/rock_tallC.glb';
import rockTallDUrl from '@/assets/models/rock_tallD.glb';
import rockTallGUrl from '@/assets/models/rock_tallG.glb';
import rockTallIUrl from '@/assets/models/rock_tallI.glb';
import snowPileUrl from '@/assets/models/snow-pile.glb';
import treeSnowAUrl from '@/assets/models/tree-snow-a.glb';
import treeSnowBUrl from '@/assets/models/tree-snow-b.glb';
import treeSnowCUrl from '@/assets/models/tree-snow-c.glb';
import type { ObstacleKind } from '@/game/content/obstacles';
import type { ModelSpec } from '@/game/render/useModel';

/**
 * The boulder's fit, shared by every variant.
 *
 * Fitted by height, since the height is what makes this un-jumpable and
 * therefore a dodge. Cooled towards slate, because the Nature Kit rocks are
 * sandy brown and read as desert against an alpine sky.
 */
const BOULDER_FIT = {
  fitHeight: 3.0,
  recolor: { color: '#8d9aa5', amount: 0.72 },
} as const;

/**
 * Every collider in this game is ground-aligned (its base sits at y = 0), and
 * so is every prepared model, which is why instances can be placed at y = 0.
 *
 * The value is a list because a kind may have several interchangeable models -
 * see the boulder. A kind with one look is a list of one rather than a special
 * case, so nothing downstream has to handle both shapes.
 */
export const OBSTACLE_MODELS: Partial<Record<ObstacleKind, readonly ModelSpec[]>> = {
  // Collider 1.8 x 0.7 x 1.0. Fitted per axis: the raw pile is twice as deep as
  // its collider, and a drift reads the same whatever its depth.
  drift: [{ url: snowPileUrl, textured: true, fitBox: [1.9, 0.7, 1.2] }],
  // Collider 1.8 x 0.8 x 0.7; the model already lies across the track. Left
  // brown - a bare log is one of the few warm things that belongs in snow.
  log: [{ url: logLargeUrl, fitWidth: 1.9 }],

  /*
   * Collider 1.7 x 3.0 x 1.4.
   *
   * Four of the Nature Kit's ten `rock_tall` models, and only four: fitted to a
   * 3 m height the other six come out between 2.3 and 3.1 m wide, against a
   * 1.7 m collider. A rock that wide either reaches into the neighbouring lane
   * or teaches a hitbox that is not there, and `tests/models.test.ts` rejects
   * both. These four land within 4% of the collider width.
   *
   * They are interchangeable by design. The variant is chosen per spawn and
   * carries no meaning - a boulder is a boulder however it is shaped, and the
   * player must never have to read which one it is.
   */
  boulder: [
    { url: rockTallDUrl, ...BOULDER_FIT },
    { url: rockTallCUrl, ...BOULDER_FIT },
    { url: rockTallGUrl, ...BOULDER_FIT },
    { url: rockTallIUrl, ...BOULDER_FIT },
  ],
};

/**
 * Resolves an obstacle's style roll to one of `count` art variants.
 *
 * Floor of a [0, 1) roll rather than a modulo of an integer, so the split stays
 * exactly even whatever `count` is - `% 3` over a byte favours two of the three.
 * The clamp only catches a roll of exactly 1, which `Rng.next` never returns but
 * a hand-written test might.
 */
export function variantIndex(style: number, count: number): number {
  if (count <= 1) return 0;
  return Math.min(count - 1, Math.max(0, Math.floor(style * count)));
}

/**
 * Decorrelated rolls out of the single style value.
 *
 * The variant, the angle, the size and the tint all come from one stored float,
 * and reusing it directly would tie them together - the tall thin rock would
 * always be the dark one, always at the same angle, and the track would look
 * *more* patterned than before rather than less. A hash per use breaks that.
 */
function hash01(style: number, salt: number): number {
  let h = Math.imul((style * 0xffffffff) | 0, 0x9e3779b9) ^ Math.imul(salt, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/**
 * Per-instance variation, for kinds where a rotated or resized copy still reads
 * as the same instruction.
 *
 * Only the boulder. A log lies across the track and a chalet faces the player -
 * turning either one breaks what it is telling you to do. A rock has no correct
 * orientation, which is exactly why it can take this and they cannot.
 *
 * This is the part that actually stops boulders looking repetitive. Four models
 * shown at one angle and one size still read as one rock at speed; the same
 * four turned and sized differently do not.
 */
export const OBSTACLE_JITTER: Partial<Record<ObstacleKind, true>> = { boulder: true };

/** Free rotation about the vertical. A rock has no front. */
export function styleAngle(style: number): number {
  return hash01(style, 1) * Math.PI * 2;
}

/**
 * Uniform scale, and never below 1.
 *
 * Art smaller than its collider kills the player in what looks like clear air -
 * the asymmetry `tests/models.test.ts` is built around - so this only ever
 * grows a rock. The ceiling is what keeps a turned boulder from reaching the
 * lane beside it; `models.test.ts` checks the worst case that allows.
 */
export const MAX_STYLE_SCALE = 1.15;

export function styleScale(style: number): number {
  return 1 + hash01(style, 2) * (MAX_STYLE_SCALE - 1);
}

/**
 * A brightness multiplier on the baked vertex colours, so a row of rocks is not
 * one flat grey. Centred on 1, and gentle: these are the same stone, lit the
 * same way, not different materials.
 */
export function styleTint(style: number): number {
  return 0.87 + hash01(style, 3) * 0.26;
}

/** Snow-laden pines lining the run. */
export const PINE_MODELS: ModelSpec[] = [
  { url: treeSnowAUrl, textured: true, fitHeight: 4.2 },
  { url: treeSnowBUrl, textured: true, fitHeight: 4.8 },
  { url: treeSnowCUrl, textured: true, fitHeight: 3.8 },
];

/** Everything to warm before the first run. */
export const ALL_MODEL_URLS: string[] = [
  ...Object.values(OBSTACLE_MODELS).flatMap((specs) => specs.map((spec) => spec.url)),
  ...PINE_MODELS.map((spec) => spec.url),
];
