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
import { TUNING } from '@/game/config/tuning';
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
function buildRail(): THREE.BufferGeometry {
  const { length, baseHeight, rise } = TUNING.rail;
  const pitch = Math.atan2(rise, length);
  const barLength = Math.hypot(length, rise);

  const pieces: Piece[] = [
    // A packed-snow lead-in at the near end. Without it the rail begins in
    // mid-air at ankle height and there is nothing to aim a slide at; this is
    // the bit that says "come in here", the same job the ramp's chevrons do.
    { geometry: wedge(1.5, baseHeight + 0.12, 2.6), color: COLORS.packedSnow, position: [0, 0, 1.1] },

    // The bar itself, pitched up along the run and pushed half its length away
    // so its near end sits at z = 0. Wide enough to read at distance: a
    // scale-accurate handrail is a single pixel by the time you need to decide.
    {
      geometry: new THREE.BoxGeometry(0.46, 0.2, barLength),
      color: COLORS.railSteel,
      rotation: [pitch, 0, 0],
      position: [0, baseHeight + rise / 2, -length / 2],
    },
    // A brighter cap along the top, so the ride surface catches the light and
    // the rail does not read as a shadow against the snow.
    {
      geometry: new THREE.BoxGeometry(0.36, 0.08, barLength * 0.99),
      color: COLORS.railShine,
      rotation: [pitch, 0, 0],
      position: [0, baseHeight + rise / 2 + 0.12, -length / 2],
    },
    // Warm collars at both ends. The near one marks the mount, the far one
    // marks where you get thrown off, and both stand out against a cold slope.
    {
      geometry: new THREE.BoxGeometry(0.56, 0.3, 0.34),
      color: COLORS.rampMark,
      position: [0, baseHeight + 0.06, -0.1],
    },
    {
      geometry: new THREE.BoxGeometry(0.56, 0.3, 0.34),
      color: COLORS.rampMark,
      position: [0, baseHeight + rise + 0.06, -length + 0.1],
    },
  ];

  // Posts down to the snow, getting taller as the rail climbs. Thick enough to
  // be seen, which is also what makes the *height* of the rail legible - the
  // bar alone gives the eye nothing to judge it against.
  const posts = 6;
  for (let i = 0; i < posts; i++) {
    const t = (i + 0.5) / posts;
    const z = -t * length;
    const top = baseHeight + rise * t;
    for (const side of [-1, 1] as const) {
      pieces.push({
        geometry: new THREE.BoxGeometry(0.13, top, 0.13),
        color: COLORS.railPost,
        position: [side * 0.2, top / 2, z],
      });
    }
    // A cross brace, which is what stops a row of posts reading as a fence.
    pieces.push({
      geometry: new THREE.BoxGeometry(0.5, 0.09, 0.09),
      color: COLORS.railPost,
      position: [0, top * 0.45, z],
    });
  }

  // Chevrons on the lead-in, pointing at the mount.
  for (let i = 0; i < 3; i++) {
    for (const side of [-1, 1] as const) {
      pieces.push({
        geometry: new THREE.BoxGeometry(0.5, 0.05, 0.16),
        color: COLORS.rampMark,
        rotation: [0, side * 0.42, 0],
        position: [side * 0.24, 0.06 + i * 0.04, 2.3 - i * 0.62],
      });
    }
  }

  return assemble(pieces);
}

/** Built once and shared. Ramps are not obstacles, so they stand apart. */
let rampCache: THREE.BufferGeometry | null = null;
let railCache: THREE.BufferGeometry | null = null;

export function railGeometry(): THREE.BufferGeometry {
  railCache ??= buildRail();
  return railCache;
}

export function rampGeometry(): THREE.BufferGeometry {
  rampCache ??= buildRamp();
  return rampCache;
}

/** Every obstacle kind built in code rather than loaded from a model. */
export const PROP_BUILDERS = {
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
