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
  color: string;
  /** Visual box size; may differ from the collider, which is authoritative. */
  visual: { width: number; height: number; depth: number };
}

export const OBSTACLES = {
  /**
   * Snow drift - low and wide. Jump it. Deliberately shallow so the jump
   * timing window is generous; this is the first obstacle a player meets.
   */
  drift: {
    centreY: 0.35,
    halfWidth: 0.9,
    halfHeight: 0.35,
    halfDepth: 0.5,
    action: 'jump',
    color: '#e2eef6',
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
   * A jib bar: a steel rail set across the piste on low posts.
   *
   * Mechanically a jumpable, and that is what the solvability check sees. What
   * makes it its own thing is that landing *on* it pays - see `crossbarTap` in
   * `systems/simulation.ts`. Clearing it high is safe and free; clipping the top
   * of your arc off it is worth coins, which is the whole point of a jib.
   *
   * Its span is authored per chunk rather than fixed, so one may cross a single
   * lane or the whole piste (see `span` in `content/chunks.ts`). A crossbar is
   * laid as one obstacle per lane it covers, which is what lets every existing
   * system - solvability, pacing, mirroring, collision - handle it unchanged.
   *
   * Sits low. It has to be clearable by an ordinary jump from any point in the
   * run-up, and the top has to be somewhere an arc can plausibly touch, or
   * landing on it would be luck rather than timing.
   */
  crossbar: {
    centreY: 0.55,
    halfWidth: 1.1,
    halfHeight: 0.55,
    halfDepth: 0.22,
    action: 'jump',
    color: '#9fb0bd',
    visual: { width: 2.2, height: 1.1, depth: 0.44 },
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
   */
  boulder: {
    centreY: 1.5,
    halfWidth: 0.85,
    halfHeight: 1.5,
    halfDepth: 0.7,
    action: 'dodge',
    color: '#8d9aa5',
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
