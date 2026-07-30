/**
 * Art direction, where it is checkable.
 *
 * Most of a look is a judgement call and belongs in front of eyes, not in a
 * test. What is testable is the *machinery*: that the saturation push does only
 * what it claims, and that the sky is genuinely exempt from it rather than
 * exempt by someone remembering to leave it alone.
 */

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { LANES, TUNING } from '@/game/config/tuning';
import { OBSTACLES } from '@/game/content/obstacles';
import {
  LANDING_MARK,
  LIGHTING,
  MARKERS,
  MOUNTAINS,
  PALETTE,
  PATROL,
  PISTE_CADENCE,
  SATURATION,
  SHADOW,
  TRAIL,
  floorValue,
  saturate,
} from '@/game/config/visuals';
import { GROUND_PERIOD } from '@/game/render/groundGeometry';
import { ALBEDO_TILE_Z } from '@/game/render/snowSurface';

/** Spread between the strongest and weakest channel - a stand-in for chroma. */
function chroma(hex: string): number {
  const value = hex.replace('#', '');
  const channels = [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16));
  return Math.max(...channels) - Math.min(...channels);
}

function luma(hex: string): number {
  const value = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16) / 255) as [
    number,
    number,
    number,
  ];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

describe('the saturation push', () => {
  it('raises chroma', () => {
    for (const hex of ['#2b8452', '#9a5f36', '#5f93c9', '#c98a1f']) {
      expect(chroma(saturate(hex))).toBeGreaterThan(chroma(hex));
    }
  });

  it('leaves greys grey', () => {
    // The property that keeps snow white and steel neutral rather than tinting
    // them. With no chroma to scale there is nothing to push.
    for (const hex of ['#ffffff', '#808080', '#000000']) {
      expect(chroma(saturate(hex))).toBe(0);
    }
  });

  it('holds lightness roughly still', () => {
    // Chroma only. Lifting lightness would flatten the value contrast the whole
    // art direction rests on - a mid-tone piste under near-white obstacles is
    // the entire reason anything has a silhouette at speed.
    for (const hex of ['#2b8452', '#9a5f36', '#aecce9']) {
      expect(Math.abs(luma(saturate(hex)) - luma(hex))).toBeLessThan(0.02);
    }
  });

  it('clamps rather than wrapping an already-vivid colour', () => {
    // A channel pushed past full has to stop at full. Wrapping would turn a
    // bright red into something else entirely, and only on the most saturated
    // colours in the game - the ones most likely to be a gameplay signal.
    for (const hex of ['#ff0000', '#00ff00', '#0033ff', '#ffd35c']) {
      const value = saturate(hex).replace('#', '');
      expect(value).toMatch(/^[0-9a-f]{6}$/);
      for (const i of [0, 2, 4]) {
        expect(parseInt(value.slice(i, i + 2), 16)).toBeGreaterThanOrEqual(0);
        expect(parseInt(value.slice(i, i + 2), 16)).toBeLessThanOrEqual(255);
      }
    }
  });

  it('is a push rather than a wash', () => {
    // Sanity on the constant itself. Below 1 it would be desaturating, and far
    // above it the palette stops being the authored one.
    expect(SATURATION).toBeGreaterThan(1);
    expect(SATURATION).toBeLessThan(2);
  });
});

describe('the value floor', () => {
  /*
   * The counterpart to the saturation push, and it guards a lighting fact
   * rather than a preference: a face turned towards the camera receives neither
   * the key nor `SKY.sunDirection` - both point down-track, so `N.L` is
   * negative against both - and is left with the fill and the hemisphere alone.
   * Push a near-black albedo through that and ACES returns literal black. The
   * ski patrol's tread is authored at `#0c0f13`, which is why the machine reads
   * as a black crate rather than as a vehicle with a dark track on it.
   */

  /** The darkest thing on the machine, as `patrolGeometry.ts` authors it. */
  const TREAD = '#0c0f13';
  /** Its red body, and the trap this function has to avoid. */
  const BODY = '#b8322c';

  /** Brightest channel - "is any light coming off this at all". */
  function value(hex: string): number {
    const raw = hex.replace('#', '');
    return Math.max(...[0, 2, 4].map((i) => parseInt(raw.slice(i, i + 2), 16))) / 255;
  }

  it('raises a colour that is under the floor to it', () => {
    expect(value(floorValue(TREAD, PATROL.liveryFloor))).toBeCloseTo(value(PATROL.liveryFloor), 2);
  });

  it('leaves a colour that is already above it alone', () => {
    // A floor, not a flattening. Running a whole palette through this must not
    // collapse it onto one value - the machine still needs a dark end.
    expect(floorValue('#f7fbfe', PATROL.liveryFloor)).toBe('#f7fbfe');
    expect(floorValue(BODY, PATROL.liveryFloor)).toBe(BODY);
  });

  it('and a luminance floor is what that rejects', () => {
    // The mutation, stated as the value that would have driven it. Rec. 709
    // rates the patrol's red at 0.31 - below the floor's 0.37 - so a floor
    // written in luminance would have lifted the one colour on the machine that
    // has to survive, and turned it pink. The brightest channel gets it right
    // because it asks whether any light is coming off the surface rather than
    // how much the eye weighs it.
    expect(luma(BODY)).toBeLessThan(luma(PATROL.liveryFloor));
    expect(value(BODY)).toBeGreaterThan(value(PATROL.liveryFloor));
  });

  it('lifts without recolouring', () => {
    // An additive lift, so the differences between the channels survive exactly
    // and the result is the same colour under more light rather than a
    // different colour. A multiplicative lift would scale the chroma with the
    // value and turn a near-neutral panel into a tinted one - which on a machine
    // that already measured as the most saturated mass in the frame is the one
    // direction it must not move.
    expect(chroma(floorValue(TREAD, PATROL.liveryFloor))).toBe(chroma(TREAD));
  });

  it('and the tread is what needs it', () => {
    // The counterweight. "Lifting works" is worth nothing if nothing in the game
    // is ever under the floor, and this asserts the case that motivated it is
    // real rather than hypothetical.
    expect(value(TREAD)).toBeLessThan(value(PATROL.liveryFloor) - 0.3);
  });
});

describe('the sky is exempt', () => {
  /*
   * The one exemption that matters, pinned to the authored values.
   *
   * The sky already carries the widest hue journey in the scene - deep blue
   * overhead to a hot horizon - and it fills most of the frame; pushing it
   * further turns a gradient into a poster. Fog goes with it, because it is the
   * atmosphere the world dissolves into and has to agree with what is behind it
   * or the horizon acquires a seam.
   *
   * Comparing against literals is the point. Wrapping any of these in
   * `saturate()` would be invisible in review and obvious on screen, so the test
   * has to hold the actual numbers rather than a property they happen to have.
   */
  it('keeps the authored sky, sun and fog exactly as written', () => {
    // The zenith is re-authored, not merely nudged: it is aimed at the top of
    // the launch poster now that the tone curve no longer lifts the toe. See
    // `PALETTE.skyZenith`. These literals track the authored values - what they
    // guard is that none of them acquires a `saturate()` wrapper.
    expect(PALETTE.skyZenith).toBe('#071a3a');
    expect(PALETTE.skyMid).toBe('#3a78ad');
    expect(PALETTE.skyHorizon).toBe('#e08a3c');
    expect(PALETTE.sunCore).toBe('#fff6e0');
    expect(PALETTE.sunGlow).toBe('#ff9f43');
    expect(PALETTE.fog).toBe('#7d9fc4');
  });

  it('does push everything the player rides through', () => {
    // The counterweight. If the palette were exempt end to end this file would
    // pass while nothing on screen had changed at all.
    const world = [
      PALETTE.piste,
      PALETTE.pisteLine,
      PALETTE.snowShadow,
      PALETTE.mountainFar,
      PALETTE.mountainMid,
      PALETTE.mountainNear,
    ];

    // Each is the saturated form of something, so pushing again moves it again -
    // whereas an unsaturated authored value would already be at its final chroma.
    for (const hex of world) {
      expect(chroma(hex)).toBeGreaterThan(0);
    }

    // And the piste has to stay a mid-tone: it is the backdrop every near-white
    // obstacle is read against, so saturating it must not have brightened it
    // into the things it exists to contrast with.
    expect(luma(PALETTE.piste)).toBeLessThan(luma(PALETTE.snowLit) - 0.1);
  });
});

describe('the frame has a value range', () => {
  /*
   * The one measured defect in the shipped look, pinned so it cannot come back.
   *
   * Sampling the lower 60% of a real capture - the play space, excluding the
   * sky - found the mean at 69% and **70% of all pixels inside a single 10%
   * luminance band**, 70 to 80. The full range technically existed, 13 to 249,
   * but the bottom five deciles together accounted for 9.4% of the frame. That
   * is the whole of "the image has no weight": not that the scene is too
   * bright, but that it is almost entirely *one value*, so nothing separates
   * from anything else.
   *
   * Rendered luminance is not testable here. What is testable is the input: the
   * handful of authored colours that fill nearly all of that area. Fog covers
   * more than half the ground area of a frame and the piste is the largest
   * single surface in it, and both used to sit at 77-78% - within a point of
   * each other, at the top of the band that swallowed the frame.
   */
  it('keeps the two surfaces that fill the frame out of the crowded band', () => {
    // Below the 70% floor of the band, with a little margin. Restoring either
    // old value - fog `#a8cbe4` at 77.4%, piste `#aecce9` at 78.3% - fails here
    // naming the surface, which is the diagnostic that matters.
    expect(luma(PALETTE.fog)).toBeLessThan(0.68);
    expect(luma(PALETTE.piste)).toBeLessThan(0.72);
  });

  it('and still has a top end to separate against', () => {
    // The counterweight, and it is not a formality: "no band dominates" is
    // trivially satisfied by dragging the entire palette into a dark band, and
    // that would cost the near-white yeti the ground contrast the piste was
    // darkened to give it in the first place. Lit snow stays lit.
    expect(luma(PALETTE.snowLit)).toBeGreaterThan(0.9);
  });

  it('spans a real range end to end', () => {
    // The other counterweight: both assertions above are satisfied by a palette
    // that is merely dimmer while remaining just as flat. This is the one that
    // needs the darks to actually exist. The old palette's darkest play-space
    // surface was `mountainNear` at 48%, giving a spread of 0.48 - it fails
    // this outright.
    const surfaces = [
      PALETTE.snowLit,
      PALETTE.snowShadow,
      PALETTE.piste,
      PALETTE.fog,
      PALETTE.mountainFar,
      PALETTE.mountainMid,
      PALETTE.mountainNear,
    ].map(luma);

    expect(Math.max(...surfaces) - Math.min(...surfaces)).toBeGreaterThan(0.55);
  });

  it('grades the ranges by distance rather than pushing them alike', () => {
    // Aerial perspective is desaturation *and* a value lift together. The three
    // ranges used to share one saturation amount, so a 300 m peak was as
    // chromatic as a 160 m one and the only thing separating them was outline.
    // Chroma relative to value is what the eye reads as distance.
    const relativeChroma = (hex: string): number => chroma(hex) / 255 / luma(hex);

    expect(relativeChroma(PALETTE.mountainFar)).toBeLessThan(relativeChroma(PALETTE.mountainMid));
    expect(relativeChroma(PALETTE.mountainMid)).toBeLessThan(relativeChroma(PALETTE.mountainNear));

    // And the values still recede the right way - paler with distance. Getting
    // this backwards would satisfy the chroma ordering above perfectly while
    // putting the far range in front of the near one.
    expect(luma(PALETTE.mountainFar)).toBeGreaterThan(luma(PALETTE.mountainMid));
    expect(luma(PALETTE.mountainMid)).toBeGreaterThan(luma(PALETTE.mountainNear));
  });
});

describe('the shadow box covers the track a player can read', () => {
  /*
   * `SHADOW.halfWidth` and `halfDepth` are half-extents in *light space*, and
   * light space here is nowhere near world space: with the key at
   * `[-46, 52, -20]` looking at the origin, the shadow camera's X axis works
   * out at about `(-0.399, 0, 0.917)`, which is almost pure world Z. So
   * `halfWidth` is the down-track extent and `halfDepth` is very nearly the
   * across-track one - both names say the opposite of what they do.
   *
   * That is not a naming quibble. Read the obvious way, `halfWidth` at 19 looks
   * like a generous nineteen metres of track either side of the player; it was
   * actually clipping every cast shadow at about 21 m of Z, two thirds of a
   * second at top speed, inside the band the player is reading.
   *
   * So the assertion is on the world-space consequence rather than on either
   * constant, and the basis is rebuilt from `LIGHTING.key.position` through the
   * same `lookAt` three uses, so it cannot drift from what the renderer does if
   * the sun is ever moved.
   */

  /**
   * Metres of track, either side of the player, over which every lane is inside
   * the shadow camera's frustum at ground level.
   */
  function trackCoveredBy(halfWidth: number, halfDepth: number): number {
    // Exactly what `DirectionalLightShadow.updateMatrices` does: put the camera
    // at the light and aim it at the target, which for an untouched
    // `DirectionalLight` is an `Object3D` sitting at the origin.
    //
    // A real camera and not a bare `Object3D`, and that matters: `lookAt`
    // branches on `isCamera`, and on a plain object it aims **+Z** at the
    // target rather than -Z. Getting a basis out of the wrong branch is a
    // silently reversed frustum.
    const shadowCamera = new THREE.OrthographicCamera();
    shadowCamera.position.set(...LIGHTING.key.position);
    shadowCamera.lookAt(0, 0, 0);
    shadowCamera.updateMatrixWorld();

    const right = new THREE.Vector3();
    const up = new THREE.Vector3();
    const back = new THREE.Vector3();
    shadowCamera.matrixWorld.extractBasis(right, up, back);

    const offset = new THREE.Vector3();
    const covers = (x: number, z: number): boolean => {
      offset.set(x, 0, z).sub(shadowCamera.position);
      // A camera looks down its own -Z, so view depth is the negated component
      // along the third basis vector.
      const depth = -offset.dot(back);
      return (
        Math.abs(offset.dot(right)) <= halfWidth &&
        Math.abs(offset.dot(up)) <= halfDepth &&
        depth >= SHADOW.near &&
        depth <= SHADOW.far
      );
    };

    // Scanned outward rather than solved algebraically. Three constraints
    // interact and only one of them binds; walking until something fails cannot
    // get the wrong one, and a tenth of a metre is finer than the answer needs.
    let reach = 0;
    for (let z = 0; z <= 200; z += 0.1) {
      if (!LANES.every((x) => covers(x, z) && covers(x, -z))) break;
      reach = z;
    }
    return reach;
  }

  it('reaches most of the visible run', () => {
    expect(trackCoveredBy(SHADOW.halfWidth, SHADOW.halfDepth)).toBeGreaterThan(28);
  });

  it('and the threshold is one the old value actually failed', () => {
    // The mutation, kept rather than done once by hand. A bound that has never
    // been seen to fail is not known to discriminate - and this one is guarding
    // a number whose name argues for the wrong reading every time it is read.
    expect(trackCoveredBy(19, SHADOW.halfDepth)).toBeLessThan(28);
  });

  it('is limited by the axis the name does not suggest', () => {
    // The counterweight that keeps the two assertions above honest. If
    // `halfDepth` were the binding constraint, widening `halfWidth` would have
    // bought nothing and the reach above would be a coincidence.
    const widened = trackCoveredBy(SHADOW.halfWidth * 2, SHADOW.halfDepth);
    expect(widened).toBeGreaterThan(trackCoveredBy(SHADOW.halfWidth, SHADOW.halfDepth));
  });

  it('keeps the key raking across the track rather than down it', () => {
    // The precondition for everything above, and for the whole light rig: the
    // key is far to the left so faces split into a lit and a shadowed side and
    // shadows fall across the run where they can be seen. Swinging it
    // down-track would drain the form out of every object in the game and would
    // do it quietly - this is where that fails loudly instead.
    const [x, , z] = LIGHTING.key.position;
    expect(Math.abs(x)).toBeGreaterThan(Math.abs(z));
  });
});

describe('the mountain ranges read as three distances', () => {
  /**
   * Degrees a layer's ridgeline rises above the horizon at the real camera.
   * This, not the raw height, is what the player sees - a range twice as tall
   * and twice as far away draws the same line in the same place.
   */
  function skylineDegrees(layer: { z: number; height: number }): number {
    return (Math.atan((layer.height - TUNING.camera.height) / Math.abs(layer.z)) * 180) / Math.PI;
  }

  it('separates the skylines by enough to see', () => {
    // At 74 / 54 / 36 the far and mid ranges topped out at 12.4 and 12.9
    // degrees. Half a degree is nothing: two of the three layers drew the same
    // ragged line in the same place, so the backdrop read as one band with a
    // texture problem rather than as depth.
    const angles = MOUNTAINS.layers.map(skylineDegrees);

    for (let i = 1; i < angles.length; i++) {
      expect(angles[i - 1]! - angles[i]!).toBeGreaterThan(2);
    }
  });

  it('and the old heights are what that threshold rejects', () => {
    // The mutation. Two degrees is only a meaningful floor if the arrangement
    // it replaced fell under it.
    const old = [
      { z: -300, height: 74 },
      { z: -220, height: 54 },
      { z: -160, height: 36 },
    ].map(skylineDegrees);

    expect(old[0]! - old[1]!).toBeLessThan(2);
  });

  it('keeps the near range genuinely low', () => {
    // The counterweight. Separation alone is satisfied by three ranges that all
    // tower, which reads as a wall rather than as a valley - the near range has
    // to sit low for the others to rise behind it, and it still has to clear
    // the horizon or it is not a mountain at all.
    const near = skylineDegrees(MOUNTAINS.layers[MOUNTAINS.layers.length - 1]!);
    expect(near).toBeGreaterThan(0);
    expect(near).toBeLessThan(12);
  });
});

describe('the piste cadence lands in phase with everything that tiles', () => {
  /*
   * The measured defect: the lane guides are unbroken continuous lines,
   * identical at 21 and 40 units per second, so the only repeating longitudinal
   * features in the frame are the fence posts and marker poles at the extreme
   * left and right. Feeling speed therefore requires looking away from the
   * gameplay, and towards the highest-contrast part of the frame at that.
   *
   * A cadence on the guides fixes it, and the trap is not the rate - it is that
   * the surface it lives on wraps twice, at different periods, and a cadence out
   * of phase with either one lays a jump across the slope every few seconds.
   */

  it('divides both periods the ground repeats on', () => {
    // The surface mesh snaps back a whole `GROUND_PERIOD` at a time and the
    // albedo map tiles every `ALBEDO_TILE_Z`. Exact division is what makes both
    // wraps invisible, whether the cadence ends up baked into vertex rows or
    // into the texture - and it has to hold for whichever `R4` chooses.
    expect(ALBEDO_TILE_Z / PISTE_CADENCE.spacing).toBeCloseTo(
      Math.round(ALBEDO_TILE_Z / PISTE_CADENCE.spacing),
      6,
    );
    expect(GROUND_PERIOD / PISTE_CADENCE.spacing).toBeCloseTo(
      Math.round(GROUND_PERIOD / PISTE_CADENCE.spacing),
      6,
    );
  });

  it('and the obvious round number is what that rejects', () => {
    // The mutation. Ten metres is what anybody reaches for first, and 114 and 38
    // are both indivisible by it - the assertion above is only worth having
    // because the natural choice fails it.
    expect(GROUND_PERIOD % 10).not.toBe(0);
    expect(ALBEDO_TILE_Z % 10).not.toBe(0);
  });

  it('clears the floor below which a transverse feature strobes', () => {
    // The ground advances 0.6 m per frame at top speed, so anything transverse
    // under about 1.5 m is sampled below twice per cycle and either strobes or
    // crawls backwards - the same constraint that sets how coarse the snow's
    // vertex bands and the corduroy's drift are. A cadence edge is transverse,
    // and the gap between two of them is the shortest thing it produces.
    const gap = PISTE_CADENCE.spacing * (1 - PISTE_CADENCE.duty);
    expect(gap).toBeGreaterThan(1.5);
  });

  it('repeats as a rhythm rather than as a second flicker', () => {
    // The band, and both ends of it are real. Too slow and the cadence is
    // scenery the eye never resolves into a rate; too fast and it joins the
    // marker poles at 6-11 Hz, where the frame already has one flicker and does
    // not need a second one competing with it inside the play space.
    const rateAt = (speed: number): number => speed / PISTE_CADENCE.spacing;
    expect(rateAt(TUNING.speed.max)).toBeLessThan(6);
    expect(rateAt(TUNING.speed.start)).toBeGreaterThan(1.5);
  });

  it('and reusing the marker spacing is what that rejects', () => {
    // The mutation, and it is the obvious thing to reach for: the poles are the
    // one repeating feature that already works, so matching their 3.5 m looks
    // like copying a solved problem. It is not - they *pass the camera*, where a
    // cadence converging on a vanishing point does not, and at 10 Hz on the run
    // itself it would strobe.
    expect(TUNING.speed.max / MARKERS.spacing).toBeGreaterThan(6);
  });

  it('stays a modulation rather than a break in the line', () => {
    // A gameplay constraint wearing visual clothes. The guides are what tell the
    // player where the lanes are, and a line that stops at intervals is
    // information that stops at intervals - eventually read as meaning
    // something. Full contrast would be a dashed line; this has to stay short of
    // one, and short of nothing.
    expect(PISTE_CADENCE.contrast).toBeGreaterThan(0.2);
    expect(PISTE_CADENCE.contrast).toBeLessThan(0.8);
  });
});

describe('the landing mark takes over where the cast shadow leaves', () => {
  /*
   * The measured defect: with the player at 4 m, a grid sampled across the lower
   * frame came back uniform snow - no shadow anywhere in it. At a 0.6 m hop the
   * shadow is there and correct. So the player loses their landing indicator at
   * exactly the height where lane choice matters, which is a playability defect
   * rather than only a visual one.
   *
   * The cause is geometry, and it is why the answer is a separate mark rather
   * than a change to the light: raising the key would keep the shadow in frame
   * and flatten every object in the game to do it.
   */

  /**
   * How far across the track a cast shadow is displaced, per metre of the
   * caster's height.
   *
   * Rebuilt from `LIGHTING.key.position` rather than written down, so it cannot
   * drift from the renderer if the sun is ever moved. The shadow travels
   * directly away from the light along the ground, at `horizontal / vertical` of
   * the height; the across-track share is the X component of that direction.
   */
  const acrossPerMetre = ((): number => {
    const [x, y, z] = LIGHTING.key.position;
    const horizontal = Math.hypot(x, z);
    return (horizontal / y) * (Math.abs(x) / horizontal);
  })();

  /** Lane pitch, which is the only scale a lane cue can be judged against. */
  const laneSpacing = Math.abs(LANES[1]! - LANES[0]!);

  it('starts while the real shadow is still under the player', () => {
    // A crossfade, not a handover. If the mark only appeared once the shadow was
    // useless there would be a height band with no cue at all, which is the
    // defect again in a narrower window.
    expect((LANDING_MARK.fadeFrom * acrossPerMetre) / laneSpacing).toBeLessThan(0.3);
  });

  it('is at full strength before the shadow could be read as the wrong lane', () => {
    // The threshold that matters. Past half a lane of displacement a shadow
    // stops answering the question it is being asked - it is as close to the
    // neighbouring lane as to the right one - and a confident wrong answer is
    // worse than none.
    expect((LANDING_MARK.fadeTo * acrossPerMetre) / laneSpacing).toBeGreaterThan(0.5);
  });

  it('and an ordinary jump is covered before its arc turns over', () => {
    // The cue has to be established while the player can still act on it. A mark
    // that only reached full strength at the top of the jump would arrive after
    // the decision it exists to inform.
    expect(LANDING_MARK.fadeTo).toBeLessThan(TUNING.player.jumpPeakHeight);
    expect(LANDING_MARK.fadeFrom).toBeLessThan(LANDING_MARK.fadeTo);
  });

  it('draws nothing at all on the ground', () => {
    // The counterweight, and it is the thing that would be seen as a bug: a
    // grounded player already has a real contact shadow, and a second mark laid
    // over it is not a stronger cue, it is a doubled one. Zero is not
    // "approximately absent" here - the fade has to start above the snow.
    expect(LANDING_MARK.fadeFrom).toBeGreaterThan(0);
  });

  it('grows and softens with height rather than riding the player', () => {
    // Without this the mark is a decal welded to their feet, which reads as the
    // player never having left the ground - the exact reading it exists to
    // prevent. Bigger and fainter is what "further away" looks like.
    expect(LANDING_MARK.airRadius).toBeGreaterThan(LANDING_MARK.groundRadius);
    expect(LANDING_MARK.strength).toBeLessThan(1);
    expect(LANDING_MARK.softness).toBeGreaterThan(0.25);
  });

  it('sits above everything else already lying on the snow', () => {
    // A shadow falls on whatever is under it, including the player's own carve
    // trail. Ordering by geometry rather than by depth-test luck is the same
    // rule the trail and the lane guides already follow, and at these grazing
    // angles it is the only one that holds.
    expect(LANDING_MARK.y).toBeGreaterThan(TRAIL.y);
  });
});

describe('the near-field markers stay out of the play space', () => {
  /**
   * How far from the centreline an obstacle can reach: the outermost lane plus
   * the widest obstacle's half-width. Derived from the real content rather than
   * written down, so adding a wider obstacle fails here instead of quietly
   * making a decoration collidable-looking.
   */
  const obstacleReach =
    Math.max(...LANES.map(Math.abs)) +
    Math.max(...Object.values(OBSTACLES).map((def) => def.halfWidth));

  it('sits outside anything the player has to steer around', () => {
    // The markers exist to give the frame something that *passes* the camera,
    // and the entire risk of that is a decoration read as a hazard: a player
    // who swerves for a marker pole has been lied to by the art.
    expect(MARKERS.x).toBeGreaterThan(obstacleReach + 0.5);
  });

  it('without retreating to where nothing sweeps past', () => {
    // The counterweight, and the one that stops the obvious fix. "Not an
    // obstacle" is trivially satisfied by putting the poles out with the trees,
    // where they subtend nothing and leave frame at the same vanishing point as
    // everything else. They belong in the narrow band between the obstacle
    // reach and the piste edge at 4.6 - the fence, at 5.1, is already too far
    // out to sweep.
    expect(MARKERS.x).toBeLessThan(obstacleReach + 1.2);
  });
});
