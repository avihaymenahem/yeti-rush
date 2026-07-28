/**
 * Procedurally built obstacles.
 *
 * These are the kinds no model in either CC0 kit fits. A chalet needs to be
 * exactly the size of its collider and read as a building at a glance; the two
 * overhead barriers need to read as "duck under this" in a fifth of a second,
 * and nothing in the kits does.
 *
 * Each kind merges to one vertex-coloured geometry, so however much detail goes
 * in, every chalet on the track still draws in a single instanced call.
 *
 * Everything is authored ground-aligned - the base sits at y = 0 - matching the
 * colliders and the prepared GLB models, so the renderer places all obstacles
 * the same way.
 *
 * Facing: the camera sits at positive z and looks down the negative axis, and
 * obstacles arrive from negative z. So the face the player sees is the one at
 * **+z**, and any detail that only reads from one side belongs there. The
 * chalet had its windows and door on the -z face and presented the player with
 * a blank wall for the entire life of the project.
 */

import * as THREE from 'three';
import { LANES, TUNING } from '@/game/config/tuning';
import { obstacleDef } from '@/game/content/obstacles';
import { assemble, prism, wedge, type Piece } from '@/game/render/mergeParts';

const COLORS = {
  timber: '#9a5f36',
  timberDark: '#67391f',
  plaster: '#e8d9c3',
  roof: '#4a5a68',
  snow: '#fdf3e4',
  window: '#ffcd63',
  banner: '#f45c31',
  bannerTrim: '#f7fbfe',
  post: '#7d5029',
  bough: '#63452e',
  needle: '#2b8452',
  /** Split logs: bark, and the pale sawn face the player actually sees. */
  bark: '#98632f',
  barkLight: '#b28243',
  cut: '#e0bb8c',
  cutLight: '#f0d5ae',
  /** Groomed take-off snow, a shade off the piste so the ramp reads as built. */
  packedSnow: '#eaf3fa',
  rampTimber: '#8a552b',
  /** Chevrons. Warm against a cold slope, so they carry at distance. */
  rampMark: '#ffa724',
  /** Coin: a darker struck rim, a brighter recessed face, and the mark on it. */
  coinRim: '#c98a1f',
  coinFace: '#ffd35c',
  coinMark: '#8a5a12',
  /** Cave rock: cold grey stone, a darker recess, and the black of the tunnel. */
  tunnelRock: '#6d7683',
  tunnelRockDark: '#4d545e',
  tunnelLip: '#98a3b0',
  tunnelInner: '#3c434d',
  tunnelDeep: '#2b313a',
  tunnelDark: '#171c23',
  /** Grind rail: galvanised steel, a lit top edge, and darker posts. */
  railSteel: '#8d9aa8',
  railShine: '#e6eef6',
  railPost: '#4a5560',
} as const;

/**
 * An alpine chalet.
 *
 * Timber walls, a steep snow-laden gable, lit windows and a chimney. The steep
 * pitch is the silhouette that says "alpine" - a shallow roof reads as a shed.
 * Sized to the 2.4 x 4.4 x 3.2 collider, chimney included.
 */
function buildChalet(): THREE.BufferGeometry {
  const pieces: Piece[] = [
    // Walls, with a plaster band above the timber base.
    { geometry: new THREE.BoxGeometry(2.4, 1.5, 3.0), color: COLORS.timber, position: [0, 0.75, 0] },
    { geometry: new THREE.BoxGeometry(2.36, 0.85, 2.96), color: COLORS.plaster, position: [0, 1.9, 0] },

    // Gable end, filling the triangle under the roof.
    { geometry: prism(2.4, 1.5, 3.0), color: COLORS.timber, position: [0, 2.3, 0] },

    // Roof slabs, leaning along the gable and overhanging the walls. The pitch
    // is atan(1.5 / 1.2), which is the angle the gable prism above defines.
    {
      geometry: new THREE.BoxGeometry(2.2, 0.16, 3.5),
      color: COLORS.roof,
      rotation: [0, 0, 0.896],
      position: [-0.62, 3.06, 0],
    },
    {
      geometry: new THREE.BoxGeometry(2.2, 0.16, 3.5),
      color: COLORS.roof,
      rotation: [0, 0, -0.896],
      position: [0.62, 3.06, 0],
    },
    // Snow lying on the roof, offset up the pitch normal.
    {
      geometry: new THREE.BoxGeometry(2.16, 0.14, 3.46),
      color: COLORS.snow,
      rotation: [0, 0, 0.896],
      position: [-0.72, 3.16, 0],
    },
    {
      geometry: new THREE.BoxGeometry(2.16, 0.14, 3.46),
      color: COLORS.snow,
      rotation: [0, 0, -0.896],
      position: [0.72, 3.16, 0],
    },

    // Lit windows on the approach face, and a door beneath them. At +z: see the
    // facing note at the top of this file.
    { geometry: new THREE.BoxGeometry(0.5, 0.55, 0.1), color: COLORS.window, position: [-0.65, 1.35, 1.52] },
    { geometry: new THREE.BoxGeometry(0.5, 0.55, 0.1), color: COLORS.window, position: [0.65, 1.35, 1.52] },
    { geometry: new THREE.BoxGeometry(0.55, 0.5, 0.1), color: COLORS.window, position: [0, 2.7, 1.35] },
    { geometry: new THREE.BoxGeometry(0.62, 1.05, 0.1), color: COLORS.timberDark, position: [0, 0.52, 1.52] },

    // Chimney, topped with snow. Reaches the top of the collider.
    { geometry: new THREE.BoxGeometry(0.36, 1.0, 0.36), color: COLORS.timberDark, position: [0.72, 3.75, 0.6] },
    { geometry: new THREE.BoxGeometry(0.44, 0.14, 0.44), color: COLORS.snow, position: [0.72, 4.3, 0.6] },
  ];

  return assemble(pieces);
}

/**
 * A slalom banner strung between two posts.
 *
 * The posts sit at the lane edges and the cloth hangs between them, leaving a
 * gap underneath that only a sliding player fits through. The gate silhouette
 * is what makes the required action obvious at speed - the previous flat slab
 * read as a wall, which is the wrong instruction entirely.
 */
function buildBanner(): THREE.BufferGeometry {
  const pieces: Piece[] = [
    { geometry: new THREE.BoxGeometry(0.13, 3.0, 0.13), color: COLORS.post, position: [-0.95, 1.5, 0] },
    { geometry: new THREE.BoxGeometry(0.13, 3.0, 0.13), color: COLORS.post, position: [0.95, 1.5, 0] },
    // Top rail and the cloth hanging from it.
    { geometry: new THREE.BoxGeometry(2.1, 0.14, 0.16), color: COLORS.post, position: [0, 2.95, 0] },
    // The cloth spans the collider exactly, 1.0 to 3.0. A visual that stops
    // short of its hitbox is the unfair direction: the player reads a gap that
    // is not there and dies to apparently clear air.
    { geometry: new THREE.BoxGeometry(1.9, 2.0, 0.09), color: COLORS.banner, position: [0, 2.0, 0] },
    { geometry: new THREE.BoxGeometry(1.9, 0.22, 0.11), color: COLORS.bannerTrim, position: [0, 2.78, 0] },
    { geometry: new THREE.BoxGeometry(1.9, 0.16, 0.11), color: COLORS.bannerTrim, position: [0, 1.14, 0] },
  ];

  // Bunting hanging below the cloth. It sits *under* the hitbox, so it draws
  // the eye to the gap the player has to slide through.
  for (let i = 0; i < 5; i++) {
    pieces.push({
      geometry: new THREE.ConeGeometry(0.13, 0.24, 4),
      color: i % 2 === 0 ? COLORS.bannerTrim : COLORS.banner,
      rotation: [0, Math.PI / 4, Math.PI],
      position: [-0.76 + i * 0.38, 0.9, 0],
    });
  }

  return assemble(pieces);
}

/**
 * A snow-laden pine bough reaching across the run from a trunk at the edge.
 *
 * Same instruction as the banner - slide - but a different read, so the track
 * does not look repetitive. The trunk sits at the lane edge rather than in the
 * middle, or it would look like the lane is blocked rather than overhung.
 */
function buildBranch(): THREE.BufferGeometry {
  const pieces: Piece[] = [
    // Trunk pushed out to the lane edge and kept slim. In the middle of the
    // lane a thick trunk reads as something to steer around, which is the
    // wrong instruction entirely - the answer here is to duck.
    {
      geometry: new THREE.CylinderGeometry(0.14, 0.19, 3.2, 7),
      color: COLORS.bough,
      position: [-0.98, 1.6, 0],
    },
    // The bough itself, running across the lane above head height.
    {
      geometry: new THREE.CylinderGeometry(0.11, 0.15, 1.9, 6),
      color: COLORS.bough,
      rotation: [0, 0, Math.PI / 2],
      position: [0.0, 2.95, 0],
    },
  ];

  // Needles hanging off the bough, and snow piled on top of them. They reach
  // down to the bottom of the collider at y = 1.05: foliage that stops short
  // of the hitbox would kill the player in what looks like clear air.
  for (let i = 0; i < 5; i++) {
    const x = -0.6 + i * 0.32;
    pieces.push({
      geometry: new THREE.ConeGeometry(0.32, 2.0, 5),
      color: COLORS.needle,
      rotation: [0, i * 0.7, Math.PI],
      position: [x, 2.05, 0],
    });
    pieces.push({
      geometry: new THREE.SphereGeometry(0.24, 6, 5),
      color: COLORS.snow,
      scale: [1.15, 0.5, 1.1],
      position: [x, 3.02, 0],
    });
  }

  return assemble(pieces);
}

/**
 * A stacked woodpile under a plank roof.
 *
 * Sawn logs end-on between two uprights, snow on the roof - the woodshed that
 * stands against every chalet in the Alps. Cut faces point at the player,
 * because that is the read: a wall of pale circles is unmistakably solid, and
 * unmistakably not the low log you jump.
 *
 * The stack runs all the way to the roof deliberately. A band of open air
 * partway up would be visible clean through, and a rider coming down off a
 * ramp passes through exactly that height - dying to a gap you can see is the
 * worst thing an obstacle can do.
 *
 * Sized to the 1.9 x 3.2 x 0.8 collider.
 */
function buildWoodpile(): THREE.BufferGeometry {
  const logRadius = 0.19;
  const logLength = 0.86;
  const rows = 8;
  const columns = 4;
  const rowSpacing = 0.36;
  const bottomRow = 0.22;
  const roofY = 2.98;

  const pieces: Piece[] = [
    // Uprights holding the stack in. They set the full width of the pile, so
    // the art reaches the edges of the hitbox even where the logs do not.
    { geometry: new THREE.BoxGeometry(0.14, 3.0, 0.18), color: COLORS.post, position: [-0.86, 1.5, 0] },
    { geometry: new THREE.BoxGeometry(0.14, 3.0, 0.18), color: COLORS.post, position: [0.86, 1.5, 0] },

    // Plank roof and the snow lying on it, which is what ties the pile to the
    // rest of the village rather than leaving it looking like cargo.
    { geometry: new THREE.BoxGeometry(2.0, 0.12, 1.0), color: COLORS.timberDark, position: [0, roofY, 0] },
    { geometry: new THREE.BoxGeometry(1.9, 0.16, 0.94), color: COLORS.snow, position: [0, roofY + 0.14, 0] },
  ];

  for (let row = 0; row < rows; row++) {
    const y = bottomRow + row * rowSpacing;
    // Alternate rows shift half a log so the stack does not read as a grid.
    const shift = row % 2 === 0 ? -0.09 : 0.09;

    for (let column = 0; column < columns; column++) {
      const x = -0.555 + column * 0.37 + shift;
      // Deterministic two-tone, so a rebuild always produces the same pile.
      const light = (row + column) % 2 === 0;

      pieces.push({
        geometry: new THREE.CylinderGeometry(logRadius, logRadius, logLength, 7),
        color: light ? COLORS.barkLight : COLORS.bark,
        // Laid end-on, along the direction of travel.
        rotation: [Math.PI / 2, 0, 0],
        position: [x, y, 0],
      });
      // The sawn face, on the approach side - a circle needs no rotation, since
      // CircleGeometry already faces +z. The pale ends are what make this read
      // as a woodpile rather than a dark mass, so they have to be the side the
      // player sees.
      pieces.push({
        geometry: new THREE.CircleGeometry(logRadius * 0.82, 8),
        color: light ? COLORS.cutLight : COLORS.cut,
        position: [x, y, logLength / 2 + 0.01],
      });
    }
  }

  return assemble(pieces);
}

/**
 * A take-off kicker.
 *
 * Built as a packed-snow wedge on a timber frame, with chevrons up the ride
 * surface and a lip at the top. The chevrons are the important part: a ramp has
 * to say "aim at this and hold your line" from a long way off, and the previous
 * tilted slab said nothing at all - it read as another obstacle to avoid, which
 * is the opposite of the instruction.
 *
 * The visual runs slightly longer than the trigger box so the rider is
 * visibly on the ramp as it fires, rather than launching off thin air.
 */
function buildRamp(): THREE.BufferGeometry {
  const width = 2.0;
  const height = 1.05;
  const depth = 2.8;

  // The angle of the ride surface, used to lie details flat against it.
  const pitch = Math.atan2(height, depth);
  const halfDepth = depth / 2;

  const pieces: Piece[] = [
    { geometry: wedge(width, height, depth), color: COLORS.packedSnow },
    // Timber frame: rails down both edges of the ride surface, and the posts
    // holding the lip up. A kicker is a built thing, not a snowdrift.
    {
      geometry: new THREE.BoxGeometry(0.12, 0.1, depth / Math.cos(pitch)),
      color: COLORS.rampTimber,
      rotation: [-pitch, 0, 0],
      position: [-width / 2 + 0.06, height / 2 + 0.06, 0],
    },
    {
      geometry: new THREE.BoxGeometry(0.12, 0.1, depth / Math.cos(pitch)),
      color: COLORS.rampTimber,
      rotation: [-pitch, 0, 0],
      position: [width / 2 - 0.06, height / 2 + 0.06, 0],
    },
    // The lip itself, kicked slightly past the slope so it throws the rider up.
    {
      geometry: new THREE.BoxGeometry(width, 0.14, 0.42),
      color: COLORS.rampTimber,
      rotation: [0.16, 0, 0],
      position: [0, height + 0.03, -halfDepth + 0.16],
    },
    // Support posts under the back.
    {
      geometry: new THREE.BoxGeometry(0.14, height, 0.14),
      color: COLORS.rampTimber,
      position: [-width / 2 + 0.18, height / 2, -halfDepth + 0.1],
    },
    {
      geometry: new THREE.BoxGeometry(0.14, height, 0.14),
      color: COLORS.rampTimber,
      position: [width / 2 - 0.18, height / 2, -halfDepth + 0.1],
    },
  ];

  // Chevrons up the ride surface, pointing at the lip. Each is a shallow V of
  // two bars, lying flat on the slope.
  for (let i = 0; i < 3; i++) {
    const t = 0.24 + i * 0.26;
    const z = halfDepth - t * depth;
    const y = t * height + 0.04;

    for (const side of [-1, 1] as const) {
      pieces.push({
        geometry: new THREE.BoxGeometry(width * 0.52, 0.05, 0.17),
        color: COLORS.rampMark,
        // Pitched onto the slope, then swept back into half of the arrow.
        rotation: [-pitch, side * 0.34, 0],
        position: [side * width * 0.23, y, z],
      });
    }
  }

  return assemble(pieces);
}

/**
 * A grind rail: a steel bar on posts, climbing away from the player.
 *
 * Built along -z, because that is the direction of travel - the near end sits
 * at the origin where the player mounts, and the far end is the high one. That
 * matches how `systems/rail` measures distance along it, so the art and the
 * physics rise together by construction rather than by two people agreeing.
 *
 * The bar is a box rather than a cylinder: at this scale a round bar reads as a
 * pipe lying on the snow, while a squared one reads as something built to be
 * ridden. Chevrons on the near face point at it, the same trick that makes the
 * ramp legible from a distance.
 */
/**
 * The bar of a grind rail, built **one metre long** and scaled to fit.
 *
 * Unit length on purpose: rails roll their own length, so the renderer stretches
 * this along Z rather than rebuilding geometry per size, and every rail in the
 * world stays a single instanced draw.
 *
 * Only what is *uniform* along the rail may live here. That is the whole rule,
 * and getting it wrong is not subtle: the first version put the posts in this
 * geometry, and stretching it twenty times over turned two thirteen-centimetre
 * posts into two-and-a-half-metre slabs. The result read as a long dark wall
 * down the lane rather than a bar you could ollie onto - a comment claiming the
 * posts were "placed at the ends, where scaling distorts them least" was simply
 * wrong, because a scale applies everywhere.
 *
 * Anything that must keep its proportions goes in `buildRailPost` and is drawn
 * unscaled at each end.
 */
function buildRailBar(): THREE.BufferGeometry {
  const { height } = TUNING.rail;

  return assemble([
    // Wide enough to read at distance: a scale-accurate handrail is a single
    // pixel by the time you need to decide whether to go for it.
    {
      geometry: new THREE.BoxGeometry(0.46, 0.18, 1),
      color: COLORS.railSteel,
      position: [0, height, -0.5],
    },
    // A brighter cap along the top, so the ride surface catches the light
    // instead of reading as a shadow against the snow.
    {
      geometry: new THREE.BoxGeometry(0.34, 0.07, 1),
      color: COLORS.railShine,
      position: [0, height + 0.11, -0.5],
    },
  ]);
}

/**
 * One end support of a rail: a post to the snow and a warm collar at the top.
 *
 * Drawn unscaled at both ends, so its proportions survive whatever length the
 * bar rolled. The collar is what marks where a rail begins - the same job the
 * ramp's chevrons do - and it would be a smear if it were stretched.
 */
function buildRailPost(): THREE.BufferGeometry {
  const { height } = TUNING.rail;

  return assemble([
    {
      geometry: new THREE.BoxGeometry(0.13, height, 0.13),
      color: COLORS.railPost,
      position: [0, height / 2, 0],
    },
    {
      geometry: new THREE.BoxGeometry(0.5, 0.2, 0.16),
      color: COLORS.rampMark,
      position: [0, height, 0],
    },
  ]);
}

let railCache: THREE.BufferGeometry | null = null;
let railPostCache: THREE.BufferGeometry | null = null;
let rampCache: THREE.BufferGeometry | null = null;

export function railGeometry(): THREE.BufferGeometry {
  railCache ??= buildRailBar();
  return railCache;
}

export function railPostGeometry(): THREE.BufferGeometry {
  railPostCache ??= buildRailPost();
  return railPostCache;
}

export function rampGeometry(): THREE.BufferGeometry {
  rampCache ??= buildRamp();
  return rampCache;
}

/** Every obstacle kind built in code rather than loaded from a model. */
export const PROP_BUILDERS = {
  tunnelRock: buildTunnelRock,
  chalet: buildChalet,
  banner: buildBanner,
  branch: buildBranch,
  woodpile: buildWoodpile,
} as const;

export type PropKind = keyof typeof PROP_BUILDERS;

/** Built once and shared: the geometry never changes. */
const cache = new Map<PropKind, THREE.BufferGeometry>();

export function propGeometry(kind: PropKind): THREE.BufferGeometry {
  let geometry = cache.get(kind);
  if (!geometry) {
    geometry = PROP_BUILDERS[kind]();
    cache.set(kind, geometry);
  }
  return geometry;
}

export function isPropKind(kind: string): kind is PropKind {
  return kind in PROP_BUILDERS;
}

// --- Power-up pickups --------------------------------------------------------
// Each is built to its *label*, not to an abstract icon. These used to be five
// identical octahedra distinguished only by tint, which asks the player to have
// memorised a colour key - and colour is the first thing a low sun and heavy fog
// take away. A silhouette survives both, and reads at the distance a decision
// actually has to be made from.
//
// Sized to roughly the octahedron they replace, so the pickup radius in
// `simulation.ts` still matches what is drawn.

/**
 * A block of cave rock, one lane wide and a full passage deep.
 *
 * Deliberately built to tile. Instances in adjacent lanes have to read as one
 * cliff rather than as three boulders in a row, so the block is exactly a lane
 * across with a flat vertical face, and all the variation is in the *top* -
 * where a seam between segments is hidden by the silhouette rather than sitting
 * across the part the player is reading.
 */
function buildTunnelRock(): THREE.BufferGeometry {
  const laneWidth = Math.abs(LANES[1] - LANES[0]);
  const def = obstacleDef('tunnelRock');
  const height = def.halfHeight * 2;
  const depth = def.halfDepth * 2;

  const pieces: Piece[] = [
    {
      geometry: new THREE.BoxGeometry(laneWidth, height * 0.8, depth),
      color: COLORS.tunnelRock,
      position: [0, height * 0.4, 0],
    },
    // A darker recess on the approach face, so a flat wall has something to
    // catch the raking key light and does not read as a painted backdrop.
    {
      geometry: new THREE.BoxGeometry(laneWidth * 0.62, height * 0.5, 0.18),
      color: COLORS.tunnelRockDark,
      position: [0, height * 0.36, depth / 2 - 0.06],
    },
  ];

  // A ragged crown, kept inside the collider: `tests/models.test.ts` refuses art
  // that towers over the thing which actually stops the player, because a
  // silhouette the hitbox does not back up reads as solid and is then passed
  // straight through. Three slabs of different heights, which is what stops a
  // tiled wall reading as masonry.
  const crown = [
    { x: -laneWidth * 0.28, w: laneWidth * 0.42, h: height * 0.16 },
    { x: laneWidth * 0.06, w: laneWidth * 0.5, h: height * 0.11 },
    { x: laneWidth * 0.34, w: laneWidth * 0.3, h: height * 0.19 },
  ];
  for (const slab of crown) {
    pieces.push({
      geometry: new THREE.BoxGeometry(slab.w, slab.h, depth * 0.86),
      color: COLORS.tunnelRock,
      position: [slab.x, height * 0.8 + slab.h / 2, 0],
    });
  }

  // Snow caps, because everything else on this mountain has them.
  for (const slab of crown) {
    pieces.push({
      geometry: new THREE.BoxGeometry(slab.w * 1.02, 0.16, depth * 0.88),
      color: COLORS.snow,
      position: [slab.x, height * 0.8 + slab.h + 0.06, 0],
    });
  }

  // The gallery roof. Cantilevered a full lane to each side so that whichever
  // lane is left open is covered, whichever side of the wall it happens to be
  // on - a one-sided overhang works for half the mirrors and leaves the other
  // half open to the sky. Where two wall segments stand side by side their roofs
  // coincide, which is invisible because they are the same colour.
  //
  // Geometry only. It belongs to the wall's mesh rather than being an obstacle
  // of its own, which is exactly what lets the passage be roofed without
  // anything standing in it - the way through is clear from the snow to well
  // above the top of a jump, so a tunnel asks for a lane and nothing more.
  const roofBase = height * 0.86;
  pieces.push({
    geometry: new THREE.BoxGeometry(laneWidth * 3, height * 0.14, depth),
    color: COLORS.tunnelRock,
    position: [0, roofBase + height * 0.07, 0],
  });

  // Underside of the roof, stepped through three shades from the mouth to the
  // far end. The gradient is what the eye reads as depth; a single flat colour
  // overhead reads as a lid rather than as a passage going somewhere.
  const slices = [
    { z: depth * 0.33, colour: COLORS.tunnelInner },
    { z: 0, colour: COLORS.tunnelDeep },
    { z: -depth * 0.33, colour: COLORS.tunnelDark },
  ];
  for (const slice of slices) {
    pieces.push({
      geometry: new THREE.BoxGeometry(laneWidth * 2.96, 0.12, depth * 0.33),
      color: slice.colour,
      position: [0, roofBase - 0.06, slice.z],
    });
  }

  return assemble(pieces);
}

/**
 * A coin: a struck disc with a raised rim and a numeral on both faces.
 *
 * It used to be a bare cylinder, which at this scale read as a yellow tiddlywink
 * - nothing on it said "money" except the colour. A coin is legible because of
 * its *edge*: a raised rim catches the key light along a bright arc while the
 * recessed face stays a step darker, and that contrast is what the eye reads as
 * struck metal rather than a painted counter.
 *
 * The numeral goes on both faces because the disc spins, and a mark on one side
 * would strobe. Kept to a stem and a foot: at the size a coin occupies on a
 * phone, anything finer is a smudge, and a smudge reads worse than a clean bar.
 *
 * Segment counts are deliberately low. This geometry is instanced across every
 * coin on screen, so its vertex count is multiplied by the whole visible field -
 * the one place in this file where a few extra faces are not free.
 */
function buildCoin(): THREE.BufferGeometry {
  const r = TUNING.coins.radius;
  // Local +Y is the disc's axis, which the renderer tips towards the camera, so
  // the face lies in local XZ: X reads across the coin and Z reads down it.
  // Face half-thickness plus half the numeral's, so the mark sits *in* the
  // recess and finishes flush with the rim rather than standing over it.
  const faceY = 0.065;

  const pieces: Piece[] = [
    // The rim: wider *and* thicker than the face, so it stands proud on both
    // sides. Both parts matter - a rim that is merely wider is a flat disc with
    // a stripe on it, and the whole read comes from the edge catching the key
    // light along a bright arc while the face behind it stays a step down.
    {
      geometry: new THREE.CylinderGeometry(r, r, 0.16, 12),
      color: COLORS.coinRim,
    },
    // The recessed face, a step brighter than the rim standing around it.
    {
      geometry: new THREE.CylinderGeometry(r * 0.78, r * 0.78, 0.1, 12),
      color: COLORS.coinFace,
    },
  ];

  for (const side of [-1, 1] as const) {
    // Stem of the numeral.
    pieces.push({
      geometry: new THREE.BoxGeometry(r * 0.14, 0.03, r * 0.62),
      color: COLORS.coinMark,
      position: [0, side * faceY, 0],
    });
    // Foot, which is what stops the stem reading as a tally mark.
    pieces.push({
      geometry: new THREE.BoxGeometry(r * 0.44, 0.03, r * 0.14),
      color: COLORS.coinMark,
      position: [0, side * faceY, r * 0.31],
    });
  }

  return assemble(pieces);
}

let coinCache: THREE.BufferGeometry | null = null;

/** Built once and shared: every coin in the world is the same disc. */
export function coinGeometry(): THREE.BufferGeometry {
  coinCache ??= buildCoin();
  return coinCache;
}

const PICKUP_COLORS = {
  mug: '#f7f2ea',
  cocoa: '#5a2f16',
  cream: '#fffdf7',
  boardDeck: '#5ec8f2',
  boardEdge: '#f7fbfe',
  binding: '#2c3e50',
  chairFrame: '#c9862a',
  chairSeat: '#f0b429',
  cable: '#8a949e',
  wing: '#efe4ff',
  wingCore: '#d7b3ff',
  star: '#5be584',
  starCore: '#e9fff2',
} as const;

/** Hot Cocoa: a steaming mug, handle out to the side so it reads in profile. */
function buildCocoa(): THREE.BufferGeometry {
  const pieces: Piece[] = [
    {
      geometry: new THREE.CylinderGeometry(0.3, 0.26, 0.42, 10),
      color: PICKUP_COLORS.mug,
      position: [0, 0, 0],
    },
    // The drink itself, sitting just below the rim.
    {
      geometry: new THREE.CylinderGeometry(0.26, 0.26, 0.04, 10),
      color: PICKUP_COLORS.cocoa,
      position: [0, 0.2, 0],
    },
    // A marshmallow, because the dark disc alone reads as an empty tin.
    {
      geometry: new THREE.CylinderGeometry(0.08, 0.08, 0.07, 6),
      color: PICKUP_COLORS.cream,
      position: [0.08, 0.24, 0.04],
    },
    {
      geometry: new THREE.TorusGeometry(0.13, 0.045, 5, 8, Math.PI * 1.2),
      color: PICKUP_COLORS.mug,
      position: [0.34, 0.02, 0],
      rotation: [0, Math.PI / 2, -Math.PI / 2],
    },
  ];
  return assemble(pieces);
}

/** Avalanche Board: a snowboard stood on end, bindings towards the camera. */
function buildAvalanche(): THREE.BufferGeometry {
  const pieces: Piece[] = [
    {
      geometry: new THREE.BoxGeometry(0.32, 0.86, 0.07),
      color: PICKUP_COLORS.boardDeck,
      position: [0, 0, 0],
    },
    // Pale tip and tail, the marking every board in the game shares.
    {
      geometry: new THREE.BoxGeometry(0.33, 0.12, 0.075),
      color: PICKUP_COLORS.boardEdge,
      position: [0, 0.38, 0],
    },
    {
      geometry: new THREE.BoxGeometry(0.33, 0.12, 0.075),
      color: PICKUP_COLORS.boardEdge,
      position: [0, -0.38, 0],
    },
    {
      geometry: new THREE.BoxGeometry(0.24, 0.09, 0.06),
      color: PICKUP_COLORS.binding,
      position: [0, 0.12, 0.06],
    },
    {
      geometry: new THREE.BoxGeometry(0.24, 0.09, 0.06),
      color: PICKUP_COLORS.binding,
      position: [0, -0.12, 0.06],
    },
  ];
  return assemble(pieces);
}

/** Chairlift: a seat hanging off a hanger, with a stub of cable above it. */
function buildChairlift(): THREE.BufferGeometry {
  const pieces: Piece[] = [
    {
      geometry: new THREE.BoxGeometry(0.62, 0.035, 0.035),
      color: PICKUP_COLORS.cable,
      position: [0, 0.42, 0],
    },
    // The hanger arm, which is what makes it a chairlift and not a bench.
    {
      geometry: new THREE.BoxGeometry(0.05, 0.34, 0.05),
      color: PICKUP_COLORS.chairFrame,
      position: [0, 0.25, 0],
    },
    {
      geometry: new THREE.BoxGeometry(0.5, 0.07, 0.34),
      color: PICKUP_COLORS.chairSeat,
      position: [0, 0.04, 0],
    },
    {
      geometry: new THREE.BoxGeometry(0.5, 0.3, 0.06),
      color: PICKUP_COLORS.chairSeat,
      position: [0, 0.18, -0.14],
    },
    // A safety bar across the front, the detail that sells the read at a glance.
    {
      geometry: new THREE.BoxGeometry(0.46, 0.04, 0.04),
      color: PICKUP_COLORS.chairFrame,
      position: [0, 0.2, 0.16],
    },
  ];
  return assemble(pieces);
}

/** Snow Angel: a pair of wings - the double jump, drawn as the thing that flies. */
function buildSnowAngel(): THREE.BufferGeometry {
  const pieces: Piece[] = [
    {
      geometry: new THREE.CylinderGeometry(0.07, 0.05, 0.36, 6),
      color: PICKUP_COLORS.wingCore,
      position: [0, 0, 0],
    },
  ];

  // Three feathers a side, swept back and fanning down, mirrored exactly.
  for (const side of [-1, 1] as const) {
    for (let i = 0; i < 3; i++) {
      const t = i / 2;
      pieces.push({
        geometry: new THREE.BoxGeometry(0.34 - t * 0.08, 0.1, 0.05),
        color: i === 0 ? PICKUP_COLORS.wing : PICKUP_COLORS.wingCore,
        position: [side * (0.22 + t * 0.06), 0.12 - t * 0.16, -t * 0.03],
        rotation: [0, 0, side * (0.35 - t * 0.5)],
      });
    }
  }

  return assemble(pieces);
}

/** Double Score: a star, the one shape that has meant "points" since arcades. */
function buildDoubleScore(): THREE.BufferGeometry {
  const pieces: Piece[] = [
    {
      geometry: new THREE.CylinderGeometry(0.16, 0.16, 0.14, 8),
      color: PICKUP_COLORS.starCore,
      rotation: [Math.PI / 2, 0, 0],
      position: [0, 0, 0],
    },
  ];

  // Five points radiating from the hub. Tapered prisms rather than a flat
  // extruded star: flat shading needs faces at different angles to read at all.
  for (let i = 0; i < 5; i++) {
    const angle = (i / 5) * Math.PI * 2;
    pieces.push({
      geometry: new THREE.ConeGeometry(0.13, 0.34, 4),
      color: PICKUP_COLORS.star,
      position: [Math.sin(angle) * 0.24, Math.cos(angle) * 0.24, 0],
      rotation: [Math.PI / 2, 0, -angle],
    });
  }

  return assemble(pieces);
}

const PICKUP_BUILDERS = {
  magnet: buildCocoa,
  avalanche: buildAvalanche,
  chairlift: buildChairlift,
  snowAngel: buildSnowAngel,
  doubleScore: buildDoubleScore,
} as const;

const pickupCache = new Map<string, THREE.BufferGeometry>();

/** Built once and shared: a pickup's geometry never changes. */
export function pickupGeometry(id: keyof typeof PICKUP_BUILDERS): THREE.BufferGeometry {
  let geometry = pickupCache.get(id);
  if (!geometry) {
    geometry = PICKUP_BUILDERS[id]();
    pickupCache.set(id, geometry);
  }
  return geometry;
}
