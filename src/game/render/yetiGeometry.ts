/**
 * Builds the yeti's meshes.
 *
 * Two constraints shape this.
 *
 * **The camera is behind the player.** We see the yeti's back for practically
 * the whole run, so the detail budget goes on what is visible from there - a
 * shaggy shoulder silhouette, ears, a goggle strap banding the back of the
 * skull, a trailing scarf, mitts and boots. There is a face, because a ramp
 * flight spins the character far enough round to show it, but it is not what
 * sells the character.
 *
 * **Draw calls.** three.js issues one call per mesh; it does not batch siblings
 * even when they share a material. A yeti assembled from thirty little meshes
 * would cost thirty calls. So each independently animated part - torso, head,
 * each arm, each leg, board, scarf links - is merged down to a *single*
 * geometry with its colours baked into vertex attributes, and the whole
 * character shares one material. The result is a far denser model than the old
 * capsule-and-spheres one for the same ten draw calls.
 *
 * Geometry is authored in each part's own local space with the pivot at the
 * origin, so the component can rotate a shoulder or a hip directly.
 *
 * Forward is -Z, matching the direction of travel.
 */

import * as THREE from 'three';
import { GLOSS } from '@/game/config/visuals';
import type { CharacterDef } from '@/game/content/characters';
import type { SkinDef } from '@/game/content/skins';
import { assemble, vertexColorMaterial, type Piece } from '@/game/render/mergeParts';

/**
 * A ring of cones pointing outward and down.
 *
 * This is what makes the silhouette read as fur rather than as a smooth
 * capsule, and it is the single most important thing separating "yeti" from
 * "snowman" at the size the player actually sees.
 */
function furRing(
  count: number,
  radius: number,
  y: number,
  size: number,
  length: number,
  color: string,
  tilt: number,
): Piece[] {
  return Array.from({ length: count }, (_, i) => {
    const angle = (i / count) * Math.PI * 2;
    // Deterministic but irregular length and tilt. A ring of identical cones
    // reads as machined plating rather than fur - the variation is the whole
    // point, and it has to be stable so the model does not shimmer.
    const wobble = Math.sin(i * 2.399) * 0.5 + Math.sin(i * 5.117) * 0.5;
    const scale = 1 + wobble * 0.32;

    return {
      geometry: new THREE.ConeGeometry(size, length * scale, 4),
      color,
      // Cones point +Y by default; rotate them to splay outward and down.
      rotation: [tilt + wobble * 0.16, -angle, 0] as [number, number, number],
      position: [Math.sin(angle) * radius, y, Math.cos(angle) * radius] as [number, number, number],
    };
  });
}

export interface YetiParts {
  board: THREE.BufferGeometry;
  torso: THREE.BufferGeometry;
  head: THREE.BufferGeometry;
  arm: THREE.BufferGeometry;
  leg: THREE.BufferGeometry;
  scarf: THREE.BufferGeometry;
  material: THREE.MeshPhongMaterial;
  /**
   * Releases every GPU resource this rig owns.
   *
   * three does not free buffers or programs on garbage collection - dropping
   * the last reference to a geometry leaks it. `Player` rebuilds the whole rig
   * whenever the equipped character or board changes, and because `App` is the
   * router's root route the Canvas survives every navigation, so the shop -
   * five riders against five boards, and the screen players idle on longest -
   * could strand a couple of dozen complete rigs on the GPU in one visit.
   */
  dispose(): void;
}

/** Where each part hangs off its parent, in the parent's local space. */
export const YETI_JOINTS = {
  board: [0, 0.07, 0],
  /**
   * Hips. Everything above the board hangs from here, and the height is set so
   * the boots land on the deck rather than floating over it or sinking in.
   */
  hips: [0, 0.55, 0],
  /** Neck, in torso space. */
  neck: [0, 0.78, 0],
  /**
   * Shoulders, in torso space.
   *
   * Left square across the body on purpose. The stance yaw lives on the *torso
   * group* in `Player`, so these rotate with it and the shoulder line already
   * comes round to sit along the board; biasing them fore and aft here as well
   * would apply the same rotation twice and leave the rider wound up.
   */
  shoulderLeft: [-0.38, 0.58, 0],
  shoulderRight: [0.38, 0.58, 0],
  /**
   * Hip sockets, in torso space - one foot forward, one back.
   *
   * They used to be `[-0.16, 0, 0]` and `[0.16, 0, 0]`: feet side by side
   * across the *narrow* axis of a 0.54 x 1.86 m snowboard, which is how you
   * stand on a skateboard. It was in every frame of every run, and it is why
   * the camera looked at a flat back - a rider standing along their board is
   * what produces a three-quarter silhouette from behind.
   *
   * Small in X and large in Z because the torso's `stanceYaw` swings them
   * further round again: at 0.45 rad these land at roughly (0.05, 0.33) and
   * (-0.05, -0.33), so the boots sit close to the board's centreline about
   * 0.66 m apart, which is a real stance for a board this long.
   */
  hipLeft: [-0.1, 0, 0.32],
  hipRight: [0.1, 0, -0.32],
  /** Where the scarf is knotted, in torso space. */
  scarf: [0, 0.7, 0.1],
} as const;

/** Length of one scarf link, so the component can chain them. */
export const SCARF_LINK_LENGTH = 0.3;

/** Overall size of the figure above the board. Tuned against the collider. */
export const FIGURE_SCALE = 0.92;

/**
 * Resting knee bend while riding, in radians.
 *
 * Lives here rather than in `Player` because it is the pitch `FOOT_REACH` below
 * is measured at, and the two drifting apart is exactly the failure that
 * constant exists to prevent.
 */
export const RIDING_LEG_PITCH = 0.3;

/**
 * Distance from the hip pivot down to the sole, in torso-local units.
 *
 * The legs hang off the torso group, so scaling that group vertically - which
 * is how a crouch, a landing fold and a take-off extension are all expressed -
 * scales them about the *hips*. Squashing the figure therefore lifts its boots
 * off a deck that has not moved, instead of dropping its hips towards them.
 *
 * It was already visible: a slide crouches to 0.425 and left the boots 28 cm
 * above the board for the whole 0.7 s of it. `hipHeightFor` cancels it out.
 *
 * 0.50 from the hip socket to the underside of the boot, times the cosine of
 * the riding knee bend. One number for every pose deliberately - a slide
 * reaches 0.45 and an air tuck 0.38 - because tracking it exactly would move
 * the hips every time the knees did, which is a far more visible error than the
 * centimetre it would save.
 */
export const FOOT_REACH = 0.5 * Math.cos(RIDING_LEG_PITCH);

/**
 * Where the hips sit for a given vertical squash, so the soles stay on the deck.
 *
 * Zero correction at rest, since `scaleY` is `FIGURE_SCALE` there and the term
 * cancels - the figure is only moved when it is actually being squashed.
 */
export function hipHeightFor(scaleY: number): number {
  return YETI_JOINTS.hips[1] + FOOT_REACH * (scaleY - FIGURE_SCALE);
}

/**
 * Builds the rider and the board they are standing on.
 *
 * Two sources on purpose. The character owns everything above the deck and the
 * board owns the deck - which is the split that stopped buying a snowboard from
 * changing the colour of the yeti riding it.
 */
export function buildYeti(character: CharacterDef, skin: SkinDef): YetiParts {
  const { fur, furShade, face, accent, garment, garmentTrim } = character;
  const { board, boardTrim } = skin;

  // --- Board -------------------------------------------------------------
  const boardGeometry = assemble([
    { geometry: new THREE.BoxGeometry(0.54, 0.07, 1.86), color: board },
    // Rails, so the deck has an edge to catch the light rather than reading
    // as a single flat slab.
    {
      geometry: new THREE.BoxGeometry(0.035, 0.05, 1.8),
      color: boardTrim,
      position: [-0.27, 0.005, 0],
    },
    {
      geometry: new THREE.BoxGeometry(0.035, 0.05, 1.8),
      color: boardTrim,
      position: [0.27, 0.005, 0],
    },
    {
      geometry: new THREE.BoxGeometry(0.32, 0.018, 1.15),
      color: boardTrim,
      position: [0, 0.042, 0.05],
    },
  ]);

  // --- Torso -------------------------------------------------------------
  const torsoGeometry = assemble([
    // Hips into a barrel chest: the taper is what gives the character a
    // heavyweight, top-loaded build rather than a uniform tube.
    {
      geometry: new THREE.SphereGeometry(0.26, 10, 8),
      color: fur,
      scale: [1, 0.8, 0.92],
      position: [0, 0.02, 0],
    },
    {
      geometry: new THREE.CapsuleGeometry(0.28, 0.36, 3, 10),
      color: fur,
      position: [0, 0.32, 0],
    },
    {
      geometry: new THREE.SphereGeometry(0.32, 10, 8),
      color: fur,
      scale: [1.28, 0.86, 0.88],
      position: [0, 0.56, 0],
    },
    // Paler belly, on the front where the ramp spin reveals it.
    {
      geometry: new THREE.SphereGeometry(0.19, 8, 8),
      color: furShade,
      scale: [1, 1.2, 0.7],
      position: [0, 0.3, -0.19],
    },
    {
      geometry: new THREE.CylinderGeometry(0.15, 0.17, 0.14, 8),
      color: fur,
      position: [0, 0.74, 0],
    },
    // Scarf knot. Part of the torso rather than the scarf chain, because it
    // does not move relative to the neck - and the chain geometry is shared by
    // every link, so a knot there would appear three times.
    {
      geometry: new THREE.BoxGeometry(0.3, 0.13, 0.26),
      color: accent,
      position: [0, 0.71, 0.03],
    },
    /*
     * The garment.
     *
     * Four pieces, about three hundred triangles, and zero draw calls: this is
     * merged into the same torso geometry as everything above it, so the only
     * thing it costs is vertices on a part that already merges forty-odd cones.
     *
     * It is here rather than on the fur because the rider had no dark value
     * anywhere - the goggle band was the single sub-0.6 surface on the whole
     * model - and a near-white figure on a near-white slope has no silhouette.
     * Darkening the coat instead reads as a filthy animal; a gilet, a harness
     * and a belt read as a snowboarder.
     *
     * Every piece sits on or wraps around to the +Z side, because the camera is
     * behind the rider and +Z is the face it sees for the entire run. The
     * straps in particular are an X across the *back*: on the chest they would
     * be visible for the half-second of a ramp spin and nowhere else.
     */
    {
      // Gilet shell. A hair proud of the 0.28 chest capsule so it reads as worn
      // over the fur, and short enough that both ruffs still burst out above
      // and below it - fur through the armholes is what stops it looking like
      // the yeti has simply been painted navy.
      geometry: new THREE.SphereGeometry(0.31, 10, 8),
      color: garment,
      scale: [1.03, 0.72, 0.95],
      position: [0, 0.36, 0.01],
    },
    // Harness, crossed over the shoulder blades. Two straps rather than one
    // because a single diagonal reads as a rendering seam at 150 px, and a
    // crossed pair reads as webbing.
    {
      geometry: new THREE.BoxGeometry(0.075, 0.66, 0.07),
      color: garmentTrim,
      rotation: [0, 0, 0.62],
      position: [0, 0.38, 0.245],
    },
    {
      geometry: new THREE.BoxGeometry(0.075, 0.66, 0.07),
      color: garmentTrim,
      rotation: [0, 0, -0.62],
      position: [0, 0.38, 0.245],
    },
    {
      // Waist belt, above the skirt ring so the fur hangs below it rather than
      // through it. Major radius 0.3 against a 0.28 waist, so it stands out.
      geometry: new THREE.TorusGeometry(0.3, 0.05, 5, 14),
      color: garmentTrim,
      rotation: [Math.PI / 2, 0, 0],
      position: [0, 0.13, 0],
    },
    // Shoulder ruff, a second shorter layer under it, and a skirt at the waist.
    // Layering two rings at different radii is what turns a spiky outline into
    // something that reads as depth of fur.
    ...furRing(13, 0.34, 0.55, 0.075, 0.3, furShade, Math.PI * 0.6),
    ...furRing(11, 0.3, 0.42, 0.065, 0.22, fur, Math.PI * 0.72),
    ...furRing(10, 0.27, 0.08, 0.07, 0.26, furShade, Math.PI * 0.86),
  ]);

  // --- Head --------------------------------------------------------------
  const headGeometry = assemble([
    {
      geometry: new THREE.SphereGeometry(0.29, 12, 10),
      color: fur,
      scale: [1, 0.96, 1.02],
      position: [0, 0.24, 0],
    },
    // Brow and muzzle, forward of centre.
    {
      geometry: new THREE.BoxGeometry(0.46, 0.1, 0.16),
      color: furShade,
      position: [0, 0.32, -0.2],
    },
    {
      geometry: new THREE.SphereGeometry(0.15, 8, 8),
      color: furShade,
      scale: [1.05, 0.8, 1.15],
      position: [0, 0.13, -0.23],
    },
    { geometry: new THREE.SphereGeometry(0.05, 6, 6), color: face, position: [0, 0.17, -0.35] },
    { geometry: new THREE.SphereGeometry(0.045, 6, 6), color: face, position: [-0.1, 0.26, -0.25] },
    { geometry: new THREE.SphereGeometry(0.045, 6, 6), color: face, position: [0.1, 0.26, -0.25] },
    // Ears, which give the back of the head a silhouette of its own.
    {
      geometry: new THREE.SphereGeometry(0.085, 7, 6),
      color: furShade,
      scale: [0.55, 1, 0.95],
      position: [-0.28, 0.35, -0.02],
    },
    {
      geometry: new THREE.SphereGeometry(0.085, 7, 6),
      color: furShade,
      scale: [0.55, 1, 0.95],
      position: [0.28, 0.35, -0.02],
    },
    // Goggles. The strap bands the back of the skull, which is the one piece
    // of costume the camera sees for the entire run.
    {
      geometry: new THREE.TorusGeometry(0.285, 0.04, 5, 16),
      color: accent,
      rotation: [Math.PI / 2, 0, 0],
      position: [0, 0.29, 0],
    },
    {
      geometry: new THREE.BoxGeometry(0.38, 0.13, 0.1),
      color: face,
      position: [0, 0.29, -0.23],
    },
    // Tufts on the crown, and a shaggy fringe round the jaw.
    ...furRing(7, 0.15, 0.46, 0.06, 0.22, furShade, 0),
    ...furRing(9, 0.27, 0.11, 0.055, 0.18, furShade, Math.PI * 0.78),
  ]);

  // --- Arm (pivots at the shoulder, hangs down -Y) ------------------------
  const armGeometry = assemble([
    {
      geometry: new THREE.CapsuleGeometry(0.11, 0.2, 3, 8),
      color: furShade,
      position: [0, -0.14, 0],
    },
    ...furRing(5, 0.11, -0.27, 0.06, 0.16, furShade, Math.PI * 0.72),
    {
      geometry: new THREE.CapsuleGeometry(0.095, 0.17, 3, 8),
      color: furShade,
      position: [0, -0.37, 0],
    },
    {
      geometry: new THREE.SphereGeometry(0.12, 8, 7),
      color: fur,
      scale: [1, 1.1, 0.9],
      position: [0, -0.52, 0],
    },
  ]);

  // --- Leg (pivots at the hip) -------------------------------------------
  const legGeometry = assemble([
    { geometry: new THREE.CapsuleGeometry(0.13, 0.14, 3, 8), color: fur, position: [0, -0.12, 0] },
    {
      geometry: new THREE.CapsuleGeometry(0.11, 0.12, 3, 8),
      color: furShade,
      position: [0, -0.3, 0],
    },
    // Boot and binding, in the board's colours so the rider reads as kitted out.
    {
      geometry: new THREE.BoxGeometry(0.22, 0.14, 0.34),
      color: board,
      position: [0, -0.43, -0.02],
    },
    {
      geometry: new THREE.BoxGeometry(0.24, 0.045, 0.09),
      color: boardTrim,
      position: [0, -0.39, -0.08],
    },
  ]);

  // --- Scarf link (pivots at its front edge, trails towards +Z) -----------
  const scarfGeometry = assemble([
    {
      geometry: new THREE.BoxGeometry(0.21, 0.075, SCARF_LINK_LENGTH),
      color: accent,
      position: [0, 0, SCARF_LINK_LENGTH / 2],
    },
  ]);

  // Fur, not lacquer. The body is mostly fur and reads wrong with a prop-strength
  // highlight; the board's own gloss comes from its colours being brighter, not
  // from a second material, since one material is what keeps this a single
  // draw call per part.
  const material = vertexColorMaterial(GLOSS.fur);

  const parts: YetiParts = {
    board: boardGeometry,
    torso: torsoGeometry,
    head: headGeometry,
    arm: armGeometry,
    leg: legGeometry,
    scarf: scarfGeometry,
    material,
    dispose: () => {
      // Walked off the returned object rather than listed a second time here.
      // A hand-written list is a list that drifts: the garment above came
      // within an inch of being its own seventh part, and had it been, nothing
      // would have reported the leak. Enumerating means a part that exists is a
      // part that gets released, by construction.
      for (const value of Object.values(parts)) {
        if (value instanceof THREE.BufferGeometry || value instanceof THREE.Material) {
          value.dispose();
        }
      }
    },
  };

  return parts;
}
