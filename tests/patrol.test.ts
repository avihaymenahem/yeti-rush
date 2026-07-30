/**
 * The ski patrol.
 *
 * Three things are being protected here and they are not the same thing.
 *
 * The obvious one - "the machine is inside the view frustum" - is worthless on
 * its own, because it is satisfied perfectly by a machine sitting directly
 * behind the player's head, which is the *worse* of the two failures available.
 * The player is a near-white silhouette that already struggles to separate from
 * a snow slope; a second tall mass behind it would make the fix worse than the
 * bug. So the primary invariant is that the patrol's projected silhouette and
 * the player's do not overlap, swept across the aspect matrix and across the
 * whole range of the lens, and the counterweight is that the machine is
 * genuinely on screen while that holds - each half is trivially satisfiable
 * alone and neither is worth anything without the other.
 *
 * The third is newer and comes from a measured verdict on a shipped frame: the
 * machine "never resolves into a snowmobile - no skis, no windscreen, no
 * handlebars, no readable rider", while being the largest and highest-contrast
 * mass in the image. It had all of those parts. They were authored inside the
 * outline of the things in front of them, so from the one angle the player sees
 * this object from, none of them existed. The silhouette tests below hold the
 * three cues that survive being cropped: **ski tips outboard of the cowl, a
 * screen standing clear above it, a head standing clear above that.**
 *
 * Everything is projected by hand from the real camera framing rather than
 * through three's renderer, so this stays a pure-logic test like the rest of the
 * suite: no jsdom, no WebGL, no clock. The geometry is real, built in node,
 * following `tests/models.test.ts`.
 */

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { LANES, TUNING } from '@/game/config/tuning';
import { PATROL, saturate } from '@/game/config/visuals';
import {
  createApproach,
  MACHINE_LENGTH,
  MACHINE_WIDTH,
  patrolDepth,
  patrolDrawnZ,
  patrolMachineGeometry,
  PATROL_LIVERY,
  patrolOutboard,
  patrolRiderGeometry,
  patrolShoulderX,
  patrolSideFor,
  RIDER_SEAT,
  stepApproach,
} from '@/game/render/patrolGeometry';
import {
  distanceForHalfExtent,
  horizontalHalfExtentAt,
  requiredHalfExtent,
} from '@/game/systems/camera';

// --- Colour ------------------------------------------------------------------

/*
 * Vertex colours come out of `bakeColor`, which saturates the authored hex and
 * then hands it to `THREE.Color` - and three converts sRGB to its linear working
 * space on assignment. So the numbers in the buffer are linear, and comparing
 * them against an sRGB intuition is wrong by the whole transfer curve.
 *
 * Every threshold below is therefore anchored by running a reference hex through
 * the identical path, which makes it immune to the colour-management setting and
 * says what it means: "darker than a #242424 grey" rather than "under 0.02".
 */
function lumaOf(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function referenceLuma(hex: string): number {
  const colour = new THREE.Color(saturate(hex));
  return lumaOf(colour.r, colour.g, colour.b);
}

/** The buffer value a livery hex ends up as, following `bakeColor` exactly. */
function baked(hex: string): THREE.Color {
  return new THREE.Color(saturate(hex));
}

/** Brightest channel - "is any light coming off this at all". See `floorValue`. */
function value(hex: string): number {
  const raw = hex.replace('#', '');
  return Math.max(...[0, 2, 4].map((i) => parseInt(raw.slice(i, i + 2), 16))) / 255;
}

/** Spread between the channels: how chromatic a hex is, on 0..1. */
function chroma(hex: string): number {
  const raw = hex.replace('#', '');
  const channels = [0, 2, 4].map((i) => parseInt(raw.slice(i, i + 2), 16) / 255);
  return Math.max(...channels) - Math.min(...channels);
}

interface Tone {
  luma: number;
  r: number;
  b: number;
  /** Surface area carrying this colour, in square metres. */
  area: number;
}

/**
 * Every distinct vertex colour in a geometry, weighted by the area it covers.
 *
 * Area, not vertex count, and that is the whole point of doing it this way: a
 * sphere carries hundreds of vertices over a few square centimetres while a slab
 * carries thirty-six over half a square metre, so counting vertices measures the
 * tessellation rather than what the eye sees.
 */
function tones(geometry: THREE.BufferGeometry): Tone[] {
  const positions = geometry.getAttribute('position');
  const colors = geometry.getAttribute('color');
  const byColour = new Map<string, Tone>();

  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();

  for (let t = 0; t < positions.count; t += 3) {
    a.fromBufferAttribute(positions, t);
    b.fromBufferAttribute(positions, t + 1);
    c.fromBufferAttribute(positions, t + 2);
    const area = b.clone().sub(a).cross(c.clone().sub(a)).length() / 2;

    const r = colors.getX(t);
    const g = colors.getY(t);
    const blue = colors.getZ(t);
    const key = `${r.toFixed(4)},${g.toFixed(4)},${blue.toFixed(4)}`;

    const existing = byColour.get(key);
    if (existing) existing.area += area;
    else byColour.set(key, { luma: lumaOf(r, g, blue), r, b: blue, area });
  }

  return [...byColour.values()];
}

function totalArea(list: Tone[]): number {
  return list.reduce((sum, tone) => sum + tone.area, 0);
}

/**
 * The bounding box of just the vertices carrying one livery colour.
 *
 * Keying the silhouette tests on colour rather than on a slab of space is
 * deliberate. "The widest thing at the front of the machine is low down" can be
 * satisfied by a suspension strut; "the *skis* reach wider than the *cowl*" is
 * the statement actually being made, and it stays true however the rest of the
 * machine is rearranged around it.
 */
function partBox(geometry: THREE.BufferGeometry, hex: string): THREE.Box3 {
  const positions = geometry.getAttribute('position');
  const colors = geometry.getAttribute('color');
  const want = baked(hex);
  const box = new THREE.Box3();
  const vertex = new THREE.Vector3();

  for (let i = 0; i < positions.count; i++) {
    const near =
      Math.abs(colors.getX(i) - want.r) < 1e-4 &&
      Math.abs(colors.getY(i) - want.g) < 1e-4 &&
      Math.abs(colors.getZ(i) - want.b) < 1e-4;
    if (!near) continue;
    box.expandByPoint(vertex.fromBufferAttribute(positions, i));
  }

  // Thrown rather than expected: this runs while the suite is being collected,
  // where there is no test for a failed expectation to belong to.
  if (box.isEmpty()) throw new Error(`no geometry carries the livery colour ${hex}`);
  return box;
}

/** How far a part reaches from the centre line. */
function halfWidthOf(box: THREE.Box3): number {
  return Math.max(box.max.x, -box.min.x);
}

// --- Projection --------------------------------------------------------------

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

interface Span {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** A point on the frame, in normalised device coordinates, and how far off it is. */
interface Projected {
  x: number;
  y: number;
  depth: number;
}

/**
 * The camera basis, as a function that maps a world point to the frame.
 *
 * Shared by the bounding-box projection and the rasteriser below, which is the
 * point of pulling it out: two projections of the same scene disagreeing by a
 * sign is exactly the class of bug these tests exist to catch, and it is not
 * caught by a test whose harness contains the same sign twice.
 */
function viewFor(eye: Vec3, target: Vec3, fovDegrees: number, aspect: number) {
  const forward = new THREE.Vector3(
    target.x - eye.x,
    target.y - eye.y,
    target.z - eye.z,
  ).normalize();
  const right = forward
    .clone()
    .cross(new THREE.Vector3(0, 1, 0))
    .normalize();
  const up = right.clone().cross(forward);
  const tanHalf = Math.tan((fovDegrees * Math.PI) / 360);
  const offset = new THREE.Vector3();

  return (point: THREE.Vector3 | Vec3): Projected => {
    offset.set(point.x - eye.x, point.y - eye.y, point.z - eye.z);
    const depth = offset.dot(forward);
    return {
      x: offset.dot(right) / depth / (tanHalf * aspect),
      y: offset.dot(up) / depth / tanHalf,
      depth,
    };
  };
}

/**
 * Projects a world-space box to its normalised-device silhouette.
 *
 * Returns null if any corner is at or behind the eye, which is not a numerical
 * guard but the assertion itself: the patrol used to be drawn at
 * `player.z + 26` against a camera at about `z = 8.96`, seventeen units behind
 * the lens, and that is exactly the case that must come back as "not on screen"
 * rather than as a plausible-looking projection with a sign error in it.
 */
function silhouette(
  box: THREE.Box3,
  eye: Vec3,
  target: Vec3,
  fovDegrees: number,
  aspect: number,
): Span | null {
  const project = viewFor(eye, target, fovDegrees, aspect);
  const span: Span = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
  const corner = new THREE.Vector3();

  for (let i = 0; i < 8; i++) {
    corner.set(
      i & 1 ? box.max.x : box.min.x,
      i & 2 ? box.max.y : box.min.y,
      i & 4 ? box.max.z : box.min.z,
    );

    const point = project(corner);
    if (point.depth <= 0.01) return null;

    span.minX = Math.min(span.minX, point.x);
    span.maxX = Math.max(span.maxX, point.x);
    span.minY = Math.min(span.minY, point.y);
    span.maxY = Math.max(span.maxY, point.y);
  }

  return span;
}

// --- The pixels ---------------------------------------------------------------

/*
 * The bounding box above answers "where is the machine", and it is the right
 * tool for the separation guarantee - an over-estimate of the outline is a
 * conservative claim about not crowding the player.
 *
 * It is the wrong tool for "how much of the frame does the machine own", and
 * believing otherwise is what let the measured verdict of "20-25% of the frame"
 * stand while every framing test passed. A box around a tapered machine reports
 * the area of a machine that has no taper: it cannot tell the difference between
 * narrowing the tail - the actual fix - and doing nothing. So the coverage tests
 * rasterise the real triangles.
 */

/** The reference phone in cells. Square-ish at `PHONE_ASPECT`, which is where the
 * critique measured; coverage is a ratio, so the resolution only bounds the
 * error on small features and there are none on this model. */
const GRID_X = 160;
const GRID_Y = 346;

/**
 * Every vertex of the drawn patrol in world space, in triangle order.
 *
 * The rider is taken at *rest*, which is its tallest pose - crouching folds the
 * figure forward and down, so anything asserted here is the worst case rather
 * than an average one.
 */
function patrolVertices(x: number, z: number): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];

  const collect = (geometry: THREE.BufferGeometry, offset: THREE.Vector3): void => {
    const positions = geometry.getAttribute('position');
    for (let i = 0; i < positions.count; i++) {
      out.push(new THREE.Vector3().fromBufferAttribute(positions, i).add(offset));
    }
  };

  collect(patrolMachineGeometry(), new THREE.Vector3(x, 0, z));
  collect(
    patrolRiderGeometry(),
    new THREE.Vector3(x + RIDER_SEAT[0], RIDER_SEAT[1], z + RIDER_SEAT[2]),
  );
  return out;
}

interface Pixels {
  /** Fraction of the frame the machine actually paints, 0..1. */
  covered: number;
  /** How far past each frame edge the geometry reaches, in half-widths. */
  overrun: { left: number; right: number; top: number; bottom: number };
  span: Span;
}

/**
 * Rasterises the projected triangles and reports what they cover.
 *
 * A scanline over each triangle's bounding cells with a barycentric inside test,
 * which is the whole of it - no depth buffer, because the question is what the
 * machine covers rather than which of its own panels is in front.
 */
function rasterise(
  vertices: THREE.Vector3[],
  eye: Vec3,
  target: Vec3,
  fovDegrees: number,
  aspect: number,
): Pixels {
  const project = viewFor(eye, target, fovDegrees, aspect);
  const filled = new Uint8Array(GRID_X * GRID_Y);
  const overrun = { left: 0, right: 0, top: 0, bottom: 0 };
  const span: Span = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };

  for (let t = 0; t < vertices.length; t += 3) {
    const a = project(vertices[t]!);
    const b = project(vertices[t + 1]!);
    const c = project(vertices[t + 2]!);
    // Behind the lens is not a case this geometry can reach - the framing tests
    // above assert it - so it is a harness failure rather than something to clip.
    if (a.depth <= 0.01 || b.depth <= 0.01 || c.depth <= 0.01) {
      throw new Error('patrol triangle behind the eye');
    }

    for (const point of [a, b, c]) {
      overrun.right = Math.max(overrun.right, point.x - 1);
      overrun.left = Math.max(overrun.left, -1 - point.x);
      overrun.top = Math.max(overrun.top, point.y - 1);
      overrun.bottom = Math.max(overrun.bottom, -1 - point.y);
      span.minX = Math.min(span.minX, point.x);
      span.maxX = Math.max(span.maxX, point.x);
      span.minY = Math.min(span.minY, point.y);
      span.maxY = Math.max(span.maxY, point.y);
    }

    const area = (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y);
    if (Math.abs(area) < 1e-12) continue;

    const toCol = (x: number): number => ((x + 1) / 2) * GRID_X - 0.5;
    const toRow = (y: number): number => ((y + 1) / 2) * GRID_Y - 0.5;
    const minCol = Math.max(0, Math.ceil(toCol(Math.min(a.x, b.x, c.x))));
    const maxCol = Math.min(GRID_X - 1, Math.floor(toCol(Math.max(a.x, b.x, c.x))));
    const minRow = Math.max(0, Math.ceil(toRow(Math.min(a.y, b.y, c.y))));
    const maxRow = Math.min(GRID_Y - 1, Math.floor(toRow(Math.max(a.y, b.y, c.y))));

    for (let row = minRow; row <= maxRow; row++) {
      const y = ((row + 0.5) / GRID_Y) * 2 - 1;
      for (let col = minCol; col <= maxCol; col++) {
        const x = ((col + 0.5) / GRID_X) * 2 - 1;
        // Barycentric, normalised by the signed area so either winding works.
        const w0 = ((b.x - a.x) * (y - a.y) - (x - a.x) * (b.y - a.y)) / area;
        const w1 = ((x - a.x) * (c.y - a.y) - (c.x - a.x) * (y - a.y)) / area;
        if (w0 >= 0 && w1 >= 0 && w0 + w1 <= 1) filled[row * GRID_X + col] = 1;
      }
    }
  }

  let covered = 0;
  for (const cell of filled) covered += cell;
  return { covered: covered / filled.length, overrun, span };
}

/**
 * The span one livery colour occupies *on the frame*.
 *
 * The vertices themselves, not their bounding box, and that is the entire point
 * of the function. `partBox` is fine for "how wide is this part", but a box
 * around a tapered panel has corners the panel does not - the skirt's box says
 * it reaches 0.38 at the tail, where the panel itself reaches 0.28 - and the
 * whole question here is which of two parts is further out *after* perspective
 * has foreshortened the further one. Comparing two boxes would compare two
 * fictions and it is what let "the skis stand proud of the cowl" be true of the
 * model and false of every frame.
 */
function projectedPartSpan(
  geometry: THREE.BufferGeometry,
  hex: string,
  offset: THREE.Vector3,
  project: (point: THREE.Vector3) => Projected,
): Span {
  const positions = geometry.getAttribute('position');
  const colors = geometry.getAttribute('color');
  const want = baked(hex);
  const span: Span = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
  const vertex = new THREE.Vector3();

  for (let i = 0; i < positions.count; i++) {
    const near =
      Math.abs(colors.getX(i) - want.r) < 1e-4 &&
      Math.abs(colors.getY(i) - want.g) < 1e-4 &&
      Math.abs(colors.getZ(i) - want.b) < 1e-4;
    if (!near) continue;

    const point = project(vertex.fromBufferAttribute(positions, i).add(offset));
    span.minX = Math.min(span.minX, point.x);
    span.maxX = Math.max(span.maxX, point.x);
    span.minY = Math.min(span.minY, point.y);
    span.maxY = Math.max(span.maxY, point.y);
  }

  if (span.minX === Infinity) throw new Error(`no geometry carries the livery colour ${hex}`);
  return span;
}

/** The eye and aim point the rig settles at for a given lane. */
function rigFor(laneX: number, cameraZ: number): { eye: Vec3; target: Vec3 } {
  return {
    eye: { x: laneX * TUNING.camera.laneFollow, y: TUNING.camera.height, z: cameraZ },
    target: {
      x: laneX * TUNING.camera.laneFollow * 0.5,
      y: TUNING.camera.lookAtHeight,
      z: TUNING.camera.lookAheadZ,
    },
  };
}

/**
 * Camera distances the rig can produce at a given lens.
 *
 * Both are swept deliberately. `cameraDistanceFor` derives the pull-back from
 * the *base* fov today, so the camera sits further back than it needs to at
 * speed; the camera package intends to re-derive it from the live lens. Testing
 * against both means whichever way that lands, this file still holds - and it
 * avoids importing a function whose signature is in flight.
 */
function cameraDistances(fovDegrees: number, aspect: number): number[] {
  const required = requiredHalfExtent();
  return [
    Math.max(TUNING.camera.minDistance, distanceForHalfExtent(required, TUNING.camera.fov, aspect)),
    Math.max(TUNING.camera.minDistance, distanceForHalfExtent(required, fovDegrees, aspect)),
  ];
}

/** The player's collider, which the art is fitted to, placed in a lane. */
function playerBox(laneX: number): THREE.Box3 {
  const { halfWidth, halfHeight, halfDepth, z } = TUNING.player;
  return new THREE.Box3(
    new THREE.Vector3(laneX - halfWidth, 0, z - halfDepth),
    new THREE.Vector3(laneX + halfWidth, halfHeight * 2, z + halfDepth),
  );
}

/** The whole patrol - machine and rider - as one world-space box. */
function patrolBox(x: number, z: number): THREE.Box3 {
  const machine = patrolMachineGeometry().boundingBox!.clone();
  const rider = patrolRiderGeometry()
    .boundingBox!.clone()
    .translate(new THREE.Vector3(...RIDER_SEAT));
  return machine.union(rider).translate(new THREE.Vector3(x, 0, z));
}

/** Aspect ratios spanning phones in portrait through to a small tablet. */
const ASPECTS = [0.45, 0.4618, 0.52, 0.62, 0.75];
/** The whole range of the lens: the base, and the top of the speed kick. */
const FOVS = [TUNING.camera.fov, TUNING.camera.fov + TUNING.camera.speedFovKick];

/** Every case the framing has to hold for: lane, the shoulder it rides on. */
const PLACEMENTS = [
  { lane: 0, side: 1 as const, label: 'left lane, machine inboard' },
  { lane: 1, side: -1 as const, label: 'centre lane, machine left' },
  { lane: 1, side: 1 as const, label: 'centre lane, machine right' },
  { lane: 2, side: -1 as const, label: 'right lane, machine inboard' },
];

/** The reference phone: 375 x 812, which the baseline capture was taken on. */
const PHONE_ASPECT = 375 / 812;

/**
 * Slack for float32 storage, in metres.
 *
 * Vertex positions live in a `Float32Array`, so a piece authored at exactly the
 * cap reads back a hair *above* it - `Math.fround(1.1)` is 1.100000023841858,
 * and a bounding box built from that is wider than the constant it was built
 * from. This is representation error, not a machine that grew. A micrometre is
 * three orders of magnitude below the smallest dimension anything on this model
 * is authored to, so a real overrun still fails.
 */
const FLOAT32_SLACK = 1e-6;

// --- The machine -------------------------------------------------------------

describe('patrol geometry', () => {
  const machine = patrolMachineGeometry();
  const rider = patrolRiderGeometry();

  it('is capped to its drawn length and width', () => {
    /*
     * Not cosmetic. The machine is drawn around `z = 2.5` to `4`, which is
     * inside the band where obstacles still exist, and it has no collider - so
     * it visibly drives through whatever the player just jumped and through the
     * last few metres of any rail they just left. Every extra centimetre of
     * length is a centimetre more of that.
     */
    const box = machine.boundingBox!;
    expect(box.max.z - box.min.z).toBeLessThanOrEqual(PATROL.drawnLength + FLOAT32_SLACK);
    expect(box.max.x - box.min.x).toBeLessThanOrEqual(PATROL.drawnWidth + FLOAT32_SLACK);
  });

  it('is built to the footprint the framing is derived from', () => {
    /*
     * The cap is a ceiling; `MACHINE_LENGTH` and `MACHINE_WIDTH` are what the
     * machine actually is, and the framing maths uses the latter - the depth it
     * is drawn at, and how far outboard it rides, both come out of where its
     * flank lands. Let the geometry drift away from those two numbers and every
     * framing guarantee below is computed about a machine that does not exist.
     *
     * A three-centimetre floor rather than an equality, because the length is
     * reached by a rotated ski tip whose corner lands on the cap by
     * construction rather than by arithmetic.
     */
    const box = machine.boundingBox!;
    expect(box.max.x - box.min.x).toBeCloseTo(MACHINE_WIDTH, 3);
    expect(box.max.z - box.min.z).toBeGreaterThan(MACHINE_LENGTH - 0.03);
    expect(box.max.z - box.min.z).toBeLessThanOrEqual(MACHINE_LENGTH + FLOAT32_SLACK);
  });

  it('sits on the snow', () => {
    // A machine floating clear of the slope is the first thing a low camera
    // sees, and the skis are the part closest to the bottom of the frame.
    const box = machine.boundingBox!;
    expect(box.min.y).toBeGreaterThanOrEqual(-0.01);
    expect(box.min.y).toBeLessThan(0.06);
  });

  it('stands tall enough to read as a vehicle rather than a lump', () => {
    // The counterweight to every framing test below: they are all satisfiable
    // by shrinking the machine back to the capsule it used to be.
    const box = patrolBox(0, 0);
    expect(box.max.y).toBeGreaterThan(1.5);
    expect(machine.getAttribute('position').count).toBeGreaterThan(400);
    expect(rider.getAttribute('position').count).toBeGreaterThan(200);
  });

  it('puts its detail on the face the player actually sees', () => {
    /*
     * The machine is drawn *between* the camera and the player, so the face in
     * view is its rear - the opposite of every obstacle, which arrive from -z.
     * Same check `tests/models.test.ts` runs on the props, and it exists because
     * the chalet presented the player with a blank wall for the life of the
     * project while all its detail faced away.
     */
    const positions = machine.getAttribute('position');
    const colors = machine.getAttribute('color');
    const rear = new Set<string>();
    const front = new Set<string>();

    for (let i = 0; i < positions.count; i++) {
      const z = positions.getZ(i);
      if (Math.abs(z) < 0.02) continue;
      const key = [colors.getX(i), colors.getY(i), colors.getZ(i)]
        .map((channel) => channel.toFixed(2))
        .join(',');
      (z > 0 ? rear : front).add(key);
    }

    expect(rear.size).toBeGreaterThanOrEqual(front.size);
  });

  it('is wound outwards everywhere, so no panel has a hole in it', () => {
    /*
     * The machine is no longer built entirely from `THREE.BoxGeometry`: the
     * taper is hand-authored, twelve triangles with their winding written out by
     * hand, and `computeVertexNormals` takes the normal from that winding. A
     * triangle listed the wrong way round therefore faces *into* the solid, and
     * with a single-sided material that is a hole you can see the snow through -
     * on one flank of one panel, at one angle, which is precisely the sort of
     * thing that ships.
     *
     * Checked as a manifold property rather than by testing normals against a
     * centre, because "outward" has no meaning for a merged soup of thirty
     * overlapping pieces. Every closed, consistently wound mesh uses each edge
     * exactly twice, once in each direction; a union of such meshes still does,
     * even where two pieces happen to share an edge. Flip one triangle and three
     * edges stop cancelling.
     */
    for (const [name, geometry] of [
      ['machine', machine],
      ['rider', rider],
    ] as const) {
      const positions = geometry.getAttribute('position');
      const directed = new Map<string, number>();
      const key = (i: number): string =>
        `${positions.getX(i).toFixed(4)},${positions.getY(i).toFixed(4)},${positions.getZ(i).toFixed(4)}`;

      for (let t = 0; t < positions.count; t += 3) {
        const corners = [key(t), key(t + 1), key(t + 2)];
        for (let e = 0; e < 3; e++) {
          const edge = `${corners[e]}->${corners[(e + 1) % 3]}`;
          directed.set(edge, (directed.get(edge) ?? 0) + 1);
        }
      }

      for (const [edge, count] of directed) {
        const [from, to] = edge.split('->');
        expect(directed.get(`${to}->${from}`) ?? 0, `${name}: unpaired edge ${edge}`).toBe(count);
      }
    }
  });
});

// --- The silhouette ----------------------------------------------------------

describe('patrol silhouette', () => {
  const machine = patrolMachineGeometry();
  const rider = patrolRiderGeometry();

  const skis = partBox(machine, PATROL_LIVERY.ski);
  const bodywork = partBox(machine, PATROL_LIVERY.body);
  const screen = partBox(machine, PATROL_LIVERY.screen);
  const screenEdge = partBox(machine, PATROL_LIVERY.screenEdge);
  const helmet = partBox(rider, PATROL_LIVERY.helmet);

  it('frames the nose with the skis rather than hiding them inside it', () => {
    /*
     * The first of the three cues, and the one that was measurably absent. The
     * skis used to sit at `+-0.34` on a machine whose cowl was `+-0.43`: from
     * behind, the entire front end was inside the bodywork's own outline, so a
     * model with two skis on it drew none. A real ski stance is wider than the
     * tunnel, and it has to be here for exactly the reason it is there.
     *
     * The margin is a tenth of a metre because anything less is a pixel or two
     * at the distance this object is drawn - which is the same as nothing.
     */
    expect(halfWidthOf(skis)).toBeGreaterThan(halfWidthOf(bodywork) + 0.1);
    // And they reach the machine's full half width, so the outermost thing in
    // the outline is a ski and not a corner of the bodywork.
    expect(halfWidthOf(skis)).toBeCloseTo(MACHINE_WIDTH / 2, 3);
  });

  it('puts the ski tips at the very front, turned up off the snow', () => {
    // The counterweight: splaying the skis sideways is worth nothing if they end
    // level with the nose, where they read as part of the bodywork. The tips
    // have to be the front-most geometry on the machine and standing clear of
    // the snow, or they are a stripe rather than a ski.
    expect(skis.min.z).toBeCloseTo(machine.boundingBox!.min.z, 3);
    expect(skis.min.z).toBeLessThan(bodywork.min.z - 0.05);
    expect(skis.max.y).toBeGreaterThan(0.12);
  });

  it('stands the screen clear above the cowl and wider than the head', () => {
    /*
     * The second cue. The old screen was 0.5 wide and 0.36 tall, sitting below
     * the rider's shoulder line and inside their outline - present in the mesh,
     * absent from every frame. Both halves of the fix are asserted: it has to
     * clear the bodywork it stands on, and it has to be wider than the head in
     * front of it, or it is simply hidden again by a different thing.
     */
    expect(screen.max.y).toBeGreaterThan(bodywork.max.y + 0.5);
    expect(screen.max.x - screen.min.x).toBeGreaterThan((helmet.max.x - helmet.min.x) * 1.5);
    // The bright edge along the top is the highest thing on the machine, so it
    // draws the top of the outline rather than sitting somewhere inside it -
    // which is the whole reason a mid-value panel gets a light line on it.
    expect(screenEdge.max.y).toBeCloseTo(machine.boundingBox!.max.y, 3);
  });

  it('leaves the tread bars outside the tunnel they break up', () => {
    /*
     * They were inside it. The tunnel's rear face sat at z = 0.99 and the three
     * bars were centred on 0.97, so the only pieces on the machine whose job is
     * to stop the darkest mass reading as a hole cut in the snow were buried in
     * that mass and had never been drawn a single frame. Rendered, the tail was
     * twenty-three rows of one flat value.
     *
     * A geometry test rather than a projected one because it is not a question
     * of framing: a part inside another part is invisible from every angle, and
     * nothing else in this file would ever notice.
     */
    const machineBox = machine.boundingBox!;
    const tread = partBox(machine, PATROL_LIVERY.treadBar);
    const tunnel = partBox(machine, PATROL_LIVERY.trackTunnel);
    const flap = partBox(machine, PATROL_LIVERY.flap);

    expect(tread.max.z, 'tread bars are buried in the tunnel').toBeGreaterThan(tunnel.max.z);
    expect(tread.max.z, 'tread bars are behind the flap').toBeGreaterThan(flap.max.z);
    // And they are the back of the machine, so nothing can be added behind them
    // without the length cap catching it.
    expect(tread.max.z).toBeCloseTo(machineBox.max.z, 3);
    // The counterweight: a bar standing proud is worth nothing if it is the same
    // value as what it stands on. `PATROL.liveryFloor` collapses everything
    // under it onto one value, so the whole tail lives in a narrow band and the
    // separation has to be authored deliberately.
    expect(value(PATROL_LIVERY.treadBar) - value(PATROL_LIVERY.trackTunnel)).toBeGreaterThan(0.15);
  });

  it('stands the rider s head clear above the screen', () => {
    /*
     * The third cue, and the one that must survive when the other two are
     * cropped away. The head sits on the centre line, which is the part of the
     * machine the frame edge never reaches, and it is the difference between a
     * vehicle with somebody riding it and a stack of panels.
     */
    const headTop = RIDER_SEAT[1] + rider.boundingBox!.max.y;
    expect(headTop).toBeGreaterThan(machine.boundingBox!.max.y + 0.2);
    expect(headTop).toBeCloseTo(RIDER_SEAT[1] + helmet.max.y, 3);
  });
});

// --- The livery --------------------------------------------------------------

describe('patrol livery', () => {
  const entries = Object.entries(PATROL_LIVERY);

  it('never authors a panel darker than the value floor', () => {
    /*
     * The measured defect, and it is a lighting fact rather than a taste one.
     * Both the key and `SKY.sunDirection` point down-track, so a panel turned
     * towards the camera receives neither and is left with the fill and the
     * hemisphere alone; push the old `#0c0f13` tread through that and ACES
     * returns literal `rgb(0, 0, 0)`. That is the black crate in the critique -
     * not a dark surface but a hole - and nothing on a snowfield under a bright
     * sky is that dark, because the snow itself bounces too much light back up.
     */
    for (const [name, hex] of entries) {
      expect(value(hex), `${name} is authored below the livery floor`).toBeGreaterThanOrEqual(
        value(PATROL.liveryFloor) - 1 / 255,
      );
    }
  });

  it('spends the floor on exactly one panel, so the dark end is a ramp', () => {
    /*
     * The counterweight, and it is the whole reason the palette was rearranged
     * rather than just clamped. `floorValue` lifts by exactly what the brightest
     * channel was short of, so **every colour under the floor comes out at the
     * same value**: author two dark panels and they arrive as one flat mass, and
     * the facet breakup that motivated having a tread pattern at all disappears.
     * Only the track tunnel may sit on the floor. The tread bars are now lighter
     * than it, which is also what raised bars actually do to light.
     */
    const onFloor = entries.filter(([, hex]) => value(hex) <= value(PATROL.liveryFloor) + 1 / 255);
    expect(onFloor.map(([name]) => name)).toEqual(['trackTunnel']);
    expect(value(PATROL_LIVERY.treadBar)).toBeGreaterThan(value(PATROL_LIVERY.trackTunnel) + 0.04);
  });

  it('still runs a full value ramp from that floor to a near-white', () => {
    // A floor is only safe if there is something bright to read it against. A
    // deep value with nothing pale beside it is just a dark object.
    const brightest = Math.max(...entries.map(([, hex]) => value(hex)));
    expect(brightest).toBeGreaterThan(0.9);
    expect(brightest - value(PATROL_LIVERY.trackTunnel)).toBeGreaterThan(0.4);
  });

  it('is pulled back into the palette rather than out of it', () => {
    /*
     * `PATROL.liverySaturation` is below 1: it desaturates. The machine measured
     * as the most saturated, highest-contrast mass in the frame, arriving at the
     * one moment the player most needs to read the track instead of the
     * decoration - and coins are meant to be the only warm accent in the play
     * space, which a red slab covering a fifth of the screen takes away from
     * them.
     *
     * The authored red is held as a literal here for the same reason
     * `tests/visuals.test.ts` holds it: wrapping it in the function under test
     * would assert nothing at all.
     */
    const AUTHORED_RED = '#b8322c';
    expect(chroma(PATROL_LIVERY.body)).toBeLessThan(chroma(AUTHORED_RED));

    // And the counterweight: deliberately not zero. The patrol has to stay
    // identifiable as ski patrol, and the red and the cross are how.
    const raw = PATROL_LIVERY.body.replace('#', '');
    const [red, , blue] = [0, 2, 4].map((i) => parseInt(raw.slice(i, i + 2), 16));
    expect(red!).toBeGreaterThan(blue! * 2);
    expect(chroma(PATROL_LIVERY.body)).toBeGreaterThan(chroma(AUTHORED_RED) * 0.5);
  });

  it('carries a near-white lens against it', () => {
    // The other end of the ramp, measured on the built geometry rather than the
    // table, so a colour that never reaches a piece cannot satisfy it.
    const brightest = Math.max(...tones(patrolMachineGeometry()).map((tone) => tone.luma));
    expect(brightest).toBeGreaterThan(referenceLuma('#dcdcdc'));
  });
});

describe('patrol rider', () => {
  const list = tones(patrolRiderGeometry());
  const area = totalArea(list);
  const meanLuma = list.reduce((sum, tone) => sum + tone.luma * tone.area, 0) / area;

  it('is a warm mid-value, so it reads as neither the yeti nor a hole', () => {
    /*
     * The failure this whole package exists to avoid, in both directions. Pale
     * is the player: a second near-white mass right behind a near-white
     * silhouette is worse than no machine at all. Near-black merges with the
     * garment-darkened rider into one blob at the size the figure occupies on a
     * six-inch screen, which is a gameplay failure rather than an ugly one - the
     * old rider was `#22303a`, about 18% luminance.
     *
     * Weighted by area, so it measures what the eye sees rather than how finely
     * the helmet happens to be tessellated.
     */
    expect(meanLuma).toBeGreaterThan(referenceLuma('#4a4a4a'));
    expect(meanLuma).toBeLessThan(referenceLuma('#a0a0a0'));

    const meanRed = list.reduce((sum, tone) => sum + tone.r * tone.area, 0) / area;
    const meanBlue = list.reduce((sum, tone) => sum + tone.b * tone.area, 0) / area;
    expect(meanRed).toBeGreaterThan(meanBlue * 1.5);
  });

  it('keeps pale and black off most of the figure', () => {
    const pale = list.filter((tone) => tone.luma > referenceLuma('#d0d0d0'));
    const black = list.filter((tone) => tone.luma < referenceLuma('#2a2a2a'));
    expect(totalArea(pale) / area).toBeLessThan(0.2);
    expect(totalArea(black) / area).toBeLessThan(0.3);
  });
});

// --- Framing -----------------------------------------------------------------

describe('patrol framing', () => {
  it('is drawn in front of the eye at every lens and aspect', () => {
    for (const aspect of ASPECTS) {
      for (const fov of FOVS) {
        for (const cameraZ of cameraDistances(fov, aspect)) {
          const z = patrolDrawnZ(cameraZ, fov, aspect);
          // Behind the player, ahead of the lens, and clear of both.
          expect(z).toBeGreaterThan(TUNING.player.z + PATROL.drawnLength / 2);
          expect(cameraZ - z).toBeGreaterThan(2.5);
        }
      }
    }
  });

  it('holds its outboard flank on the frame edge rather than a fixed metre', () => {
    /*
     * The guarantee the shoulder offset buys is a separation *on the screen*,
     * and a fixed number of metres is not that. The machine is drawn much
     * further from the eye than the player is, so its lateral offset shrinks in
     * frame while the player's does not - push the machine back to make it
     * legible and the two outlines converge without anything moving sideways.
     * That is what happened when `frameReach` came down to 1.0, and the measured
     * gap fell to about a fiftieth of what it needs.
     *
     * So this asserts the two regimes. Where the reach rule sets the depth, the
     * arithmetic cancels and the offset is *exactly* `PATROL.shoulderOffset` -
     * nothing changes on a portrait phone. Where `PATROL.minDepth` has overriden
     * the reach, the machine has been pushed further back than the framing asked
     * for and the offset widens to match.
     */
    let reachBound = 0;
    let depthBound = 0;

    for (const aspect of ASPECTS) {
      for (const fov of FOVS) {
        const depth = patrolDepth(fov, aspect);
        const outboard = patrolOutboard(fov, aspect);
        const where = `aspect ${aspect.toFixed(3)} fov ${fov}`;

        // Never inboard of the authored shoulder, whichever rule binds.
        expect(outboard, where).toBeGreaterThanOrEqual(PATROL.shoulderOffset - 1e-9);
        // And the flank lands on the frame line in both regimes, which is the
        // property the whole thing exists for.
        expect(outboard + MACHINE_WIDTH / 2, `flank off the frame line: ${where}`).toBeCloseTo(
          PATROL.frameReach * horizontalHalfExtentAt(depth, fov, aspect),
          9,
        );

        if (depth > PATROL.minDepth + 1e-9) {
          reachBound++;
          expect(outboard, `reach-bound: ${where}`).toBeCloseTo(PATROL.shoulderOffset, 9);
        } else {
          depthBound++;
        }
      }
    }

    // Both regimes have to be exercised, or one of the branches above is dead.
    expect(reachBound).toBeGreaterThan(0);
    expect(depthBound).toBeGreaterThan(0);

    /*
     * The depth-bound branch used to carry a per-case
     * `> PATROL.shoulderOffset + 0.05`, and that bound was unattainable rather
     * than merely tight: the two rules *agree exactly* at the crossover, so the
     * widening leaves zero continuously and any positive per-case floor fails
     * for aspects near it. Aspect 0.520 at fov 58 sits a hair inside the
     * clamp and widens by 0.041, which the old constant read as a defect when
     * it is the arithmetic behaving correctly. The 0.05 was a property of which
     * aspects happen to be in the list, not of the design.
     *
     * What is a property of the design gets asserted instead, and it is
     * strictly more than the constant said:
     */

    // One - the offset only ever grows as the frame widens. This is the actual
    // claim ("the offset widens to match"), it holds at the crossover instead of
    // breaking there, and it is what would catch the offset being pinned to a
    // fixed metre or moving the wrong way.
    for (const fov of FOVS) {
      const byAspect = ASPECTS.map((aspect) => patrolOutboard(fov, aspect));
      for (let i = 1; i < byAspect.length; i++) {
        const narrower = `fov ${fov}: aspect ${ASPECTS[i]} came inboard of ${ASPECTS[i - 1]}`;
        expect(byAspect[i]!, narrower).toBeGreaterThanOrEqual(byAspect[i - 1]! - 1e-9);
      }
      expect(
        byAspect.at(-1)!,
        `fov ${fov}: nothing widened across the whole sweep`,
      ).toBeGreaterThan(byAspect[0]! + 0.05);
    }

    // Two - the counterweight, on the case that actually ships. Monotonicity
    // alone is satisfied by a machine that never moves, so the widening has to
    // be worth something where it is read: on the reference phone, at the top of
    // the speed sweep, the flank stands 0.217 m outboard of the authored
    // shoulder. Asserted at 0.15 so a retune has room without the guarantee
    // silently becoming decorative.
    const widestOnPhone = patrolOutboard(FOVS.at(-1)!, PHONE_ASPECT) - PATROL.shoulderOffset;
    expect(widestOnPhone).toBeGreaterThan(0.15);
  });

  it('never overlaps the player, in any lane, at any lens or aspect', () => {
    let cases = 0;

    for (const aspect of ASPECTS) {
      for (const fov of FOVS) {
        for (const cameraZ of cameraDistances(fov, aspect)) {
          for (const placement of PLACEMENTS) {
            const laneX = LANES[placement.lane]!;
            const { eye, target } = rigFor(laneX, cameraZ);
            const z = patrolDrawnZ(cameraZ, fov, aspect);
            const x = patrolShoulderX(laneX, placement.side, fov, aspect);

            const patrol = silhouette(patrolBox(x, z), eye, target, fov, aspect);
            const player = silhouette(playerBox(laneX), eye, target, fov, aspect);
            const where = `${placement.label} @ aspect ${aspect.toFixed(3)} fov ${fov}`;

            expect(patrol, `patrol is off the frame entirely: ${where}`).not.toBeNull();
            expect(player, `player is off the frame entirely: ${where}`).not.toBeNull();
            if (!patrol || !player) continue;

            // Disjoint horizontally, with room to spare. A hair's-breadth miss
            // at one aspect is a hit at the next one.
            const gap =
              patrol.minX > player.maxX ? patrol.minX - player.maxX : player.minX - patrol.maxX;
            expect(gap, `patrol crowds the player: ${where}`).toBeGreaterThan(0.04);
            cases++;
          }
        }
      }
    }

    // The sample size is part of the assertion: a sweep that silently stopped
    // generating cases would pass every check above it.
    expect(cases).toBe(ASPECTS.length * FOVS.length * 2 * PLACEMENTS.length);
  });

  it('is genuinely on screen while that holds', () => {
    /*
     * The counterweight, and the half that actually got broken. "Does not
     * overlap the player" is satisfied perfectly by a machine drawn seventeen
     * units behind the lens - which is precisely what shipped. So this asserts
     * the machine occupies a real span of the frame, low in it, and is not
     * hanging off the bottom edge.
     */
    for (const aspect of ASPECTS) {
      for (const fov of FOVS) {
        for (const cameraZ of cameraDistances(fov, aspect)) {
          for (const placement of PLACEMENTS) {
            const laneX = LANES[placement.lane]!;
            const { eye, target } = rigFor(laneX, cameraZ);
            const patrol = silhouette(
              patrolBox(
                patrolShoulderX(laneX, placement.side, fov, aspect),
                patrolDrawnZ(cameraZ, fov, aspect),
              ),
              eye,
              target,
              fov,
              aspect,
            );
            const where = `${placement.label} @ aspect ${aspect.toFixed(3)} fov ${fov}`;
            expect(patrol, where).not.toBeNull();
            if (!patrol) continue;

            const onScreen = Math.min(patrol.maxX, 1) - Math.max(patrol.minX, -1);
            expect(onScreen, `patrol barely on screen: ${where}`).toBeGreaterThan(0.45);
            // Its top is inside the frame - not below the bottom edge - and it
            // stays in the lower half, where it cannot mask the oncoming track.
            expect(patrol.maxY, `patrol below the frame: ${where}`).toBeGreaterThan(-0.7);
            expect(patrol.maxY, `patrol too high in frame: ${where}`).toBeLessThan(0.15);
          }
        }
      }
    }
  });

  it('is kept clear by its shoulder offset and nothing else', () => {
    /*
     * The counterweight to the counterweight. Every case above passes if the
     * machine and the player simply never share a band of the screen, which
     * would make the horizontal separation decorative. They do share one - the
     * machine sits low and slightly behind, and the two overlap vertically - so
     * the shoulder offset is carrying the entire guarantee.
     */
    const fov = TUNING.camera.fov;
    const cameraZ = cameraDistances(fov, PHONE_ASPECT)[0]!;
    const { eye, target } = rigFor(LANES[1]!, cameraZ);

    const patrol = silhouette(
      patrolBox(
        patrolShoulderX(LANES[1]!, -1, fov, PHONE_ASPECT),
        patrolDrawnZ(cameraZ, fov, PHONE_ASPECT),
      ),
      eye,
      target,
      fov,
      PHONE_ASPECT,
    )!;
    const player = silhouette(playerBox(LANES[1]!), eye, target, fov, PHONE_ASPECT)!;

    expect(Math.min(patrol.maxY, player.maxY)).toBeGreaterThan(Math.max(patrol.minY, player.minY));
  });

  it('would sit right behind the player on the wrong shoulder', () => {
    /*
     * And the counterweight to `patrolSideFor`: "outer lanes bias inward" is an
     * assertion about a real hazard, not a style note. In the right-hand lane
     * the camera has followed 38% of the offset while the player is at 100% of
     * it, so a machine biased *outward* lands squarely on top of the player.
     */
    const fov = TUNING.camera.fov;
    const cameraZ = cameraDistances(fov, PHONE_ASPECT)[0]!;
    const laneX = LANES[2]!;
    const { eye, target } = rigFor(laneX, cameraZ);
    const z = patrolDrawnZ(cameraZ, fov, PHONE_ASPECT);

    const wrong = silhouette(
      patrolBox(patrolShoulderX(laneX, 1, fov, PHONE_ASPECT), z),
      eye,
      target,
      fov,
      PHONE_ASPECT,
    )!;
    const player = silhouette(playerBox(laneX), eye, target, fov, PHONE_ASPECT)!;

    expect(Math.min(wrong.maxX, player.maxX)).toBeGreaterThan(Math.max(wrong.minX, player.minX));
  });

  it('rides inboard in the outer lanes and trails the last change in the centre', () => {
    expect(patrolSideFor(0, 1)).toBe(1);
    expect(patrolSideFor(2, 1)).toBe(-1);
    // Whichever lane the player just left is the side the machine trails on.
    expect(patrolSideFor(1, 0)).toBe(-1);
    expect(patrolSideFor(1, 2)).toBe(1);
  });
});

// --- What it actually covers --------------------------------------------------

/**
 * The frame edge an overrun has to exceed before it counts as a crop, in
 * half-widths.
 *
 * Five percent of a half width is about nine pixels across a 375-point phone: a
 * corner clipping the edge, not a piece of the machine missing. Below this the
 * shape still closes in the eye, which is the property "cropped by two edges at
 * once" destroys and the only reason the count is being made.
 */
const CROP_BITE = 0.05;

describe('patrol coverage', () => {
  /** Every case, with the pixels it paints. */
  const cases = ASPECTS.flatMap((aspect) =>
    FOVS.flatMap((fov) =>
      cameraDistances(fov, aspect).flatMap((cameraZ) =>
        PLACEMENTS.map((placement) => {
          const laneX = LANES[placement.lane]!;
          const { eye, target } = rigFor(laneX, cameraZ);
          const x = patrolShoulderX(laneX, placement.side, fov, aspect);
          const z = patrolDrawnZ(cameraZ, fov, aspect);
          return {
            where: `${placement.label} @ aspect ${aspect.toFixed(3)} fov ${fov}`,
            pixels: rasterise(patrolVertices(x, z), eye, target, fov, aspect),
          };
        }),
      ),
    ),
  );

  it('owns under a tenth of the frame it arrives in', () => {
    /*
     * The headline number from the critique - "occupying 20-25% of the frame" -
     * and the only test in this file that measures it, because the bounding box
     * every other framing test uses cannot: it reports the same area for the
     * tapered machine as for the slab-sided one it replaced.
     *
     * Rasterised, the worst case is 8.75% on the reference phone, against 9.85%
     * for the pre-taper model at the same placement and 20-25% for the model
     * before the framing was retuned.
     *
     * The bound is 9.2%, and it is deliberately set *below the pre-taper
     * measurement* rather than at a round number with comfortable headroom. A
     * threshold no version of this model has ever crossed does not discriminate:
     * putting the full-width rear back has to fail this test, or it is not
     * testing the fix. There is no randomness in the number, so tight is safe.
     */
    for (const { where, pixels } of cases) {
      expect(pixels.covered, `patrol owns too much of the frame: ${where}`).toBeLessThan(0.092);
    }
  });

  it('is still a presence rather than a speck', () => {
    /*
     * The counterweight, and the one that matters most here: every bound above
     * is satisfied perfectly by drawing nothing. The patrol is the game's only
     * antagonist and it arrives at the moment of peak tension, so it has to be
     * large - the complaint was never that it was big, it was that it was big
     * *and illegible*. On the aspect the game ships on it paints 8.75% of the
     * screen, and the floor below holds it above a twelfth.
     */
    for (const { where, pixels } of cases) {
      expect(pixels.covered, `patrol has been shrunk into nothing: ${where}`).toBeGreaterThan(0.04);
    }

    const fov = TUNING.camera.fov;
    const cameraZ = cameraDistances(fov, PHONE_ASPECT)[0]!;
    const laneX = LANES[1]!;
    const { eye, target } = rigFor(laneX, cameraZ);
    const patrol = rasterise(
      patrolVertices(
        patrolShoulderX(laneX, -1, fov, PHONE_ASPECT),
        patrolDrawnZ(cameraZ, fov, PHONE_ASPECT),
      ),
      eye,
      target,
      fov,
      PHONE_ASPECT,
    );
    expect(patrol.covered).toBeGreaterThan(0.075);
  });

  it('is cut by at most one frame edge, and never the top', () => {
    /*
     * The measured verdict was a mass "cropped by TWO frame edges at once", and
     * a shape cut on two sides stops being a snowmobile and becomes a stack of
     * coloured boxes - the eye cannot close an outline that leaves the frame
     * twice. Cropping itself is not the defect: being cut by the bottom edge is
     * what sitting in the near snow looks like, and it is what the wide aspects
     * do here.
     *
     * The top is absolute. This object lives in the lower frame and a machine
     * running off the top edge is one drawn into the oncoming track.
     */
    for (const { where, pixels } of cases) {
      const { left, right, top, bottom } = pixels.overrun;
      expect(top, `runs off the top: ${where}`).toBe(0);
      const cut = [left, right, bottom].filter((edge) => edge > CROP_BITE);
      expect(cut.length, `cropped by ${cut.length} edges at once: ${where}`).toBeLessThanOrEqual(1);
    }
  });

  it('still fills the corner it sits in', () => {
    /*
     * And the counterweight to that: "cut by at most one edge" is satisfied by
     * backing the machine off into the middle of the frame, which would throw
     * away the crowding the whole mechanic is for. On the phone the machine is
     * cut by neither edge and touches both - its flank lands within a fiftieth
     * of a half width of the outboard edge and its skis within a fiftieth of the
     * bottom - which is `PATROL.frameReach` doing exactly what it says.
     */
    const fov = TUNING.camera.fov;
    const cameraZ = cameraDistances(fov, PHONE_ASPECT)[0]!;
    const laneX = LANES[1]!;
    const { eye, target } = rigFor(laneX, cameraZ);
    const patrol = rasterise(
      patrolVertices(
        patrolShoulderX(laneX, -1, fov, PHONE_ASPECT),
        patrolDrawnZ(cameraZ, fov, PHONE_ASPECT),
      ),
      eye,
      target,
      fov,
      PHONE_ASPECT,
    );

    expect(patrol.span.minX, 'flank has come inboard of the frame edge').toBeLessThan(-0.93);
    expect(patrol.span.minY, 'machine no longer reaches the bottom of the frame').toBeLessThan(
      -0.93,
    );
  });
});

describe('patrol silhouette, projected', () => {
  /*
   * The same three cues as the model-space silhouette tests, asked again about
   * the frame - and they are not the same question. The lens sits about 1.5 m
   * behind this object's tail, so its nose is a fifth further away than its
   * back and everything up there is foreshortened towards the centre line by
   * that ratio. A ski 0.07 m proud of the rear skirt in the model was 0.000
   * proud of it on screen, which is how a model carrying two skis, a windscreen
   * and a set of handlebars measured as having none of them.
   */
  const fov = TUNING.camera.fov;
  const cameraZ = cameraDistances(fov, PHONE_ASPECT)[0]!;
  const laneX = LANES[1]!;
  const { eye, target } = rigFor(laneX, cameraZ);
  const project = viewFor(eye, target, fov, PHONE_ASPECT);
  // The left shoulder, so the lens sees the machine's *inboard* flank and
  // inboard is +x on the frame. Both shoulders are mirror images of each other
  // about the machine's own centre line, so one is the whole story.
  const machineAt = new THREE.Vector3(
    patrolShoulderX(laneX, -1, fov, PHONE_ASPECT),
    0,
    patrolDrawnZ(cameraZ, fov, PHONE_ASPECT),
  );
  const riderAt = machineAt
    .clone()
    .add(new THREE.Vector3(RIDER_SEAT[0], RIDER_SEAT[1], RIDER_SEAT[2]));

  const machine = patrolMachineGeometry();
  const partSpan = (hex: string): Span => projectedPartSpan(machine, hex, machineAt, project);

  it('shows a ski standing clear of the bodywork on the inboard side', () => {
    /*
     * Inboard, and only inboard, because that is the side of this object the
     * lens can see: the machine rides at a shoulder, so the frame shows its
     * inboard flank and its outboard flank sits on the frame edge. It is also
     * the side that is never cropped.
     *
     * The outboard outline is *not* asserted and would fail if it were, which is
     * worth writing down rather than leaving for somebody to rediscover: the
     * machine's outboard-most point is the rear of the body, because the rear is
     * 1.5 m nearer the lens than the skis are and wins the projection despite
     * being 0.12 m narrower. That is the taper working, not a defect.
     *
     * The bound is 0.08 of a half width - about fifteen pixels of clear snow at
     * the reference size - and it is set where it is because that is what
     * discriminates. The slab-sided skirt this replaced measured 0.064 and the
     * taper measures 0.095, so a bound of 0.04 would have passed on the geometry
     * the critique was written about and proved nothing at all.
     */
    const skis = partSpan(PATROL_LIVERY.ski);
    const body = partSpan(PATROL_LIVERY.body);
    const skirt = partSpan(PATROL_LIVERY.bodyShade);
    const bodywork = Math.max(body.maxX, skirt.maxX);

    expect(skis.maxX, 'inboard ski is inside the bodywork').toBeGreaterThan(bodywork + 0.08);
  });

  it('does not buy that clearance by shrinking the machine', () => {
    /*
     * The counterweight. A ski clears the bodywork trivially if the bodywork is
     * a stick, and the whole point of the taper is that the machine still has a
     * body - it is a snowmobile that got a waist, not a snowmobile that got
     * thin. So the widest bodywork has to stay within a hand's width of the ski
     * stance in the *model*, where perspective cannot flatter it.
     */
    const skirt = partBox(patrolMachineGeometry(), PATROL_LIVERY.bodyShade);
    expect(halfWidthOf(skirt)).toBeGreaterThan(MACHINE_WIDTH / 2 - 0.15);
  });

  it('shows the windscreen inboard of the rider in front of it', () => {
    /*
     * The screen is behind the rider from the lens, so what makes it visible is
     * not being wider than the shoulders - it is being wider than the shoulders
     * *plus* the foreshortening between them. Asserted inboard for the same
     * reason as the ski, and because the offset placement puts more of the rider
     * over the screen's outboard half than its inboard one.
     *
     * Measured against the cross on the rider's back rather than against
     * `jacket`, and the distinction is not pedantry: `jacket` includes the arms,
     * which reach out to grips deliberately set wider than the screen, so a span
     * over the whole garment says the rider covers a screen that is plainly
     * visible either side of the body. The back plate is the torso's own width
     * and sits on the centre line, which is the occluder actually in question.
     */
    const screen = partSpan(PATROL_LIVERY.screen);
    const back = projectedPartSpan(patrolRiderGeometry(), PATROL_LIVERY.hiVis, riderAt, project);
    expect(screen.maxX, 'the rider covers the screen entirely').toBeGreaterThan(back.maxX + 0.1);
    // And it stands above the cowl, which is the other half of "there is a
    // windscreen" - a panel level with the bodywork is a panel nobody sees.
    const body = partSpan(PATROL_LIVERY.body);
    expect(screen.maxY, 'the screen has sunk into the bodywork').toBeGreaterThan(body.maxY + 0.05);
  });

  it('shows the grips standing clear of the screen', () => {
    // The third cue. Grips are `trackTunnel`, which the tunnel also carries, so
    // this is asserted about the bar - the piece they cap - to keep the span
    // honest about which part is being measured.
    const bar = partSpan(PATROL_LIVERY.chassis);
    const screen = partSpan(PATROL_LIVERY.screen);
    expect(bar.maxX, 'the bar ends inside the screen').toBeGreaterThan(screen.maxX + 0.02);
  });

  it('keeps the head clear of everything, on the centre line', () => {
    // The cue that has to survive when the others are cropped: the head is the
    // topmost thing on the frame and it sits where no frame edge reaches.
    const helmet = projectedPartSpan(patrolRiderGeometry(), PATROL_LIVERY.helmet, riderAt, project);
    const edge = partSpan(PATROL_LIVERY.screenEdge);
    expect(helmet.maxY, 'the head has sunk behind the screen').toBeGreaterThan(edge.maxY + 0.01);
    expect(Math.abs(helmet.maxX), 'the head is at a frame edge').toBeLessThan(0.9);
  });
});

// --- The approach ------------------------------------------------------------

/** Runs the follower at 60 Hz and reports the trace. */
function trace(target: number, seconds: number, from = createApproach()): number[] {
  const step = TUNING.sim.step;
  const values: number[] = [];
  for (let i = 0; i < Math.round(seconds / step); i++) {
    stepApproach(from, target, step);
    values.push(from.value);
  }
  return values;
}

function timeToReach(values: number[], predicate: (value: number) => boolean): number {
  const index = values.findIndex(predicate);
  return index < 0 ? Infinity : (index + 1) * TUNING.sim.step;
}

describe('patrol approach', () => {
  it('sweeps in rather than materialising', () => {
    /*
     * The defect this replaces: `stepAvalanche` pins `chaser.distance` from 26
     * to 5 on a single tick, and the renderer assigned `position.z` straight
     * from it. The simulation's snap must stay exactly as it is - the avalanche
     * and caught tests are built on it - so the easing is entirely here.
     */
    const values = trace(1, 3);
    expect(values[0]).toBeLessThan(0.05);
    // Most of the way in by the time it is meant to be, and not before.
    expect(timeToReach(values, (value) => value > 0.5)).toBeGreaterThan(
      PATROL.approachSeconds * 0.25,
    );
    expect(timeToReach(values, (value) => value > 0.95)).toBeLessThan(PATROL.approachSeconds * 1.5);
  });

  it('arrives slightly too close and settles back', () => {
    /*
     * The overshoot is why this is a spring and not the `damp` used everywhere
     * else in the renderer. An exponential approach creeps onto the settled pose
     * from below, which reads as the machine being *placed*; nothing derived
     * from a settled exponential can put it past the mark either, because every
     * such shaping function is zero exactly where the overshoot would have to
     * be. Overshoot is second order or it does not exist.
     */
    const values = trace(1, 3);
    const peak = Math.max(...values);
    expect(peak).toBeGreaterThan(1.02);
    // Bounded, because the drawn Z extrapolates past the settled pose by this
    // fraction of the entry depth and must not walk into the camera.
    expect(peak).toBeLessThan(1 + PATROL.approachOvershoot * 1.6);
    expect(values.at(-1)).toBeCloseTo(1, 2);
  });

  it('leaves more reluctantly than it arrives, and does not bounce out', () => {
    const settled = createApproach();
    trace(1, 3, settled);
    const leaving = trace(0, 4, settled);

    expect(Math.min(...leaving)).toBeGreaterThan(-0.005);
    expect(leaving.at(-1)).toBeCloseTo(0, 2);
    expect(timeToReach(leaving, (value) => value < 0.05)).toBeGreaterThan(PATROL.approachSeconds);
    expect(timeToReach(leaving, (value) => value < 0.05)).toBeLessThan(PATROL.releaseSeconds * 1.6);
  });

  it('survives a frame that took a third of a second', () => {
    // An app coming back from the background. The spring is integrated with
    // semi-implicit Euler, which will happily explode on a long enough step -
    // and the patrol arriving in one jump is the artefact being removed.
    const state = createApproach();
    for (let i = 0; i < 20; i++) stepApproach(state, 1, 0.33);
    expect(Number.isFinite(state.value)).toBe(true);
    expect(state.value).toBeLessThan(2);
    expect(state.value).toBeGreaterThan(-1);
  });
});
