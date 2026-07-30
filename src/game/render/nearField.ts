/**
 * The maths behind the near field: the flake layout, the carve, the ribbon's
 * sample ring, the spray's wake and the marker layout.
 *
 * Split out of the four components that consume it for two reasons. The lint
 * rule the project runs will not let a `.tsx` export anything but components,
 * and - the reason that outlives the rule - every guarantee in here is a
 * geometric one that has to be measurable without a GL context. `Snow`,
 * `SnowSpray`, `CarveTrail` and `Markers` are then only the plumbing that
 * uploads it, which is the same split `propGeometry.ts` and `trackLayout.ts`
 * already use.
 *
 * The problem all of it addresses: nothing in this game passes the camera.
 * Every side element converges on a vanishing point and leaves frame eight to
 * eleven metres ahead, so a still at 21 units per second is indistinguishable
 * from one at 12 - there is no rate anywhere in the image, only positions.
 */

import { LANES, TUNING } from '@/game/config/tuning';
import { LIGHTING, MARKERS, SNOW_FIELD, SPRAY, TRAIL } from '@/game/config/visuals';
import { clamp01, lerp } from '@/game/core/math';
import { createRng } from '@/game/core/rng';
import { TRACK_SPAN } from '@/game/render/trackLayout';
import { laneToX, type LaneState } from '@/game/systems/lanes';
import * as THREE from 'three';

/* -------------------------------------------------------------------------- */
/* Falling snow                                                               */
/* -------------------------------------------------------------------------- */

/**
 * The box the main field cycles within, and where it sits relative to the
 * player. Centred well ahead and well above, exactly as it always was - the
 * camera looks down-track, so a box centred on the player would spend most of
 * its flakes behind the eye.
 */
export const MAIN_FIELD = {
  width: TUNING.snow.fieldWidth,
  height: TUNING.snow.fieldHeight,
  depth: TUNING.snow.fieldDepth,
  centre: [0, TUNING.snow.fieldHeight * 0.35, -TUNING.snow.fieldDepth * 0.25] as const,
};

/**
 * The near band: a small box in the gap between the player and the lens.
 *
 * This is the cheapest expensive-looking trick in the genre. It fakes a depth
 * of field the renderer cannot afford, gives the frame a foreground plane it
 * has at no speed, and it is the only continuous optic-flow cue that works at
 * the opening speed, where the fov kick contributes exactly zero. It rides the
 * main field's mesh, so it costs no draw call.
 *
 * Three of its numbers are load-bearing.
 *
 * **The depth divides `TUNING.snow.fieldDepth`.** The scroll uniform is reduced
 * modulo the main field's depth on the CPU, and every flake wraps against that
 * same reduced value. If the near box's depth were not a divisor, the reduction
 * would shift the near layer's phase by a fraction of a box every 90 m and the
 * foreground would visibly jump. Nothing in the shader would notice.
 *
 * **The near face stays in front of the closest the camera ever gets.**
 * `cameraDistanceFor` bottoms out at `TUNING.camera.minDistance`, so a box
 * reaching past that would put flakes behind the eye on a wide screen.
 *
 * **The far face reaches past the player.** A "foreground" band that stops
 * short of the rider is not in front of anything.
 */
export const NEAR_FIELD = {
  width: 8,
  height: 5,
  depth: TUNING.snow.fieldDepth / 10,
  centre: [0, 2.6, 2.5] as const,
};

/**
 * Sideways sway, in metres. Out of phase per flake so the cloud never looks
 * like a grid. Its contribution to the streak is under a metre per second
 * against a scroll of twenty-odd, which is why it is worth a `cos` and not
 * worth a second attribute.
 */
export const DRIFT_AMPLITUDE = 0.9;

/** Opacity of a main-field flake. The near band uses `SNOW_FIELD.nearAlpha`. */
export const FIELD_ALPHA = 0.75;

/**
 * Metres in front of the lens over which a flake fades out entirely.
 *
 * The camera's near plane is 0.5 and its comment in `App.tsx` reasons that
 * "nothing is ever closer than the player" - which the near band makes false.
 * Rather than move the near plane and give up the depth precision it was pulled
 * out to buy, flakes are gone before they can reach it. A flake big enough to
 * be worth drawing half a metre from the lens covers a third of the screen
 * anyway, so there is nothing here to save.
 */
export const LENS_FADE = [0.7, 2.0] as const;

/** Corner offsets, in the order the index buffer below expects them. */
const FLAKE_CORNERS = [
  [-1, -1],
  [1, -1],
  [-1, 1],
  [1, 1],
] as const;

/**
 * The whole flake field, both bands, as one geometry.
 *
 * A quad per flake rather than a point sprite. `gl_PointSize` cannot streak,
 * and a flake moving 35 cm between two frames drawn as a stationary dot is the
 * definition of temporal aliasing - it strobes, and at the full ground speed it
 * strobes badly. The usual bodge is an anisotropic `discard` inside a point
 * sprite, which throws away most of the fill it just paid for *and* disables
 * early-Z. Three extra vertices per flake is nothing, and their fill is exactly
 * the streak.
 *
 * The seed is normalised into the unit box so one attribute layout serves both
 * bands; the shader scales it by whichever field the flake belongs to.
 */
export function buildSnowField(): THREE.BufferGeometry {
  const fieldCount = TUNING.snow.count;
  const total = fieldCount + SNOW_FIELD.nearCount;

  // Fixed seed: the flake layout is decorative and stable across runs.
  const rng = createRng(0x5f10);

  const positions = new Float32Array(total * 4 * 3);
  const corners = new Float32Array(total * 4 * 2);
  const phases = new Float32Array(total * 4);
  const scales = new Float32Array(total * 4);
  const nears = new Float32Array(total * 4);
  const indices = new Uint16Array(total * 6);

  for (let i = 0; i < total; i++) {
    const x = rng.next() - 0.5;
    const y = rng.next() - 0.5;
    const z = rng.next() - 0.5;
    const phase = rng.next();
    // Varied fall speed and size gives the cloud depth without more flakes.
    const scale = rng.range(0.5, 1.4);
    const near = i >= fieldCount ? 1 : 0;

    for (let v = 0; v < 4; v++) {
      const vertex = i * 4 + v;
      positions[vertex * 3] = x;
      positions[vertex * 3 + 1] = y;
      positions[vertex * 3 + 2] = z;
      corners[vertex * 2] = FLAKE_CORNERS[v]![0];
      corners[vertex * 2 + 1] = FLAKE_CORNERS[v]![1];
      phases[vertex] = phase;
      scales[vertex] = scale;
      nears[vertex] = near;
    }

    const base = i * 4;
    indices.set([base, base + 1, base + 2, base + 2, base + 1, base + 3], i * 6);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aCorner', new THREE.BufferAttribute(corners, 2));
  geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
  geometry.setAttribute('aScale', new THREE.BufferAttribute(scales, 1));
  geometry.setAttribute('aNear', new THREE.BufferAttribute(nears, 1));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  return geometry;
}

/* -------------------------------------------------------------------------- */
/* Board spray                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Where the ski patrol wants its rooster tail thrown from.
 *
 * A mutable module singleton, the same shape and for the same reason as
 * `runtime`: the machine's *drawn* position is decided inside the frame
 * callback that draws it, from the live camera and the live fov, so there is no
 * way to derive it in the particle system and no React value to pass. The
 * patrol's plume is a second *source* into `SnowSpray`'s pool rather than its
 * own system, which is the only reason it costs no draw call - a second system
 * would mean a second Lambert material identical to the first.
 *
 * Leaving `pressure` at zero silences the emitter, so `SnowSpray` behaves
 * correctly whether or not anything is driving it. That is what lets the
 * patrol's renderer and the particle system land independently.
 *
 * Ordering: `<Chaser />` is registered before `<SnowSpray />` in `Scene`, and
 * r3f runs same-priority frame callbacks in registration order, so a value
 * written this frame is consumed this frame. If that order is ever reversed the
 * cost is one frame of lag on the plume, never a missing one.
 */
export const patrolSpray = {
  /** World position on the machine's track where the snow leaves it. */
  x: 0,
  y: 0,
  z: 0,
  /** Smoothed approach pressure, 0 to 1. Zero emits nothing. */
  pressure: 0,
};

/**
 * Drawn scale multiplier for a particle `gap` metres in front of the lens.
 *
 * Mandatory companion to the larger `SPRAY.size`, not a polish item. Once the
 * plume genuinely streams back past the lens, a 0.3-radius sprite two metres
 * out covers about a fifth of the screen and translates a third of a metre per
 * frame, so consecutive frames barely overlap: it reads as a strobing dotted
 * trail, and then it clips the near plane.
 *
 * Reaches zero a whole flake radius *before* the near plane rather than at it -
 * a sprite clipped exactly in half by the near plane is a hard straight edge
 * across a snow particle, which is worse than the strobing it was drawn to
 * avoid.
 */
export function proximityFade(gap: number, near: number): number {
  const vanish = near + SPRAY.size;
  const span = SPRAY.nearCollapse - vanish;
  // Degenerate only if the collapse distance is authored inside the near plane,
  // in which case the honest answer is a hard cut at the vanishing point.
  if (span <= 0) return gap > vanish ? 1 : 0;
  return clamp01((gap - vanish) / span);
}

/**
 * How fast a particle recedes down-track, given what is left of its birth drift.
 *
 * Split out because the sign of this is the whole bug the spray shipped with.
 * At the old wake of 0.35 a particle that had left the board kept 65% of the
 * world's forward speed - snow travelling downhill *through* the snow at over
 * twenty units a second, outrunning the camera - so no amount of tuning the
 * emitter could ever have produced a rooster tail. Snow that has left the board
 * is not attached to anything and recedes at the full ground speed like every
 * other thing in the world.
 *
 * The drift is the other half: at birth the particle still carries the rider's
 * momentum, and gives it up over `SPRAY.driftSeconds`, so it leaves the board
 * rather than being snatched away on the frame it is emitted.
 */
export function wakeVelocity(vz: number, speed: number, drift: number): number {
  return vz + speed * SPRAY.wake * (1 - drift);
}

/**
 * Life left to a flake on the frame it touches the snow.
 *
 * Thrown snow settles into the surface; it does not become litter. The
 * integrator floors `y` and zeroes the fall, so without this a flake that lands
 * early lies there for the rest of its half second - stationary faceted geometry
 * on the piste, which is exactly when a sprite stops reading as snow in the air
 * and starts reading as a triangle somebody forgot to clear. Half the plume
 * reading as stray polygons was the single ugliest thing measured in the frame.
 *
 * **A minimum, not an assignment, and that is the whole correctness of it.** The
 * floor re-fires on every subsequent frame - gravity pulls a resting flake back
 * through it and it is clamped again - so an assignment would rewrite the life
 * to `settleSeconds` for ever and the flake would never die. Taking the smaller
 * value is idempotent, so the life keeps falling once it is inside the window.
 */
export function settleLife(life: number): number {
  return Math.min(life, SPRAY.settleSeconds);
}

/**
 * Fraction of its authored size a flake is drawn at.
 *
 * `rest` is zero while it is in the air, and carries the life the flake arrived
 * with - the value *before* {@link settleLife} cut it - once it is not. That
 * second argument is what makes the settle a *collapse* rather than a pop.
 * Cutting the life alone would be enough to stop a flake lingering, and it would
 * look worse: the drawn scale is a fraction of `SPRAY.life`, so a flake landing
 * with half a second in hand would shrink to a quarter of its size between one
 * frame and the next, and a flake that visibly changes size the moment it
 * touches down is a worse artefact than the one being fixed.
 *
 * It is the arrival life rather than the cut one because that single number
 * fixes both halves of the hand-off: the size to collapse *from*, which is what
 * the flake was already being drawn at, and the window to collapse *over*, which
 * is whatever is left after the cut. So the ratio is exactly 1 on the landing
 * frame whether the flake arrived with half a second or with a twentieth - and
 * the short case is not a corner, it is most of the ground sheet, which is
 * emitted at 5 cm and lands almost at once.
 */
export function sprayFade(life: number, rest: number): number {
  // In the air: what is left of the authored lifetime, and nothing else.
  if (rest <= 0) return Math.min(1, life / SPRAY.life);
  return Math.min(1, rest / SPRAY.life) * clamp01(life / settleLife(rest));
}

/**
 * How far a flake has tumbled, in radians.
 *
 * The angle is `spin` times the life *remaining*, which is a falling ramp - so
 * the flake turns at a constant `spin` radians a second and every flake is at a
 * different phase without storing one. That is a neat trick and it acquires a
 * trap the moment anything cuts the life: a flake landing with half a second in
 * hand would have its angle jump by up to two radians on the frame it touched
 * down, which is a sprite visibly teleporting into another orientation.
 *
 * So a settled flake is turned by the life it *arrived* with, which is frozen.
 * It is continuous at the hand-off for nothing - `rest` is banked before the cut,
 * so on the landing frame the two branches evaluate to the same angle - and it is
 * what should happen anyway: snow that has come to rest is not still tumbling.
 */
export function sprayTumble(spin: number, life: number, rest: number): number {
  return spin * (rest > 0 ? rest : life);
}

/* -------------------------------------------------------------------------- */
/* The carve                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Signed lateral speed of the board, in metres per second.
 *
 * `stepLane` interpolates with `smoothstep(t)`, whose derivative is `6t(1-t)`,
 * so this is exact rather than estimated - and it stays exact through a
 * mid-transition re-target, because `startX` moves with it.
 *
 * The obvious alternative, differencing `lane.x` between frames, is broken on
 * this architecture and not merely imprecise: the simulation runs on a fixed
 * step accumulator decoupled from rendering, so a frame with no due tick
 * reports zero lateral speed and a catch-up frame reports double. On any device
 * not locked to 60 Hz that is a stutter in everything driven from it.
 */
export function lateralSpeed(lane: LaneState, controlScale = 1): number {
  if (lane.t >= 1) return 0;
  const duration = TUNING.player.laneChangeDuration / Math.max(0.01, controlScale);
  return (6 * lane.t * (1 - lane.t) * (laneToX(lane.targetLane) - lane.startX)) / duration;
}

/**
 * The fastest a single-lane change can travel sideways: the peak of `6t(1-t)`
 * is 1.5, over one lane pitch, in one lane-change duration.
 *
 * A double swipe crosses two lanes and a fast board shortens the duration, so
 * `carve01` can be asked for more than 1 and is clamped. That is the right way
 * round - whatever it drives is already at its authored maximum by then.
 */
const PEAK_LATERAL = (1.5 * Math.abs(LANES[1] - LANES[0])) / TUNING.player.laneChangeDuration;

/**
 * How hard the board is edged, 0 (straight) to 1 (full carve).
 *
 * Used for the trench width and for the spray's emission rate, both of which
 * used to key off `abs(target - x) > 0.15`. A boolean steps part-way through
 * every lane change, and a step in a width or a rate is a visible pop.
 */
export function carve01(lane: LaneState, controlScale = 1): number {
  return clamp01(Math.abs(lateralSpeed(lane, controlScale)) / PEAK_LATERAL);
}

/* -------------------------------------------------------------------------- */
/* The carve trail                                                            */
/* -------------------------------------------------------------------------- */

/**
 * The sample ring behind the board.
 *
 * Parallel typed arrays rather than an array of objects: it is written and read
 * in full every frame, and this is the shape that never allocates and never
 * chases a pointer.
 */
export interface TrailRing {
  /** World X of the board when the sample was laid. */
  x: Float32Array;
  /** Half the trench width there, in metres. */
  halfWidth: Float32Array;
  /** Track distance the sample was laid at, which is what puts it in Z. */
  laidAt: Float32Array;
  /** Renderer clock at which it was laid, which is what fades it. */
  bornAt: Float32Array;
  /** 1 on the snow, 0 for the gap a jump leaves. */
  live: Float32Array;
  /** Slot the next sample overwrites. The ring is full from construction. */
  cursor: number;
  /** Track distance of the newest sample. */
  head: number;
}

export function createTrail(): TrailRing {
  const n = TRAIL.samples;
  return {
    x: new Float32Array(n),
    halfWidth: new Float32Array(n),
    laidAt: new Float32Array(n),
    bornAt: new Float32Array(n),
    live: new Float32Array(n),
    cursor: 0,
    head: 0,
  };
}

/** Drops the whole ribbon. Called when a restart rewinds the track distance. */
export function resetTrail(trail: TrailRing, distance: number): void {
  trail.live.fill(0);
  trail.laidAt.fill(distance);
  trail.cursor = 0;
  trail.head = distance;
}

/**
 * Lays however many samples the distance travelled has earned.
 *
 * Distance-driven, not tick-driven. "One sample per fixed step" would lay them
 * 0.35 m apart at the opening speed and 0.6 m apart at the top, so the ribbon's
 * resolution would quietly halve over the speed ramp and the ring would cover
 * twice the ground. This way the geometry is identical at every speed and on
 * every frame rate.
 *
 * Returns how many were laid, which is what the tests measure - a ring that
 * silently stops advancing looks identical to one that is working, because the
 * ribbon it leaves is behind the camera within half a second either way.
 *
 * @param grounded - false while the board is in the air or on a rail. The
 *        samples are still laid so the ring keeps pace with the track; they are
 *        marked dead so the ribbon has a hole rather than a bridge, and a jump
 *        breaks the line instead of smearing a straight segment across it.
 */
export function advanceTrail(
  trail: TrailRing,
  distance: number,
  x: number,
  halfWidth: number,
  grounded: boolean,
  now: number,
): number {
  // A restart rewinds `runtime.distance`. The old ribbon belongs to a run that
  // no longer exists, and left alone it would be strung out across the new one.
  if (distance < trail.head) {
    resetTrail(trail, distance);
    return 0;
  }

  const n = trail.x.length;
  const startHead = trail.head;
  const travelled = distance - startHead;
  const previous = (trail.cursor + n - 1) % n;
  const startX = trail.live[previous] ? trail.x[previous]! : x;

  let laid = 0;
  // Bounded by the ring length: at 36 u/s a frame covers three spacings, but a
  // resumed-from-background frame could ask for hundreds and there is no point
  // laying a sample the same loop is about to overwrite.
  while (distance - trail.head >= TRAIL.spacing && laid < n) {
    trail.head += TRAIL.spacing;

    // Interpolated towards where the board is now rather than stamped there.
    // Stamping would pile a frame's worth of samples on one X and then jump,
    // which turns a carve into a staircase at speed.
    const frac = travelled > 1e-6 ? (trail.head - startHead) / travelled : 1;
    const slot = trail.cursor;
    trail.x[slot] = lerp(startX, x, clamp01(frac));
    trail.halfWidth[slot] = halfWidth;
    trail.laidAt[slot] = trail.head;
    trail.bornAt[slot] = now;
    trail.live[slot] = grounded ? 1 : 0;

    trail.cursor = (slot + 1) % n;
    laid++;
  }

  // Hitting the cap means every slot was overwritten, so there is nothing left
  // to catch up *to*. Snapping the head forward stops it lagging the world by
  // a fixed debt for the rest of the run - which would draw the ribbon at the
  // wrong Z for ever, and only after a device had been backgrounded.
  if (laid === n) trail.head = distance;

  return laid;
}

/* -------------------------------------------------------------------------- */
/* The carve trail's cross-section                                            */
/* -------------------------------------------------------------------------- */

/**
 * Blends two authored hexes, in the space they were authored in.
 *
 * sRGB rather than scene-linear, deliberately. These are swatches picked by eye,
 * and "halfway between these two" means halfway by *value*; the linear-light mix
 * of the same pair lands visibly above the midpoint, which would wash out the
 * dark end of every gradient built here. The decode to linear happens once
 * afterwards, where `THREE.Color` does it for everything else.
 */
export function mixHex(a: string, b: string, t: number): string {
  const channels = (hex: string): number[] =>
    [0, 2, 4].map((i) => parseInt(hex.replace('#', '').slice(i, i + 2), 16));

  const from = channels(a);
  const to = channels(b);
  return `#${from
    .map((channel, i) =>
      Math.round(lerp(channel, to[i]!, clamp01(t)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

/**
 * Which side of the track the key light comes from: -1 for the left.
 *
 * Derived from the rig rather than authored, because the entire point of the
 * section below is that the groove is shaded by *this* light. The key sits at
 * `[-46, 52, -20]`, so it crosses the track travelling in +X and a face is lit to
 * the extent its normal points back into -X. Move the key and the groove's lit
 * and shaded faces swap with it, which is the only way this stays a lighting fact
 * rather than a decal that happens to agree today.
 */
export const SUN_SIDE: -1 | 1 = LIGHTING.key.position[0] < 0 ? -1 : 1;

/**
 * How far each trench wall is taken from `TRAIL.wallColor` towards the tone
 * beyond it - the lee wall towards the floor, the sunward one towards the lip.
 *
 * A *split* about the authored value rather than a lift or a darkening: the two
 * walls average to exactly `TRAIL.wallColor`, so this changes the shape of the
 * section and not its overall value. That matters more than it sounds, because
 * the frame's dark end had come to be carried entirely by saturated decals laid
 * on top of pale snow, and quietly taking the trench down another few points
 * would be buying contrast from a decal all over again. Darks are supposed to
 * come from the lighting falling off.
 *
 * The size is set by what the rig itself does to a groove. Dotting 45-degree
 * wall faces with the direction to the key gives about 0.95 for the wall turned
 * into it against 0.06 for the one turned away, with flat snow at 0.72 between
 * them - so the true split is many times this one. It is deliberately
 * underplayed, because the trail is a flat sheet at `TRAIL.y` standing in for
 * displaced material: on a surface the eye can see is flat, a full-strength
 * split reads as a painted highlight rather than as relief.
 */
export const WALL_SPLIT = 0.45;

/**
 * How far the lee lip is pulled back towards the wall tone.
 *
 * Smaller than {@link WALL_SPLIT} because a thrown lip is a rounded ridge rather
 * than a plane: its crest catches the key from any direction, so only its outer
 * slope loses the light. The sunward lip keeps `TRAIL.lipColor` untouched, which
 * keeps the brightest value in the section exactly where it was authored.
 */
export const LIP_SHADE = 0.3;

/**
 * How far the floor's sunward end is lifted towards the lit wall.
 *
 * The measured defect was a trench held **bit-identical across 45 pixels**, so
 * the floor needs an internal gradient or the widest surface in the section is
 * still a flat fill. It is bounce off the lit wall, so it lifts the far end only
 * and the authored `TRAIL.color` stays the darkest value in the section - the
 * groove does not get deeper here, it gets a direction.
 *
 * Held well under {@link WALL_SPLIT} so the lifted end stays below the shaded
 * wall. A floor brighter than the wall above it is not a groove, it is a stripe.
 */
export const FLOOR_LIFT = 0.22;

/**
 * How much of the section's relief a groove keeps when the board is running
 * straight.
 *
 * The across-track fix above removes the flat fill on one axis and leaves it
 * untouched on the other: eight tones repeated identically for 140 samples, so a
 * scan *down* the trench measures the same value for the ribbon's whole visible
 * length. That is the measured defect - a fill held bit-identical across a
 * surface - rotated ninety degrees, and it is fixed the same way, with a
 * gradient that comes from something real.
 *
 * The something real is the carve. A board on its edge displaces more snow than
 * one running flat, so the groove behind a hard turn is deeper as well as wider,
 * and the whole section's contrast scales with it: floor down, lips up. The carve
 * used to only widen the floor, under a comment claiming that made it "dig in" -
 * which was an argument about proportion standing in for the value that would
 * have shown it.
 *
 * 0.65 rather than something nearer zero for the reason the histogram target was
 * retired. Taken too far this is a trail that vanishes while running straight,
 * which is most of a run - the effect deleted rather than fixed. At 0.65 the
 * resting floor displays at 133 against snow at 157-172, so it still reads as a
 * groove at a glance, and a hard carve takes it to 108. The darkest value on the
 * play surface is then something the player *did*, not a decal the frame carries
 * all the time.
 */
export const STRAIGHT_RELIEF = 0.65;

/**
 * Rungs in the depth ladder `CarveTrail` uploads: it builds a tone table at each
 * of `DIG_STEPS + 1` depths and picks one per sample.
 *
 * A ladder rather than a blend between a shallow table and a deep one, and the
 * reason is {@link mixHex}: these are swatches picked by eye and it blends them
 * in the space they were authored in, whereas lerping two `THREE.Color`s blends
 * in scene-linear and lands visibly above the midpoint at the dark end - which is
 * the trench, the one value in this section that has already been got wrong once.
 * Quantising keeps every rung exactly on the authored curve and turns a
 * per-vertex blend into an array index.
 *
 * Eight because the floor swings about 25 display levels across the carve, so a
 * rung is close to three - under where a gradient starts to band, and the tone
 * varies across the section as well, so no two step edges can line up into a
 * visible seam.
 *
 * That ties this to {@link STRAIGHT_RELIEF}: the two divide the same swing, so
 * deepening the groove without adding rungs coarsens every one of them. The
 * ladder test fails on it rather than leaving it to be found on a device.
 */
export const DIG_STEPS = 8;

/**
 * How hard the board was carving when a sample was laid, 0 to 1.
 *
 * Recovered from the half width the ring already stores rather than banked in a
 * seventh array beside it, and it is exact rather than an approximation:
 * `CarveTrail` lays `lerp(baseWidth, carveWidth, carve) / 2`, so inverting that
 * lerp returns precisely the `carve01` of the frame the sample was laid on. The
 * ring is written and read in full every frame and the point of its layout is
 * that it never allocates, so a value derivable from what is already there
 * should not cost another 140 floats.
 */
export function trenchDepth01(halfWidth: number): number {
  const span = (TRAIL.carveWidth - TRAIL.baseWidth) / 2;
  // Degenerate only if the two widths are authored equal, in which case the
  // trench never widens and the honest answer is that it is always fully dug.
  if (span <= 0) return 1;
  return clamp01((halfWidth - TRAIL.baseWidth / 2) / span);
}

/** One across-track vertex of the ribbon. */
export interface CarveVertex {
  /** Which side of the trench centre it sits on. */
  side: -1 | 1;
  /** Metres outboard of the trench floor's edge. Zero is the edge itself. */
  out: number;
  /** Authored tone, decoded to linear once by the renderer. */
  tone: string;
  /** Weight on the sample's alpha, so the outer edge can dissolve. */
  alpha: number;
}

/**
 * The ribbon's cross-section, ordered left to right, so consecutive entries are
 * a strip and the whole list is one sweep across the groove.
 *
 * Four vertices a side and seven strips, where the shipped ribbon had three
 * strips built from six vertices *duplicated* at every colour break. The change
 * is not decoration. A cross-section measured snow 165, lip 206, trench 104 held
 * bit-identical across 45 px, lip 206, snow: a flat fill of one tone between two
 * hard steps, symmetrical about the centre, which is a painted stripe rather than
 * a groove. Nothing in a real frame has an edge five pixels wide, and no groove
 * under a raking key is symmetrical.
 *
 * So every vertex here is shared between the two strips that meet at it and the
 * interpolator draws the gradients for free. The only edge left is the outer one,
 * and it dissolves on alpha instead of stepping. Every strip is therefore a
 * gradient in value, in alpha or in both, and there is no hard transition and no
 * flat fill anywhere across the section.
 *
 * The wall tone sits at the *midpoint* of its band rather than at either end,
 * which is what makes the wall a gradient on both of its edges instead of a step
 * on one of them.
 *
 * Widths come from `TRAIL`; the tones are derived from the three authored ones
 * and stay inside them at both ends. This never invents a value darker than the
 * trench or brighter than the lip.
 *
 * @param dig - how hard the board was carving, from {@link trenchDepth01}. It
 *        scales the *relief* and nothing else: every tone is pulled towards
 *        `TRAIL.wallColor`, the section's own middle, so a shallow groove loses
 *        its floor and its lips together the way less displaced snow does. The
 *        default is the fully carved section, which is what the geometry and the
 *        alpha profile are built from - only the tones depend on this.
 */
export function carveSection(dig = 1): CarveVertex[] {
  // Collapsing towards the wall keeps every derived tone between the authored
  // floor and the authored lip at any depth, so a shallow groove cannot invent
  // a value the art direction never asked for.
  const contrast = lerp(STRAIGHT_RELIEF, 1, clamp01(dig));
  const relief = (tone: string): string => mixHex(TRAIL.wallColor, tone, contrast);

  // The four derived tones are built at full relief and dimmed once at the end,
  // so `WALL_SPLIT`, `LIP_SHADE` and `FLOOR_LIFT` keep meaning what their own
  // comments say - fractions of the authored section - rather than fractions of
  // whatever is left of it at this depth.
  const wallLit = mixHex(TRAIL.wallColor, TRAIL.lipColor, WALL_SPLIT);
  const litWall = relief(wallLit);
  const shadeWall = relief(mixHex(TRAIL.wallColor, TRAIL.color, WALL_SPLIT));
  const shadeLip = relief(mixHex(TRAIL.lipColor, TRAIL.wallColor, LIP_SHADE));
  const litFloor = relief(mixHex(TRAIL.color, wallLit, FLOOR_LIFT));
  // The two authored ends of the section are dimmed by the same rule as the
  // tones derived from them; nothing here may sit at full relief while the rest
  // of the groove is shallow.
  const litLip = relief(TRAIL.lipColor);
  const darkFloor = relief(TRAIL.color);

  const out: CarveVertex[] = [];
  for (const side of [-1, 1] as const) {
    /*
     * The sunward side carries the brightest tone in the section and the darkest
     * one, and that is the whole reason it reads as relief rather than as a band.
     *
     * Take the wall faces at 45 degrees and dot them with the direction to the
     * key, `(-0.63, 0.72, -0.28)`. The wall on the *sun's* side of the groove
     * faces back across the track, away from the light: 0.06, against 0.72 for
     * flat snow. The far wall is tipped straight into it: 0.95, brighter than the
     * snow around it. The lips are the same two numbers the other way round,
     * because a lip's outer slope faces outboard where a wall's faces inboard -
     * so the key's side gets a bright lip over a dark wall and the far side the
     * reverse. The floor follows its walls: dark under the shaded one, lifted at
     * the far end by the bounce off the lit one.
     */
    const sunward = side === SUN_SIDE;
    const band = [
      { out: TRAIL.wallWidth + TRAIL.lipWidth, tone: sunward ? litLip : shadeLip, alpha: 0 },
      { out: TRAIL.wallWidth, tone: sunward ? litLip : shadeLip, alpha: 1 },
      { out: TRAIL.wallWidth / 2, tone: sunward ? shadeWall : litWall, alpha: 1 },
      { out: 0, tone: sunward ? darkFloor : litFloor, alpha: 1 },
    ];

    // Outside-in on the left, inside-out on the right, so the concatenation is
    // monotonic in across-track offset for any half width and no quad folds.
    for (const vertex of side === -1 ? band : [...band].reverse()) out.push({ side, ...vertex });
  }
  return out;
}

/**
 * The ribbon: `TRAIL.samples` copies of the section, with a static index buffer
 * and dynamic positions and colours.
 *
 * Quads are stitched between *buffer* slots, not ring slots. `CarveTrail` lays
 * the ring out oldest-first every frame, so slot k always neighbours slot k+1 in
 * age; indexing the ring directly would stitch the newest sample to the oldest
 * across the wrap and drag one triangle over the entire ribbon.
 *
 * Here rather than in the component for the same reason `buildSnowField` is: the
 * stride arithmetic is the one part of the trail that can be silently wrong -
 * a dropped strip or a quad stitched across the wrap both still draw - and it is
 * only measurable outside a GL context.
 *
 * The colour attribute is four components so the fade can ride the vertex alpha.
 * Three would need a whole-ribbon opacity, and the fade has to run *along* the
 * ribbon as it ages and *across* it where the lip dissolves into the snow.
 */
export function buildCarveRibbon(): THREE.BufferGeometry {
  const perSample = carveSection().length;
  const strips = perSample - 1;
  const vertices = TRAIL.samples * perSample;

  const positions = new THREE.BufferAttribute(new Float32Array(vertices * 3), 3);
  const colors = new THREE.BufferAttribute(new Float32Array(vertices * 4), 4);
  positions.setUsage(THREE.DynamicDrawUsage);
  colors.setUsage(THREE.DynamicDrawUsage);

  const indices = new Uint16Array((TRAIL.samples - 1) * strips * 6);
  let at = 0;
  for (let i = 0; i < TRAIL.samples - 1; i++) {
    for (let s = 0; s < strips; s++) {
      // Consecutive across-track slots, because the section shares its vertices
      // between neighbouring strips. The three-strip ribbon this replaced strode
      // by two, since every colour break carried a duplicated pair.
      const a = i * perSample + s;
      const b = a + 1;
      const c = a + perSample;
      const d = c + 1;
      indices[at++] = a;
      indices[at++] = b;
      indices[at++] = c;
      indices[at++] = b;
      indices[at++] = d;
      indices[at++] = c;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', positions);
  geometry.setAttribute('color', colors);
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  return geometry;
}

/* -------------------------------------------------------------------------- */
/* Marker poles                                                               */
/* -------------------------------------------------------------------------- */

export interface MarkerInstance {
  x: number;
  /** Metres along the recycling band, before the scroll wrap is applied. */
  zOffset: number;
  /** Fraction of `MARKERS.height`. Never above 1 - see below. */
  scale: number;
  /** Radians of lean, so the line is planted rather than printed. */
  lean: number;
}

/**
 * The deterministic marker layout, from a fixed decorative seed exactly as the
 * treeline's is.
 *
 * Three properties are load-bearing and none is decoration.
 *
 * **The offsets tile the band exactly.** `wrapZ` maps an offset into
 * `[0, TRACK_SPAN)`, so a jittered cumulative walk would leave a gap or an
 * overlap at the seam that travels down the run once per lap. Each pole is
 * jittered *within its own slot* instead, and the slot width is derived by
 * dividing the band rather than taken from `MARKERS.spacing`, so the ring
 * closes on itself whatever the spacing is set to.
 *
 * **The spacing is not constant.** A strictly periodic stream at six to ten
 * hertz is a signal the eye locks phase to and stops integrating, which is the
 * exact failure the ground ridges have: it carries *phase* and discards *rate*,
 * so it looks the same at every speed. Broadband spacing is what makes it read
 * as a rate, which is the entire point of this package.
 *
 * **The sides are rolled independently.** The treeline alternates strictly with
 * `i % 2`, which is perfect bilateral symmetry at a fixed pitch and the
 * strongest procedural tell in the game. Two independent draws cannot mirror.
 */
export function markerLayout(): MarkerInstance[] {
  // Fixed seed: the layout is decorative and stable across runs.
  const rng = createRng(0x5a17);

  const perSide = Math.max(2, Math.round(TRACK_SPAN / MARKERS.spacing));
  const slot = TRACK_SPAN / perSide;

  const out: MarkerInstance[] = [];
  for (const side of [-1, 1]) {
    for (let i = 0; i < perSide; i++) {
      out.push({
        x: side * (MARKERS.x + rng.range(-0.12, 0.12)),
        // Kept inside the slot, so the sequence still tiles the band exactly.
        // At 0.3 the widest gap two neighbours can open is 1.6 slots and the
        // tightest is 0.4 - broadband enough to carry a rate, nowhere near a
        // hole or a pile-up.
        zOffset: i * slot + rng.range(-0.3, 0.3) * slot,
        // Only ever downwards. `MARKERS.height` is the height at which a
        // decorative object stops being obviously unjumpable, so it is a
        // ceiling rather than a nominal value, and a per-instance roll is
        // precisely the place a ceiling gets breached without anyone noticing.
        scale: rng.range(0.82, 1),
        lean: rng.range(-0.09, 0.09),
      });
    }
  }
  return out;
}
