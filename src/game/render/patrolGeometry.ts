/**
 * The ski patrol snowmobile: its geometry, and the maths that decides where the
 * machine is drawn.
 *
 * Both halves live here because both are pure - no three renderer, no DOM, no
 * React - which is what lets `tests/patrol.test.ts` build the real meshes and
 * project them through the real camera framing in node. The placement is the
 * part that was actually broken, so it needs a test far more than the boxes do.
 *
 * **Facing.** The machine is drawn *between* the camera and the player, so the
 * face the player sees is its **rear**, and the camera sits about 25 degrees
 * above it. Every value decision below is about that rear three-quarter view:
 * detail on the -z face of this object is detail nobody will ever see, which is
 * the same trap the chalet fell into for the whole life of the project.
 *
 * **The silhouette has to survive being cropped.** Measured in a real frame, the
 * machine was "a black crate and a pale crate with a red cross on a red slab",
 * cut by two frame edges at once, and it never resolved into a snowmobile. Three
 * separate faults produced that, and all three are fixed here:
 *
 *  - It was drawn far too close and far too big, so the framing rules moved out
 *    to `PATROL.frameReach` / `minDepth` (see the framing section below) and the
 *    footprint shrank to {@link MACHINE_LENGTH} x {@link MACHINE_WIDTH}, inside
 *    the `drawnLength` / `drawnWidth` cap rather than filling it.
 *  - Every cue that says "snowmobile" was authored where the player cannot see
 *    it. The skis sat *inside* the body width, so from behind they never broke
 *    the outline; the windscreen sat below the rider's shoulders and behind the
 *    cowl; the bars were narrower than the screen. All three now stand proud of
 *    the mass in front of them, which is the only way a shape reads when half of
 *    it is off the edge of the screen: **ski tips outboard of the cowl, screen
 *    above the cowl and wider than the rider, head above the screen.**
 *  - **It had parallel sides.** Every panel was a box of roughly the machine's
 *    full width running its whole length, so the outline was a rectangle with a
 *    head on it - which is precisely the "stacked crates" read, and no amount of
 *    interior detail argues with an outline. A snowmobile is the opposite shape:
 *    a narrow tunnel and tail, boards flaring out under the rider, and a ski
 *    stance wider than any bodywork. {@link TAIL_WIDTH} to {@link SKI_STANCE} is
 *    that taper, and it is what gives the front of the machine an outline of its
 *    own instead of one continuous flank from the tips to the flap.
 *
 * **Width is a projected quantity, not a modelled one, and the projection is not
 * symmetric.** The lens sits about 1.5 m behind the tail, so the nose is a fifth
 * further away than the back and everything up there is foreshortened towards
 * the centre line by that ratio. The machine also rides at a *shoulder*, so what
 * the frame shows is its inboard flank, and the two facts compound in opposite
 * directions on the two sides:
 *
 *  - **Outboard**, the rear always wins. It is nearest the lens, so it swings
 *    widest whatever the skis do, and no ski stance that fits inside
 *    {@link MACHINE_WIDTH} can break that outline. The only lever is making the
 *    rear narrower, which is what the taper does.
 *  - **Inboard**, distance works the other way - a part further forward projects
 *    further *in* - so a wide rear skirt eats the gap the skis need. The old
 *    full-width skirt left them 0.064 of a half width clear; the taper leaves
 *    0.095, which is the difference between a sliver and a readable gap of snow
 *    between the ski and the machine.
 *
 * Every clearance below is therefore authored with the depth ratio already paid
 * for, and `tests/patrol.test.ts` checks the projected outline rather than the
 * model-space one - the model-space tests remain, but they are the weaker claim
 * and were passing throughout the period the machine measured as having no skis.
 *
 * **Value, not form.** `LIGHTING.key.position` is `[-46, 52, -20]`, so every
 * +z-facing surface in the game is key-unlit by construction - lit only by the
 * fill and the hemisphere. Flat-shaded facet breakup cannot read on a face that
 * has no directional light on it at all, so the contrast here is baked into the
 * vertex colours instead. What that used to mean was a near-black tunnel, and it
 * was wrong: pushed through fill-and-hemisphere alone, ACES returns literal
 * black, which is a hole in the frame rather than a dark surface, and nothing on
 * a snowfield under a bright sky is that dark because the snow itself bounces
 * too much light back up. {@link livery} is where that is now enforced.
 */

import * as THREE from 'three';
import { floorValue, PATROL, saturate } from '@/game/config/visuals';
import { assemble, type Piece } from '@/game/render/mergeParts';
import { distanceForHalfExtent, horizontalHalfExtentAt } from '@/game/systems/camera';

/**
 * The livery, as it actually reaches the vertex buffer.
 *
 * Two passes, both from `PATROL`, both applied here at bake time in the
 * `IMPORT_SATURATION` idiom, so they cost nothing per frame and no piece below
 * can forget them - every authored hex goes through this one function.
 *
 * `liverySaturation` is **below 1**: it desaturates. The machine measured as the
 * most saturated, highest-contrast mass in the whole frame, arriving at the one
 * moment the player most needs to read the track instead of the decoration, and
 * coins are meant to be the only warm accent in the play space. `bakeColor`
 * pushes chroma back out by `SATURATION` on the way in, so the net on these is a
 * little over 1 rather than under it - this pulls the livery back into the
 * palette, it does not drain it.
 *
 * `liveryFloor` then raises anything darker than it, by the brightest channel
 * rather than by luminance - see `floorValue`, where getting that distinction
 * wrong would lift the red body to pink. It is applied *after* the saturation
 * because saturation is what pushes a channel down; flooring first and
 * desaturating afterwards would put a panel back under the floor it was just
 * lifted to.
 *
 * The one consequence worth stating, because it shapes the palette below: an
 * absolute floor **collapses everything under it onto one value**, since the
 * lift is exactly what the brightest channel was short of. So at most one
 * authored colour may sit below it - the track tunnel - and every other panel is
 * authored above it. Authoring two dark panels and expecting a ramp between them
 * gets one flat mass, which is the defect this whole file is fixing.
 */
function livery(hex: string): string {
  return floorValue(saturate(hex, PATROL.liverySaturation), PATROL.liveryFloor);
}

/**
 * The livery, authored before {@link livery} processes it.
 *
 * Read as a value ramp rather than as a set of hues: `trackTunnel` is the
 * darkest thing on the machine, `crossMark` and `lampLens` the brightest, and
 * the reds sit between them.
 */
const AUTHORED = {
  /**
   * The drive track's tunnel: the deepest value on the machine, and the only
   * colour here authored below `PATROL.liveryFloor` - see {@link livery} for why
   * it has to be the only one.
   */
  trackTunnel: '#0e141a',
  /**
   * The tread bars across the tunnel, and they are deliberately *lighter* than
   * it now rather than darker. They are the raised part; the tunnel is the
   * recess. Authoring them darker was the old arrangement and it could not
   * survive the floor - two colours under it come out at the same value, so the
   * facet breakup that was the whole point of having bars disappeared.
   *
   * Lifted again from `#7c8894`, and the reason is the floor rather than taste.
   * `liveryFloor` puts the tunnel at a brightest channel of 112 and the flap
   * arrives at 127, so the whole tail lives inside 55 levels; a bar 36 above the
   * tunnel came out within one step of it once the tone curve had run, and the
   * rendered tail measured as a single flat value 23 rows tall. This is the one
   * place on the machine where more value range is the right answer, because the
   * range is being spent *inside* the darkest mass rather than against the snow.
   */
  treadBar: '#8e9ba8',
  /** The snow flap hanging into the plume: rubber, in the tunnel's shadow. */
  flap: '#67737f',
  /** Patrol red. */
  body: '#b8322c',
  /** Lower flanks, in shadow under the cowl. */
  bodyShade: '#8a2723',
  /** Chassis, bars, spindles. */
  chassis: '#5f6e7c',
  /** Skis, and the seat. */
  ski: '#59697a',
  /**
   * The seat, lifted off the tunnel it sits on.
   *
   * At `#586878` its brightest channel was 120 against the floored tunnel's 112,
   * so the seat top and the tunnel top - the two largest upward-facing surfaces
   * on the machine, side by side and both catching the key - arrived at the same
   * value and read as one flat panel. Eight levels of authored difference does
   * not survive a tone curve.
   */
  seat: '#66788a',
  /** The high-vis the cross is struck on, on the tail plate and the rider's back. */
  hiVis: '#f07a1e',
  /** The cross itself, and the flash on the helmet. */
  crossMark: '#f7fbfe',
  /** Tail lamp: a deep housing with a near-white lens sunk into it. */
  lampHousing: '#96262a',
  lampLens: '#ffe9e4',
  /**
   * The windscreen, and the bright edge along the top of it.
   *
   * The edge is not trim for its own sake. The screen is the one part of the
   * machine that stands above the cowl and below the rider, and against a pale
   * slope a mid-value panel there reads as nothing at all; a bright line along
   * its top gives the arc an outline, which is what makes the screen legible in
   * a still and, more to the point, when the outboard half of the machine is off
   * the edge of the frame.
   */
  screen: '#6f8494',
  screenEdge: '#cfe1f0',

  /*
   * The rider.
   *
   * A warm mid-value, deliberately, and this is a gameplay-adjacent choice
   * rather than a taste one. The player is a near-white yeti with a pale
   * silhouette that already struggles to separate; a second pale mass right
   * behind it is the exact failure this whole package exists to fix, and a
   * near-black one merges with the garment-darkened rider into a single blob at
   * the size the figure occupies on a phone. Warm and mid is the only band left.
   */
  jacket: '#9c4a2e',
  trouser: '#5d6878',
  /**
   * Authored *above* the floor, which it was not: `#525d6c` desaturates to a
   * brightest channel of 105 against the floor's 112, so it was being lifted to
   * exactly `PATROL.liveryFloor` and arriving at the identical value as the
   * track tunnel. That is the one thing {@link livery} says may not happen -
   * the lift is exactly what the brightest channel was short of, so every
   * colour under the floor collapses onto one value and the authored intent is
   * silently discarded.
   *
   * Still the darkest thing the rider wears, which is the point of it: it
   * lands under the seat and the trouser rather than level with them, so the
   * hands read as hands on the bars instead of dissolving into the cowl.
   */
  glove: '#5d6976',
  helmet: '#6d7a89',
} as const;

/**
 * The same table with {@link livery} applied, which is what every piece below is
 * actually coloured with.
 *
 * Mapped rather than hand-applied at each of the thirty-odd call sites, so no
 * piece can be added that quietly skips the floor - which is the failure mode
 * this guards, since a single unfloored dark panel is the black crate coming
 * straight back. Exported so `tests/patrol.test.ts` can assert the guarantee on
 * the values themselves rather than inferring it from pixels.
 */
export const PATROL_LIVERY = Object.fromEntries(
  Object.entries(AUTHORED).map(([name, hex]) => [name, livery(hex)]),
) as Record<keyof typeof AUTHORED, string>;

const PATROL_COLORS = PATROL_LIVERY;

/**
 * Where the rider sits on the machine, in machine-local metres.
 *
 * The rider is a second mesh rather than part of the merged machine so it can
 * fold over the bars, and this is the pivot it folds about: the hips, on the
 * seat. The machine no longer pitches at all - the old
 * `rotation.x = pressure * -0.14` had the sign backwards (a negative rotation
 * about +x drops the -z end, so maximum pressure nosed the machine *down*) and
 * eight degrees of pitch on a shape with no discernible nose was sub-perceptual
 * whichever way it went.
 */
export const RIDER_SEAT: [number, number, number] = [0, 0.93, 0.16];

/**
 * Radians the rider folds forward at full pressure.
 *
 * Negative when applied: a positive rotation about +x takes the head towards
 * +z, which is *backwards* away from the bars. Getting this the right way round
 * is the whole animation, so it is written once and derived everywhere.
 */
export const RIDER_CROUCH = 0.34;

/**
 * The footprint the machine is actually built to, in metres.
 *
 * Deliberately *inside* the `PATROL.drawnLength` / `drawnWidth` cap rather than
 * filling it, and the difference is the "shrink" half of the fix. The cap says
 * how big the machine may ever be, for a gameplay-adjacent reason - it has no
 * collider and visibly drives through whatever the player just jumped, so every
 * centimetre of length is a centimetre more of that. These say how big it *is*,
 * which is an art-direction question and was answered wrongly: at the cap, and
 * pinned as close as the old framing put it, the machine covered a fifth of the
 * screen and was cut by two frame edges at once.
 *
 * They also feed the framing maths below, so they are the real geometry rather
 * than the cap: the depth the machine is drawn at is derived from where its
 * outboard flank lands, and deriving that from a width the machine does not have
 * puts it at the wrong distance. `tests/patrol.test.ts` asserts the built
 * geometry really does fill these, which is what stops the two drifting apart.
 */
export const MACHINE_LENGTH = 2.1;
export const MACHINE_WIDTH = 1.0;

/** Half of {@link MACHINE_LENGTH}, i.e. how far the machine reaches each way. */
const HALF_LENGTH = MACHINE_LENGTH / 2;

/**
 * The two ends of the taper: how wide the machine is at the tail, and how wide
 * the skis stand at the nose.
 *
 * These are the outline. Everything between them is authored to fall on the line
 * they draw, and the ratio between them is what stops the machine reading as a
 * crate - a box has parallel sides and a sled does not.
 *
 * The tail is the narrow end and that is the important half, because the tail is
 * the part nearest the lens and therefore the part that owns the most screen.
 * Measured on the reference phone: the pre-taper rear crossed the outboard frame
 * edge, reaching 1.064 of a half width, and this one stops at 0.990. The machine
 * is no longer cut by a second frame edge, and it is not because it was backed
 * off - it is because the mass that was crossing the edge is no longer there.
 * Rasterised frame coverage went from 9.85% to 8.75% with it.
 *
 * {@link SKI_STANCE} is the full half width, which is what {@link MACHINE_WIDTH}
 * means: the framing maths derives the drawn depth from the machine's flank, and
 * the flank is the ski. Note it is *not* the outermost thing in the drawn
 * outline - the tail is nearer the lens and wins the projection - so the ski's
 * job is the front of the outline, not the widest point of it.
 */
const TAIL_WIDTH = 0.5;
const SKI_STANCE = MACHINE_WIDTH / 2;

/**
 * A box with a wide end and a narrow one, along Z.
 *
 * Hand-authored in the idiom of `wedge` and `prism` in `mergeParts.ts` rather
 * than approximated by a stack of narrowing boxes, for two reasons. A stack
 * costs a step in the outline at every joint, and steps are exactly what the
 * "crate" verdict was about; and the taper wants to run across a panel's whole
 * length so the flat-shaded flank catches the key at a slightly different angle
 * from the top, which is the only shading variation a machine this size gets.
 *
 * Centred on all three axes, like `THREE.BoxGeometry`, so it drops into the
 * piece list beside the boxes without a second positioning convention. The zeroed
 * uv attribute is not decoration: `mergeGeometries` refuses to merge sources with
 * different attribute sets, so anything hand-built has to carry the same three
 * three's primitives do.
 */
function taperedBox(
  rearWidth: number,
  frontWidth: number,
  height: number,
  length: number,
): THREE.BufferGeometry {
  const r = rearWidth / 2;
  const f = frontWidth / 2;
  const h = height / 2;
  const l = length / 2;

  // Rear is +z: the machine is seen from behind, so the wide end is the far one.
  const rearTopLeft: [number, number, number] = [-r, h, l];
  const rearTopRight: [number, number, number] = [r, h, l];
  const rearBottomLeft: [number, number, number] = [-r, -h, l];
  const rearBottomRight: [number, number, number] = [r, -h, l];
  const frontTopLeft: [number, number, number] = [-f, h, -l];
  const frontTopRight: [number, number, number] = [f, h, -l];
  const frontBottomLeft: [number, number, number] = [-f, -h, -l];
  const frontBottomRight: [number, number, number] = [f, -h, -l];

  // Wound counter-clockwise seen from outside, throughout: normals are derived
  // from the winding and the material is not double-sided, so a flipped triangle
  // is a hole in the machine.
  const triangles: [number, number, number][][] = [
    [rearBottomLeft, rearBottomRight, rearTopRight],
    [rearBottomLeft, rearTopRight, rearTopLeft],
    [frontBottomRight, frontBottomLeft, frontTopLeft],
    [frontBottomRight, frontTopLeft, frontTopRight],
    [frontTopLeft, rearTopRight, frontTopRight],
    [frontTopLeft, rearTopLeft, rearTopRight],
    [frontBottomLeft, frontBottomRight, rearBottomRight],
    [frontBottomLeft, rearBottomRight, rearBottomLeft],
    [frontTopLeft, frontBottomLeft, rearBottomLeft],
    [frontTopLeft, rearBottomLeft, rearTopLeft],
    [frontTopRight, rearBottomRight, frontBottomRight],
    [frontTopRight, rearTopRight, rearBottomRight],
  ];

  const positions = new Float32Array(triangles.length * 9);
  triangles.forEach((triangle, t) => {
    triangle.forEach((vertex, v) => positions.set(vertex, t * 9 + v * 3));
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  geometry.setAttribute(
    'uv',
    new THREE.BufferAttribute(new Float32Array((positions.length / 3) * 2), 2),
  );
  return geometry;
}

/**
 * Radians the tail plate is tilted back by.
 *
 * Not a styling choice: the camera sits about 2.3 m above the tail and roughly
 * 5.5 m in front of it, which is an elevation of about `atan(2.3 / 5.5)` ~ 0.4
 * rad. A plate near that angle faces the lens squarely, so the cross and the
 * high-vis are seen flat-on rather than edge-on. A vertical plate would present
 * the player with a foreshortened stripe.
 */
const TAIL_TILT = 0.44;

/** Unit normal of the tail plate, so anything struck on it sits proud of it. */
const TAIL_NORMAL: [number, number] = [Math.sin(TAIL_TILT), Math.cos(TAIL_TILT)];

/**
 * Radians the windscreen leans back by, and the same figures for its top edge.
 *
 * A positive rotation about +x takes the top edge towards +z, which is the lean
 * a screen actually has. The edge piece is placed by walking half the screen's
 * height along its own up axis, rather than by a second pair of hand-tuned
 * numbers that silently detach the moment the screen is resized.
 */
const SCREEN_LEAN = 0.35;
const SCREEN_HEIGHT = 0.5;
const SCREEN_WIDTH = 0.7;
const SCREEN_CENTRE: [number, number, number] = [0, 1.1, -0.7];

/**
 * Where the grips sit, and therefore how wide the bar is.
 *
 * The grip reaches 0.42 against the screen's 0.35, and it also sits 0.2 m nearer
 * the lens, so it projects wider still: two nubs standing clear of the screen's
 * outline on both sides rather than two lumps inside it. Authored as the grip
 * position rather than as a bar width because the grip is the thing that has to
 * land somewhere - the bar is then built to reach it, and the rider's hands are
 * solved onto the same number in {@link buildRider}.
 */
const GRIP_X = 0.365;

/**
 * The machine.
 *
 * Built to {@link MACHINE_LENGTH} x {@link MACHINE_WIDTH}. Read the piece list
 * as four silhouette statements rather than as a parts list: the outline narrows
 * from the skis to the tail, the ski tips reach further out sideways than any
 * bodywork, the screen reaches higher than the cowl and wider than the rider,
 * and the bars reach wider than the screen. Those four are what say "machine"
 * when everything outboard of them is cropped.
 *
 * The tail end is deliberately the sparsest part of the model even though it is
 * the part nearest the lens. Screen area near the bottom of the frame is the
 * most expensive thing this object spends, it is where the crop falls, and the
 * plume is thrown across it a moment later anyway.
 */
function buildMachine(): THREE.BufferGeometry {
  const pieces: Piece[] = [
    // --- Running gear ----------------------------------------------------
    // The drive track's tunnel: the deepest value on the machine, and the narrow
    // end of the taper - a real tunnel is barely wider than the track inside it.
    // It is also the part closest to the bottom edge of the frame, which is
    // where the rooster tail comes off it, and the part most often cropped away,
    // which is why nothing that has to be read lives down here.
    {
      geometry: new THREE.BoxGeometry(TAIL_WIDTH, 0.4, 1.3),
      color: PATROL_COLORS.trackTunnel,
      position: [0, 0.22, 0.34],
    },
    // Snow flap hanging into the plume, set just *inside* the tail so the tread
    // bars below can stand behind it. It is narrower than the tunnel it hangs
    // off, which is what leaves the bar ends showing either side of it.
    {
      geometry: new THREE.BoxGeometry(0.4, 0.26, 0.05),
      color: PATROL_COLORS.flap,
      position: [0, 0.15, HALF_LENGTH - 0.07],
    },

    // --- Body ------------------------------------------------------------
    // The taper proper: `TAIL_WIDTH` at the back, opening out to the footwells.
    // One solid rather than the full-width slab this used to be - that slab was
    // the widest thing in the frame *and* the nearest, which is the worst
    // combination available on a mass with no gameplay meaning.
    {
      geometry: taperedBox(TAIL_WIDTH, 0.72, 0.32, 1.26),
      color: PATROL_COLORS.body,
      position: [0, 0.57, 0.13],
    },
    // A darker skirt under the flanks, tapering with the body above it. It is
    // the widest bodywork on the machine, and the 0.12 the skis clear it by is
    // sized to survive perspective rather than to look right in a model viewer -
    // see the note on projected width at the top of this file.
    {
      geometry: taperedBox(0.56, 0.76, 0.13, 1.18),
      color: PATROL_COLORS.bodyShade,
      position: [0, 0.42, 0.08],
    },
    // Front cowl, narrowing again towards the nose, and a lower nose tapering
    // away from the camera. Both stop well short of the ski tips: bodywork
    // reaching as far forward as the skis is bodywork the skis disappear into,
    // which is the defect being fixed.
    {
      geometry: taperedBox(0.72, 0.58, 0.38, 0.6),
      color: PATROL_COLORS.body,
      position: [0, 0.53, -0.58],
    },
    {
      geometry: new THREE.BoxGeometry(0.44, 0.2, 0.26),
      color: PATROL_COLORS.body,
      position: [0, 0.36, -0.8],
    },
    {
      geometry: new THREE.BoxGeometry(0.42, 0.18, 0.78),
      color: PATROL_COLORS.seat,
      position: [0, 0.8, 0.26],
    },

    // --- Tail: the high-vis plate, tilted to face the lens ----------------
    // Narrowed to the tail width with everything else back here. The mark does
    // not need area to be read - it needs to be the only saturated thing in its
    // neighbourhood, which on a machine this size it is.
    {
      geometry: new THREE.BoxGeometry(TAIL_WIDTH, 0.3, 0.05),
      color: PATROL_COLORS.hiVis,
      rotation: [-TAIL_TILT, 0, 0],
      position: [0, 0.84, 0.8],
    },
    // Grab bar over the plate.
    {
      geometry: new THREE.BoxGeometry(0.36, 0.06, 0.06),
      color: PATROL_COLORS.chassis,
      position: [0, 0.95, 0.66],
    },

    // --- Controls --------------------------------------------------------
    // The windscreen. Wider than the rider's shoulders and standing well clear
    // of the cowl, which is the whole reason it is here: at 0.5 wide and 0.36
    // tall it sat behind the rider's back and inside their outline, so the
    // measured verdict of "no windscreen" was correct about the image even
    // though the geometry was present.
    //
    // It reads on the *inboard* side, and that is worth stating because it is
    // not symmetric: the machine rides at a shoulder, so the lens sees its
    // inboard flank, and the nearer rider covers more of the screen's outboard
    // half than its inboard one. The inboard edge is the one that has to clear.
    {
      geometry: new THREE.BoxGeometry(SCREEN_WIDTH, SCREEN_HEIGHT, 0.05),
      color: PATROL_COLORS.screen,
      rotation: [SCREEN_LEAN, 0, 0],
      position: SCREEN_CENTRE,
    },
    {
      geometry: new THREE.BoxGeometry(SCREEN_WIDTH, 0.05, 0.05),
      color: PATROL_COLORS.screenEdge,
      rotation: [SCREEN_LEAN, 0, 0],
      position: [
        SCREEN_CENTRE[0],
        SCREEN_CENTRE[1] + (SCREEN_HEIGHT / 2) * Math.cos(SCREEN_LEAN),
        SCREEN_CENTRE[2] + (SCREEN_HEIGHT / 2) * Math.sin(SCREEN_LEAN),
      ],
    },
    // Handlebars, behind the screen and wider than it, so the grips read as two
    // nubs breaking the screen's outline instead of vanishing behind it.
    {
      geometry: new THREE.BoxGeometry(2 * GRIP_X + 0.09, 0.05, 0.05),
      color: PATROL_COLORS.chassis,
      position: [0, 1.05, -0.5],
    },
    {
      geometry: new THREE.BoxGeometry(0.07, 0.24, 0.07),
      color: PATROL_COLORS.chassis,
      position: [0, 0.89, -0.54],
    },
  ];

  // The cross on the tail plate. Struck on the plate's own normal so it sits
  // proud of it however the tilt is retuned, and kept small: the rider's back
  // carries the large one, and the machine only needs enough of the mark to say
  // which service this is.
  for (const bar of [
    [0.2, 0.05],
    [0.05, 0.19],
  ] as const) {
    pieces.push({
      geometry: new THREE.BoxGeometry(bar[0], bar[1], 0.02),
      color: PATROL_COLORS.crossMark,
      rotation: [-TAIL_TILT, 0, 0],
      position: [0, 0.84 + 0.035 * TAIL_NORMAL[0], 0.8 + 0.035 * TAIL_NORMAL[1]],
    });
  }

  for (const side of [-1, 1] as const) {
    // Tail lamps, one either side of the plate, and the outermost thing at the
    // back of the machine - they sit 0.08 proud of the tunnel, which is enough
    // to break the corner without widening the mass that owns the near frame.
    // The housing is deep red and the lens sunk into it is near-white: ACES at
    // `ATMOSPHERE.exposure` rolls the lens off on its own, which is as close to
    // a bloom as this renderer gets without a render target.
    pieces.push({
      geometry: new THREE.BoxGeometry(0.12, 0.1, 0.06),
      color: PATROL_COLORS.lampHousing,
      position: [side * 0.27, 0.72, 0.84],
    });
    pieces.push({
      geometry: new THREE.BoxGeometry(0.085, 0.05, 0.02),
      color: PATROL_COLORS.lampLens,
      position: [side * 0.27, 0.72, 0.88],
    });

    /*
     * Skis, and the reason they are at `+-0.42` rather than the `+-0.34` they
     * used to be.
     *
     * A ski stance narrower than the bodywork is a ski that never appears in the
     * outline: from behind, the whole front end hides inside the machine's own
     * width, and "no skis" was the measured verdict on a model that had two. At
     * `+-0.42` with a 0.16 blade they reach {@link SKI_STANCE} - the full half
     * width - and stand 0.12 proud of the widest skirt, which is what survives
     * the foreshortening between the nose and the tail. A real ski stance is
     * wider than the tunnel for the same reason it has to be here.
     *
     * Sat exactly on y = 0: a machine floating a couple of centimetres clear of
     * the snow is the one thing a low camera sees immediately.
     */
    pieces.push({
      geometry: new THREE.BoxGeometry(0.16, 0.07, 0.7),
      color: PATROL_COLORS.ski,
      position: [side * (SKI_STANCE - 0.08), 0.035, -0.66],
    });
    // Turned-up tip. Rotating a z-aligned box by +x lifts its -z end, and the
    // lift is what makes the tip read against the snow rather than merging with
    // it - a flat blade end-on at this distance is a few pixels of nothing.
    pieces.push({
      geometry: new THREE.BoxGeometry(0.16, 0.07, 0.22),
      color: PATROL_COLORS.ski,
      rotation: [0.55, 0, 0],
      position: [side * (SKI_STANCE - 0.08), 0.092, -0.937],
    });
    pieces.push({
      geometry: new THREE.BoxGeometry(0.08, 0.34, 0.08),
      color: PATROL_COLORS.chassis,
      position: [side * (SKI_STANCE - 0.08), 0.23, -0.56],
    });

    // Grips on the ends of the bar.
    pieces.push({
      geometry: new THREE.BoxGeometry(0.11, 0.07, 0.07),
      color: PATROL_COLORS.trackTunnel,
      position: [side * GRIP_X, 1.05, -0.5],
    });
  }

  /*
   * Tread bars across the back of the track. Three of them, purely so the
   * darkest mass in the frame has facets to break across instead of reading as
   * a hole cut in the snow - and until now they did not do that, because they
   * were *inside the tunnel*. The tunnel's rear face sat at z = 0.99 and the
   * bars were centred on 0.97, so the one piece whose entire job was to break up
   * the dark mass was buried in it and had never been drawn. The rendered tail
   * was 23 rows of a single flat value, which is the "crate" verdict arriving by
   * a completely different route from the one everybody was looking at.
   *
   * So they are now the rearmost geometry on the machine, standing proud of both
   * the tunnel face and the flap, and wider than the flap so the ends show
   * either side of it. `HALF_LENGTH` is the hard back of the model: the bars
   * finish exactly on it, which is what keeps the built length inside
   * {@link MACHINE_LENGTH}.
   */
  for (let i = 0; i < 3; i++) {
    pieces.push({
      geometry: new THREE.BoxGeometry(TAIL_WIDTH - 0.04, 0.05, 0.05),
      color: PATROL_COLORS.treadBar,
      position: [0, 0.07 + i * 0.11, HALF_LENGTH - 0.025],
    });
  }

  return assemble(pieces);
}

/**
 * The rider, built about the hips so the whole figure folds over the bars.
 *
 * The resting forward lean is baked in; `Chaser.tsx` rotates this about +x by
 * pressure on top of it. Crouching also tips the back plate *towards* the lens,
 * which is why the cross lives there rather than on the machine: the rider's
 * back is the most camera-facing surface on the whole object, and it gets more
 * camera-facing exactly as the machine becomes more threatening.
 *
 * The head is the load-bearing part of the silhouette. It is the only thing on
 * the object above the screen line, it sits on the machine's centre line where
 * the frame never crops it, and it is what turns a stack of panels into a
 * vehicle with somebody riding it. Everything else here may be cut away; that
 * must not be.
 */
function buildRider(): THREE.BufferGeometry {
  const pieces: Piece[] = [
    // Hips and legs, reaching forward to the running boards.
    {
      geometry: new THREE.BoxGeometry(0.34, 0.18, 0.3),
      color: PATROL_COLORS.trouser,
      position: [0, 0.02, 0],
    },
    // Torso, leaning over the bars, and the shoulders on top of it.
    {
      geometry: new THREE.BoxGeometry(0.4, 0.42, 0.28),
      color: PATROL_COLORS.jacket,
      rotation: [-0.3, 0, 0],
      position: [0, 0.28, -0.02],
    },
    {
      geometry: new THREE.BoxGeometry(0.44, 0.14, 0.24),
      color: PATROL_COLORS.jacket,
      rotation: [-0.3, 0, 0],
      position: [0, 0.47, 0.03],
    },
    // The high-vis backing and the cross on it: the patrol's mark, on the one
    // surface of this object that squarely faces the player.
    {
      geometry: new THREE.BoxGeometry(0.3, 0.3, 0.02),
      color: PATROL_COLORS.hiVis,
      rotation: [-0.3, 0, 0],
      position: [0, 0.31, 0.13],
    },
    {
      geometry: new THREE.BoxGeometry(0.24, 0.09, 0.02),
      color: PATROL_COLORS.crossMark,
      rotation: [-0.3, 0, 0],
      position: [0, 0.31, 0.15],
    },
    {
      geometry: new THREE.BoxGeometry(0.08, 0.24, 0.02),
      color: PATROL_COLORS.crossMark,
      rotation: [-0.3, 0, 0],
      position: [0, 0.31, 0.15],
    },
    // Helmet, and a flash across the back of it so the head does not read as a
    // hole. Grown from 0.155 with the machine shrinking around it: the head is
    // the cue that has to survive at the size this object now occupies, and a
    // head scaled down with the machine would have been the first thing lost.
    {
      geometry: new THREE.SphereGeometry(0.17, 8, 6),
      color: PATROL_COLORS.helmet,
      position: [0, 0.63, -0.04],
    },
    {
      geometry: new THREE.BoxGeometry(0.16, 0.09, 0.04),
      color: PATROL_COLORS.crossMark,
      position: [0, 0.64, 0.11],
    },
  ];

  for (const side of [-1, 1] as const) {
    // Thighs and shins, folded onto the running board.
    pieces.push({
      geometry: new THREE.BoxGeometry(0.13, 0.14, 0.42),
      color: PATROL_COLORS.trouser,
      position: [side * 0.12, -0.05, -0.22],
    });
    pieces.push({
      geometry: new THREE.BoxGeometry(0.12, 0.3, 0.12),
      color: PATROL_COLORS.trouser,
      position: [side * 0.14, -0.24, -0.4],
    });
    /*
     * Arms out to the grips, splayed as well as pitched.
     *
     * The rest pose is solved so the gloves land on the bar at *half* crouch,
     * not at rest. The figure is one rigid rotation about the hips - there is no
     * shoulder joint - so the hands only sit on the grips at one value of the
     * fold, and mid-crouch is where the pressure meter spends most of its time.
     * Posing for rest instead puts the hands through the cowl whenever the
     * patrol is actually pressing, which is the only time anyone looks at it.
     *
     * The yaw is what the old arms lacked: reaching straight forward from a
     * 0.44-wide pair of shoulders to a bar {@link GRIP_X} wide needs the arms to
     * open out, and without it the grips looked unattached to anybody. It is
     * solved from the grip rather than eyeballed - `0.29 + 0.34 * sin(yaw)` is
     * where the far end of a half-metre upper arm lands - so widening the bar
     * takes the hands with it instead of leaving them in mid-air.
     */
    pieces.push({
      geometry: new THREE.BoxGeometry(0.11, 0.11, 0.68),
      color: PATROL_COLORS.jacket,
      rotation: [-0.085, -side * 0.222, 0],
      position: [side * 0.29, 0.259, -0.292],
    });
    pieces.push({
      geometry: new THREE.BoxGeometry(0.13, 0.12, 0.14),
      color: PATROL_COLORS.glove,
      position: [side * GRIP_X, 0.23, -0.63],
    });
  }

  return assemble(pieces);
}

let machineCache: THREE.BufferGeometry | null = null;
let riderCache: THREE.BufferGeometry | null = null;

/** Built once and shared: there is exactly one patrol and it never changes. */
export function patrolMachineGeometry(): THREE.BufferGeometry {
  machineCache ??= buildMachine();
  return machineCache;
}

export function patrolRiderGeometry(): THREE.BufferGeometry {
  riderCache ??= buildRider();
  return riderCache;
}

// --- Framing -----------------------------------------------------------------

/*
 * Where the machine is drawn, and why it is not where the simulation says.
 *
 * `chaserWorldZ` returns `player.z + chaser.distance`, and at the resting
 * distance of 26 that is world `z = 26` against a camera at about `z = 8.96`.
 * Seventeen units *behind the eye*: the game's only antagonist has been frustum
 * culled for effectively every frame of every run, and nobody has seen it
 * outside an avalanche. The simulation is right and must not move - the
 * avalanche and caught tests are built on that snap - so the drawn position is
 * a framing decision made here, from the live camera and the live lens.
 *
 * The live lens matters. The game runs at `fov + speedFovKick` for most of a
 * session, and the band of depths at which the machine fits the frame moves a
 * long way over those twelve degrees.
 *
 * The three numbers this used to hold - a frame reach, a minimum depth and a
 * minimum drawn Z - now live in `PATROL`, because they are not geometry however
 * much they read like it: they decide how much of the screen the game's only
 * antagonist owns at the moment of peak tension.
 */

/**
 * Depth in front of the eye at which the machine is drawn.
 *
 * Uses the same `distanceForHalfExtent` the camera rig frames the outer lanes
 * with, which is deliberate: the two are the same question asked about
 * different objects, and answering it twice with different arithmetic is how
 * they drift apart.
 */
export function patrolDepth(fovDegrees: number, aspect: number): number {
  const outboard = PATROL.shoulderOffset + MACHINE_WIDTH / 2;
  return Math.max(
    PATROL.minDepth,
    distanceForHalfExtent(outboard / PATROL.frameReach, fovDegrees, aspect),
  );
}

/**
 * World Z the machine is drawn at, given where the camera actually is.
 *
 * Depth is measured along the view axis and this converts it to a Z offset,
 * which is a small approximation: the camera pitches about seven degrees down,
 * so the true depth to a point 2.3 m below the eye is a few percent *more* than
 * the Z gap. That errs towards the machine being slightly further away and
 * slightly further inside the frame than asked for, which is the safe direction
 * - the constraint being protected is that it must not crowd the player.
 */
export function patrolDrawnZ(cameraZ: number, fovDegrees: number, aspect: number): number {
  return Math.max(PATROL.minDrawnZ, cameraZ - patrolDepth(fovDegrees, aspect));
}

/**
 * How far off the player's spine the machine rides, in metres.
 *
 * **The guarantee being bought here is a separation on the screen, and this used
 * to be a fixed number of metres, which is not the same thing.** The machine is
 * drawn much further from the eye than the player is, so its lateral offset
 * shrinks in the frame while the player's does not; push the machine back and
 * the two silhouettes converge even though nothing moved sideways. That is
 * exactly what happened when `frameReach` came down from 1.3 to 1.0 - a change
 * whose whole purpose was to make the machine legible - and it took the measured
 * gap between the two outlines to about a fiftieth of what it needs.
 *
 * So the outboard offset is derived from the frame instead: the machine's
 * outboard flank sits at `PATROL.frameReach` of the visible half width **at the
 * depth it is actually drawn at**. Where `frameReach` is what set that depth
 * this reduces *exactly* to `PATROL.shoulderOffset` - the two arithmetics cancel
 * - so on a portrait phone nothing changes at all. Where `PATROL.minDepth` has
 * overridden the reach, which is what happens on wide screens and at the top of
 * the fov kick, the machine has been pushed further back than the framing asked
 * for and this widens it to match. `PATROL.shoulderOffset` is kept as the floor,
 * so a future retune of either constant can only ever move the machine outward.
 *
 * The depth used is `patrolDepth` rather than the realised `cameraZ - drawnZ`,
 * which differ only when `PATROL.minDrawnZ` clamps - and there the machine ends
 * up *nearer* than this assumes, so the offset comes out slightly too wide.
 * That is the safe direction, the same one `patrolDrawnZ` errs in.
 */
export function patrolOutboard(fovDegrees: number, aspect: number): number {
  const flank =
    PATROL.frameReach * horizontalHalfExtentAt(patrolDepth(fovDegrees, aspect), fovDegrees, aspect);
  return Math.max(PATROL.shoulderOffset, flank - MACHINE_WIDTH / 2);
}

/**
 * The side of the player the machine rides on: -1 left, +1 right.
 *
 * Never behind the head. At a phone's aspect the player's readable mass sits
 * within about a sixth of the frame width of the centre line, and a tall machine
 * at `x = 0` puts its own mass directly behind the one silhouette in the game
 * that already fails to separate - which would make the fix worse than the
 * defect it fixes.
 *
 * In an outer lane the bias is inward, because the camera only follows
 * `TUNING.camera.laneFollow` of the lane offset while the machine follows
 * `PATROL.laneFollow`: biasing inward puts the machine on the *opposite* side of
 * the frame centre from the player, which is the largest separation available.
 * In the centre lane there is no inward, so it trails on the side the player
 * just came from - which is also what makes it sweep across the frame when they
 * cross the track.
 *
 * @param targetLane - the lane the player is heading for.
 * @param cameFrom - the lane they were in before the last change.
 */
export function patrolSideFor(targetLane: number, cameFrom: number): -1 | 1 {
  if (targetLane < 1) return 1;
  if (targetLane > 1) return -1;
  return cameFrom < 1 ? -1 : 1;
}

/** Lateral position of the machine once it has settled alongside. */
export function patrolShoulderX(
  laneX: number,
  side: number,
  fovDegrees: number,
  aspect: number,
): number {
  return laneX * PATROL.laneFollow + patrolOutboard(fovDegrees, aspect) * side;
}

// --- The approach ------------------------------------------------------------

/*
 * The sweep in.
 *
 * `stepAvalanche` pins `chaser.distance` to `minDistance` on a single tick - 26
 * to 5 - and the old renderer assigned `position.z` straight from it, so the
 * patrol did not close in, it *materialised*. That snap has to stay exactly as
 * it is, so the easing is entirely presentation: a follower that the drawn pose
 * is derived from, rather than the raw pressure.
 *
 * A spring rather than the `damp` used everywhere else in the renderer, and for
 * one reason: `PATROL.approachOvershoot`. An exponential approach cannot
 * overshoot - it creeps onto the settled pose from below, which reads as the
 * machine being placed rather than arriving - and no function of a settled
 * exponential can put it past the mark either. Overshoot is second order or it
 * does not exist.
 */

export interface Approach {
  /** 0 with the patrol away, 1 alongside, briefly above 1 as it arrives. */
  value: number;
  velocity: number;
}

/**
 * Damping ratio giving exactly `PATROL.approachOvershoot` of overshoot.
 *
 * Standard second-order result: a step response peaks
 * `exp(-pi * zeta / sqrt(1 - zeta^2))` above its target. Inverted here so the
 * overshoot stays the authored quantity and the ratio follows it, rather than a
 * hand-picked ratio and a comment claiming it gives 12%.
 */
const APPROACH_ZETA = (() => {
  const ln = Math.log(PATROL.approachOvershoot);
  return -ln / Math.sqrt(Math.PI * Math.PI + ln * ln);
})();

/**
 * Natural frequency putting the first peak at `PATROL.approachSeconds`.
 *
 * Rise time to the target for an underdamped step is
 * `(pi - acos(zeta)) / (omega * sqrt(1 - zeta^2))`.
 */
const APPROACH_OMEGA =
  (Math.PI - Math.acos(APPROACH_ZETA)) /
  (PATROL.approachSeconds * Math.sqrt(1 - APPROACH_ZETA * APPROACH_ZETA));

/**
 * Root of `(1 + x) * exp(-x) = 0.05`: how many time constants a critically
 * damped step takes to come within 5% of its target. Written as a literal
 * because it has no closed form outside the Lambert W, and 5% is the point at
 * which a move stops being visible rather than a tuned quantity.
 */
const CRITICAL_SETTLE = 4.7439;

/**
 * The release is critically damped: a threat leaves reluctantly, and it must not
 * bounce back into frame on the way out. `PATROL.releaseSeconds` is the time to
 * settle, so the frequency is {@link CRITICAL_SETTLE} over it.
 */
const RELEASE_OMEGA = CRITICAL_SETTLE / PATROL.releaseSeconds;

/**
 * Longest step the spring is integrated over, in seconds.
 *
 * Semi-implicit Euler is stable well past this at these frequencies, but a
 * frame that took a third of a second is an app coming back from the background,
 * and the patrol arriving in one jump is exactly the artefact being removed.
 */
const MAX_STEP = 1 / 30;

export function createApproach(): Approach {
  return { value: 0, velocity: 0 };
}

/**
 * Advances the follower one frame.
 *
 * The stiffness is chosen by which way it is going, so the entry can overshoot
 * while the exit cannot. Note the direction is taken from where the follower
 * currently sits rather than from the target's history: that means the *return*
 * leg of an overshoot is run by the critically damped half, which is what stops
 * the pair from ringing.
 */
export function stepApproach(state: Approach, target: number, dt: number): void {
  const closing = target > state.value;
  const omega = closing ? APPROACH_OMEGA : RELEASE_OMEGA;
  const zeta = closing ? APPROACH_ZETA : 1;
  const step = Math.min(dt, MAX_STEP);

  state.velocity +=
    (omega * omega * (target - state.value) - 2 * zeta * omega * state.velocity) * step;
  state.value += state.velocity * step;
}
