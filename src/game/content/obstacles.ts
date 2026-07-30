/**
 * Obstacle definitions.
 *
 * Each kind declares the single action that clears it, plus the collider that
 * makes that action the *only* one that works. Those two things must agree, or
 * the player learns a rule the game then breaks - so `tests/obstacles.test.ts`
 * simulates a real jump and a real slide against every kind and asserts the
 * declared action is the one that gets through.
 *
 * Geometry here is placeholder boxes. M2 swaps the meshes; the colliders stay.
 *
 * ## Colour is a fairness constraint, not decoration
 *
 * Sampled against the snow beside them in a running build, a **drift read 3.2
 * display luminance levels above the piste and a boulder 8.0**, where the log
 * reads 63 *below* it. Two of the eight kinds were therefore invisible until
 * they were close enough to be unavoidable. That is a fairness defect before it
 * is a flatness one: the player cannot see what is about to kill them.
 *
 * Neither is fixable by size. The collider numbers below are frozen - they are
 * what the action tests are proved against - and per the working agreement
 * per-instance art scale may only ever *grow*, because art smaller than its
 * hitbox kills the player in visibly clear air. So the fix is value and hue, and
 * only value and hue.
 *
 * ### The run is the only reference, and the run has moved
 *
 * Both numbers were measured against the piste as it then was, near-white. It is
 * not that any more: `PALETTE.piste` came down ten points of value in the same
 * pass. Modelled through the real Phong terms, the real hemisphere and ACES at
 * `ATMOSPHERE.exposure`, the groomed surface now renders between **L=98 and
 * L=171 with a median of 142** - the band profile, the across-track gradient and
 * the corduroy albedo together. Escaping *that* range is the whole job, and it
 * is why nothing here is chosen against another obstacle.
 *
 * Down is where most of the room is, because snow and a near-white obstacle both
 * sit in the ACES shoulder where the curve compresses hardest - the mechanical
 * reason an albedo 40% above the run's arrived three levels above it. But down
 * has a hard floor at `PATROL.liveryFloor`: a camera-facing face receives
 * neither the key nor the sun, only the fill and the hemisphere, so an albedo
 * whose brightest channel falls much below 0.44 renders as a hole rather than as
 * a dark surface. One kind goes the other way, and the drift's note says why.
 *
 * ### Nothing reads `color`, and that is the defect behind both numbers
 *
 * `Obstacles.tsx` reads it in `BoxObstacleLayer` alone, and **no kind reaches
 * that path**: all eight have either a model in `content/models.ts` or a builder
 * in `render/propGeometry.ts`, and each of those restates its own colour. So
 * this file has never been what is on screen, which is how a whole palette pass
 * moved two hexes and changed neither obstacle.
 *
 * The two ends are pulled together from here rather than by deleting the field.
 * `tests/ground.test.ts` now requires a *recoloured* model to target the value
 * written here, at full strength - the boulder is the one that fails, and fixing
 * it is a change in `content/models.ts`. The prop builders keep their own
 * multi-part palettes, because a chalet is timber, plaster, roof and window and
 * has no single colour; for those kinds this is the value the read has to land
 * on, and the test measures the baked geometry rather than trusting a hex.
 */

/** The one action that gets the player past an obstacle. */
export type ClearAction = 'jump' | 'slide' | 'dodge';

export interface ObstacleDef {
  /** Height of the collider centre above the snow. */
  centreY: number;
  halfWidth: number;
  halfHeight: number;
  halfDepth: number;
  action: ClearAction;
  /**
   * The kind's authoritative art value and hue - an albedo, not a pixel.
   *
   * See the legibility note in the file header before changing one. These are
   * chosen against the *run's* value range rather than against each other, so a
   * kind that stops separating from the snow is a change here and not a change
   * to how big it is.
   */
  color: string;
  /** Visual box size; may differ from the collider, which is authoritative. */
  visual: { width: number; height: number; depth: number };
}

export const OBSTACLES = {
  /**
   * Snow drift - low and wide. Jump it. Deliberately shallow so the jump
   * timing window is generous; this is the first obstacle a player meets.
   *
   * The hardest kind in the game to make legible, because it is the *same
   * material as the ground*: every other obstacle can be told apart by what it
   * is made of and this one cannot. It is the +3.2 in the header, and the first
   * obstacle a player meets was the one they could not see.
   *
   * **The fix was the ground, and the drift stays snow.** The round before this
   * one took it to a mid-grey `#6d8598` - "wind-packed snow in its own shade" -
   * on the argument that white on white has no silhouette. That was true of the
   * near-white run it was measured against and is false of the run that now
   * exists, and the measurement is not close. `snow-pile.glb` samples three
   * atlas swatches, `#e1f1fb`, `#c6e3f7` and `#f7fbfe`; through the rig their
   * sunward flanks render between L=193 and L=208, which is 22 to 36 levels
   * above the *brightest* the run ever gets and about 60 above its median.
   * `#6d8598` renders at 109, inside 98-171: lighter than the run on a scoured
   * band and darker on a packed one, which is not a read but a coin flip - the
   * exact failure the mid-grey was chosen to avoid, arriving from the other
   * side. In the albedo terms `tests/ground.test.ts` measures it is starker
   * still: this clears the run's rendered band by 0.21 and the mid-grey by
   * 0.004.
   *
   * This is the atlas's dominant swatch, **recorded rather than imposed**. A
   * textured model takes its colour from the atlas and nothing can override it,
   * so writing the same number here is what lets the test fail if the surface is
   * ever taken back up towards it.
   *
   * Near-white is only safe because a drift is only ever *on the run*. The outer
   * lane sits at 2.2 and the drift is 0.9 either side of it, so its widest reach
   * is 3.1 against a piste edge at 4.6 - it never touches the untouched field,
   * which runs 0.84 to 0.93 and would swallow it whole.
   */
  drift: {
    centreY: 0.35,
    halfWidth: 0.9,
    halfHeight: 0.35,
    halfDepth: 0.5,
    action: 'jump',
    color: '#e1f1fb',
    visual: { width: 1.8, height: 0.7, depth: 1.0 },
  },

  /** Fallen log. Jump it. Same action as a drift, different read. */
  log: {
    centreY: 0.4,
    halfWidth: 0.9,
    halfHeight: 0.4,
    halfDepth: 0.35,
    action: 'jump',
    color: '#6b4f37',
    visual: { width: 1.8, height: 0.8, depth: 0.7 },
  },

  /**
   * Solid rock. The body of a cave mouth, and impassable.
   *
   * Authored with a `span` so one entry becomes a continuous massif across
   * however many lanes it covers - and the lane it does *not* cover is the way
   * in. That is the whole mechanic: a wall across the piste with exactly one
   * gap, which asks nothing except being in the right place, early.
   *
   * Ten metres deep, so it is a passage rather than a doorway. The first version
   * was a single cube: the player crossed a threshold and was out the other side
   * in a frame, which read as a wall with a hole in it rather than as anything
   * you went *through*. At the speeds this game runs, a tunnel needs real length
   * before it registers as one at all.
   *
   * The roof over the open lane is part of *this* prop's geometry rather than an
   * obstacle of its own, which is what lets the passage be covered without
   * anything standing in the way. Nothing is ducked here: the way through is
   * clear from the snow to well above the top of a jump, so a tunnel asks for a
   * lane and nothing else. That makes it an alpine avalanche gallery rather than
   * a cave mouth, which is the shape this actually wanted to be - a low roof and
   * a required slide made it a second banner wearing a rock texture.
   *
   * A full lane wide, so segments in adjacent lanes butt together with no seam.
   * Taller than a jump on purpose: a rock face that can be cleared by jumping
   * would make the entrance decorative, and the read has to be "there is one way
   * through" rather than "there is one easy way through".
   */
  tunnelRock: {
    centreY: 2.4,
    halfWidth: 1.1,
    halfHeight: 2.4,
    halfDepth: 5.0,
    action: 'dodge',
    color: '#6d7683',
    visual: { width: 2.2, height: 4.8, depth: 10 },
  },

  /**
   * Slalom gantry strung across the lane. Slide under it.
   *
   * It extends well above the top of a jump on purpose. An overhead barrier
   * that can also be jumped makes sliding optional, and a mechanic the player
   * can ignore is one they never learn - so the underside sits below a
   * standing player and the top sits above a jumping one, leaving exactly one
   * way through.
   */
  banner: {
    centreY: 2.0,
    halfWidth: 0.9,
    halfHeight: 1.0,
    halfDepth: 0.2,
    action: 'slide',
    color: '#e8663c',
    visual: { width: 1.8, height: 2.0, depth: 0.4 },
  },

  /** Snow-laden pine bough. Slide under it. Same rule as the gantry. */
  branch: {
    centreY: 2.1,
    halfWidth: 0.85,
    halfHeight: 1.05,
    halfDepth: 0.35,
    action: 'slide',
    color: '#2f6b4f',
    visual: { width: 1.7, height: 2.1, depth: 0.7 },
  },

  /**
   * Boulder. Tall enough that the top clears the player even at the peak of a
   * jump, so the only answer is to change lane. That height is not decorative -
   * it is what makes this a dodge rather than a badly tuned jump.
   *
   * Taken from `#8d9aa5` to a genuine wet slate, a third of the way down the
   * range rather than two thirds up it. The old value was chosen to cool the
   * Nature Kit's sandy rock towards alpine grey and it did that, but it left the
   * albedo at 60% - which measured 8 levels *above* the snow, so the one
   * obstacle the player must change lane for was the one that vanished into it.
   *
   * Dark is also simply what the reference looks like: rock standing out of a
   * snowfield is the strongest value contrast in a real alpine frame, and this
   * game had thrown that away. It sits a hair above `PATROL.liveryFloor`, which
   * is the darkest an albedo may be here before a camera-facing face renders as
   * a hole - the boulder is the one obstacle where that limit binds, and it is
   * the reason this is slate and not black.
   *
   * **This is still not what is drawn, and it is the live half of the +8.0.**
   * `BOULDER_FIT.recolor` in `content/models.ts` lerps the rock towards
   * `#8d9aa5` by 0.72, and the rock's body material is `_defaultMat`, pure
   * white - so 28% white survives and the body renders at L=170 against a run
   * whose maximum is 171. Pointed at this hex the same partial lerp lands at
   * 147, still inside the run; taken to the full strength the word "recolour"
   * implies it lands at 71, which is 27 clear below the darkest snow on the
   * slope and still lighter than the log at 58. A partial lerp off a white base
   * material is exactly how a slate boulder arrived on screen as bright snow,
   * which is why `tests/ground.test.ts` now asks for both the target and the
   * amount.
   */
  boulder: {
    centreY: 1.5,
    halfWidth: 0.85,
    halfHeight: 1.5,
    halfDepth: 0.7,
    action: 'dodge',
    color: '#556472',
    visual: { width: 1.7, height: 3.0, depth: 1.4 },
  },

  /**
   * Alpine chalet. Far too tall to jump - the only ways past are to change
   * lane or to hit the ramp in front of it and fly over the roof.
   *
   * It is still declared a `dodge` so the solvability check treats its lane as
   * simply blocked. The ramp is a reward route, never the required answer, and
   * validating it as such keeps the guarantee conservative.
   */
  chalet: {
    centreY: 2.2,
    halfWidth: 1.0,
    halfHeight: 2.2,
    halfDepth: 1.6,
    action: 'dodge',
    color: '#b9603f',
    visual: { width: 2.4, height: 4.4, depth: 3.2 },
  },

  /**
   * A stacked woodpile under a plank roof, of the kind that stands against
   * every chalet in an alpine village.
   *
   * The same dodge role as the boulder, read as something built rather than
   * something natural - and warm, which matters: two of the three dodges are
   * cold grey and blue, and an obstacle the player has a fifth of a second to
   * spot should not have to be picked out of a snowfield by silhouette alone.
   *
   * It replaced an ice wall, which was a cube of stone stretched to fit and
   * tinted blue, and read as exactly that: a flat blue rectangle.
   */
  woodpile: {
    centreY: 1.6,
    halfWidth: 0.95,
    halfHeight: 1.6,
    halfDepth: 0.4,
    action: 'dodge',
    color: '#8a5a3c',
    visual: { width: 1.9, height: 3.2, depth: 0.8 },
  },
} as const satisfies Record<string, ObstacleDef>;

export type ObstacleKind = keyof typeof OBSTACLES;

export const OBSTACLE_KINDS = Object.keys(OBSTACLES) as ObstacleKind[];

export function obstacleDef(kind: ObstacleKind): ObstacleDef {
  return OBSTACLES[kind];
}

/** Every kind that is cleared by the given action. */
export function kindsWithAction(action: ClearAction): ObstacleKind[] {
  return OBSTACLE_KINDS.filter((kind) => OBSTACLES[kind].action === action);
}
