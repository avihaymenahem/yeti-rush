/**
 * The colour pipeline, where it can be evaluated without a GPU.
 *
 * Everything here rests on one fact that is invisible in the source: **the sky,
 * the world and the fog are not on the same transfer function unless somebody
 * makes them be.** `WebGLProgram` declares `toneMapping()` and
 * `linearToOutputTexel()` in the fragment prefix but never calls them, so a
 * shader writing `gl_FragColor` directly puts a scene-linear value into an
 * sRGB-interpreted buffer; and three mixes `fogColor` *after* both chunks and
 * uploads it through `getUnlitUniformColorSpace`, so the fog hex is a literal
 * pixel that no exposure or grade can touch. Those two facts pointed in
 * opposite directions and met on the horizon line.
 *
 * So the interesting quantity is not any authored hex, it is the **display
 * luminance** each one becomes. That is computable, it is what the eye reads,
 * and it is what the measured baseline histogram was sampled in.
 */

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { TUNING } from '@/game/config/tuning';
import { ATMOSPHERE, MOUNTAINS, PALETTE, SKY } from '@/game/config/visuals';
import {
  fogDisplayColour,
  RANGE_SHADING,
  RIM,
  rangeVertexColour,
  rimTerm,
  SKY_GRADIENT,
  skyGradientAt,
  sunGlowTerm,
} from '@/game/render/atmosphere';
import { cameraDistanceFor } from '@/game/systems/camera';

/*
 * --- The pipeline, mirrored from three's own chunks ---
 *
 * `ACESFilmicToneMapping` from `tonemapping_pars_fragment` and the sRGB encode
 * from `colorspace_pars_fragment`, at `ATMOSPHERE.exposure`. Reproduced rather
 * than imported because three only ships them as GLSL strings.
 */

const ACES_INPUT = [
  [0.59719, 0.35458, 0.04823],
  [0.076, 0.90834, 0.01566],
  [0.0284, 0.13383, 0.83777],
] as const;

const ACES_OUTPUT = [
  [1.60475, -0.53108, -0.07367],
  [-0.10208, 1.10813, -0.00605],
  [-0.00327, -0.07276, 1.07602],
] as const;

type Rgb = [number, number, number];

function transform(matrix: readonly (readonly number[])[], v: Rgb): Rgb {
  return matrix.map((row) => row[0]! * v[0] + row[1]! * v[1] + row[2]! * v[2]) as Rgb;
}

function rrtAndOdtFit(v: Rgb): Rgb {
  return v.map((x) => {
    const a = x * (x + 0.0245786) - 0.000090537;
    const b = x * (0.983729 * x + 0.43295) + 0.238081;
    return a / b;
  }) as Rgb;
}

/** Scene-linear in, sRGB-encoded display value out. */
function throughToneCurve(linear: Rgb): Rgb {
  const exposed = linear.map((x) => (x * ATMOSPHERE.exposure) / 0.6) as Rgb;
  const mapped = transform(ACES_OUTPUT, rrtAndOdtFit(transform(ACES_INPUT, exposed)));
  return mapped.map((x) => {
    const c = Math.min(1, Math.max(0, x));
    return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  }) as Rgb;
}

/** Rec. 709 luminance of an already-encoded display triple. */
function luminance([r, g, b]: Rgb): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const asRgb = (colour: THREE.Color): Rgb => [colour.r, colour.g, colour.b];

/** What a scene-linear colour actually reads as on screen, 0-1. */
const displayLuma = (linear: Rgb): number => luminance(throughToneCurve(linear));

/**
 * What the *old* pipeline delivered: `gl_FragColor` written raw, so a linear
 * value is read back as though it were already sRGB-encoded.
 */
const rawWriteLuma = (linear: Rgb): number =>
  luminance(linear.map((x) => Math.min(1, Math.max(0, x))) as Rgb);

describe('the horizon does not have a seam', () => {
  /*
   * The seam is the one place in the frame where two surfaces are supposed to
   * be indistinguishable: the far end of the fogged ground, and the sky just
   * above it. They are drawn by different shaders, and until the dome was put
   * through the tone curve those shaders were not even in the same units.
   */
  const fogLuma = luminance(asRgb(fogDisplayColour()));
  const skyAtHorizon = asRgb(skyGradientAt(0));

  it('meets the fog within a few points of luminance', () => {
    expect(Math.abs(displayLuma(skyAtHorizon) - fogLuma)).toBeLessThan(0.04);
  });

  it('and the raw-write pipeline is what that threshold rejects', () => {
    // The mutation, kept rather than done once by hand. Taking the tone curve
    // back out of `Sky.tsx` - which is what shipped - drops the sky at the
    // horizon to about 42% against a fog at 61%: an eighteen-point step, along
    // a line that is meant to be invisible. A bound that has never been seen to
    // fail is not known to discriminate, and this one is guarding a defect
    // whose cause is two `#include`s that were never there.
    expect(Math.abs(rawWriteLuma(skyAtHorizon) - fogLuma)).toBeGreaterThan(0.15);
  });

  it('without flattening the sky into the fog to do it', () => {
    // The counterweight, and it is not a formality: "the horizon matches the
    // fog" is trivially satisfied by a sky that is one flat colour, which would
    // hand back the entire top of the frame. The dome still has to run from a
    // genuinely deep zenith to a hot horizon.
    const zenith = displayLuma(asRgb(skyGradientAt(1)));
    expect(zenith).toBeLessThan(0.1);
    expect(displayLuma(skyAtHorizon) - zenith).toBeGreaterThan(0.45);
  });

  it('keeps the fog colour intact through the round trip', () => {
    // The join below the horizon is exact by construction - the dome blends to
    // this value in the same space the fog is mixed in - but only if the value
    // really is the fog. `THREE.Color` converts on assignment, so a missing
    // colour-space argument anywhere here silently substitutes a linear triple
    // and puts the seam back.
    const recovered = fogDisplayColour();
    const authored = PALETTE.fog.replace('#', '');
    for (const [index, offset] of [0, 2, 4].entries()) {
      const channel = parseInt(authored.slice(offset, offset + 2), 16) / 255;
      expect(asRgb(recovered)[index]!).toBeCloseTo(channel, 2);
    }
  });

  it('states its gradient bands in the order GLSL requires', () => {
    // `smoothstep` is *undefined* in GLSL when `edge0 >= edge1`. These four
    // numbers are uploaded straight into the dome shader as a uniform, so a
    // reversed pair is not a wrong-looking sky, it is undefined behaviour that
    // happens to work on whichever driver it was tried on.
    expect(SKY_GRADIENT.lowerFrom).toBeLessThan(SKY_GRADIENT.lowerTo);
    expect(SKY_GRADIENT.upperFrom).toBeLessThan(SKY_GRADIENT.upperTo);
  });
});

describe('the sky sits below the snow it is seen against', () => {
  /*
   * The measured defect this pass exists for, and the one the previous round's
   * histogram target could not see: **the sky and the snow were the same
   * value.** Sampled 155.9 against snow at 157 to 172, over the two largest
   * areas in the world. No arrangement of foreground graphics fixes that,
   * because it is not a foreground problem - it is two enormous flat masses with
   * nothing between them.
   *
   * What makes it testable is that the visible sky is a small, fixed band. The
   * camera pitches about 6.8 degrees down and the vertical fov is 58, so the
   * dome is only ever seen between the horizon and about 22 degrees of
   * elevation, and it fills roughly 39% of a portrait frame. Everything above
   * that band is authored for nobody.
   */

  /** A tall phone, which is the framing the game is played in. */
  const ASPECT = 1080 / 2400;

  type Rgb = [number, number, number];

  /** `smoothstep` as GLSL and `skyGradientAt` both evaluate it. */
  const step = (x: number): number => {
    const t = Math.min(1, Math.max(0, x));
    return t * t * (3 - 2 * t);
  };

  const sunDirection = ((): Rgb => {
    const [x, y, z] = SKY.sunDirection;
    const length = Math.hypot(x, y, z);
    return [x / length, y / length, z / length];
  })();

  const glowTint = asRgb(new THREE.Color(PALETTE.sunGlow));

  /**
   * Display luminance of every sky pixel in the frame, sorted.
   *
   * The gradient and the glow arrive as functions rather than being read from
   * the module, so the same sampler can be pointed at the arrangement that
   * shipped. Reproducing the old bands is a mirror of `skyGradientAt`, which is
   * eight lines and is the only way to state what the threshold below rejects.
   *
   * The sun disc is left out - it is a handful of pixels - and so is the fog
   * join, which only applies below the horizon.
   */
  function skyLuminances(sky: (h: number) => Rgb, glow: (dotToSun: number) => number): number[] {
    const camera: Rgb = [0, TUNING.camera.height, cameraDistanceFor(ASPECT)];
    const target: Rgb = [0, TUNING.camera.lookAtHeight, TUNING.camera.lookAheadZ];

    const normalise = ([x, y, z]: Rgb): Rgb => {
      const length = Math.hypot(x, y, z);
      return [x / length, y / length, z / length];
    };
    const cross = (a: Rgb, b: Rgb): Rgb => [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0],
    ];
    const dot = (a: Rgb, b: Rgb): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

    const forward = normalise(target.map((v, i) => v - camera[i]!) as Rgb);
    const right = normalise(cross(forward, [0, 1, 0]));
    const up = cross(right, forward);
    // The base lens. The speed kick only ever widens it, which shows *more* sky
    // and therefore more of the part that has just been darkened - the base fov
    // is the harder case, not the average one.
    const tanHalf = Math.tan((TUNING.camera.fov / 2) * (Math.PI / 180));

    const WIDE = 64;
    const TALL = 144;
    const out: number[] = [];
    for (let row = 0; row < TALL; row++) {
      const ndcY = 1 - (2 * (row + 0.5)) / TALL;
      for (let column = 0; column < WIDE; column++) {
        const ndcX = (2 * (column + 0.5)) / WIDE - 1;
        const direction = normalise(
          [0, 1, 2].map(
            (axis) =>
              forward[axis]! + right[axis]! * ndcX * tanHalf * ASPECT + up[axis]! * ndcY * tanHalf,
          ) as Rgb,
        );

        if (direction[1] <= 0) continue; // ground, not dome
        const halo = glow(dot(direction, sunDirection));
        const linear = sky(direction[1]).map((c, i) => c + glowTint[i]! * halo) as Rgb;
        out.push(displayLuma(linear));
      }
    }
    return out.sort((a, b) => a - b);
  }

  const quantile = (values: number[], fraction: number): number =>
    values[Math.min(values.length - 1, Math.floor(fraction * values.length))]!;

  /**
   * The arrangement that was measured: bands at -0.06/0.3/0.18/0.85 and a glow
   * of size 0.22 at strength 0.55. Reproduced rather than described, because
   * every threshold below is only meaningful against what it rejects.
   */
  const shipped = skyLuminances(
    (h) => {
      const height = Math.max(-1, Math.min(1, h));
      const lower = step((height - -0.06) / (0.3 - -0.06));
      const upper = step((height - 0.18) / (0.85 - 0.18));
      return asRgb(
        new THREE.Color(PALETTE.skyHorizon)
          .lerp(new THREE.Color(PALETTE.skyMid), lower)
          .lerp(new THREE.Color(PALETTE.skyZenith), upper),
      );
    },
    (dotToSun) => Math.pow(Math.max(dotToSun, 0), 1 / 0.22) * 0.55,
  );

  const current = skyLuminances((h) => asRgb(skyGradientAt(h)), sunGlowTerm);

  /**
   * The darkest the play surface was measured at. The snow ran 157 near to 172
   * far, and the sky has to sit clear of the bottom of that.
   */
  const PLAY_SURFACE_FLOOR = 157 / 255;

  it('covers enough of the frame for this to be the whole problem', () => {
    // The precondition, and it is not a formality: if the dome were a sliver at
    // the top of the frame, none of the assertions below would be worth making.
    expect(shipped.length / (64 * 144)).toBeGreaterThan(0.3);
  });

  it('holds the middle of the visible dome well under the snow', () => {
    expect(quantile(current, 0.5)).toBeLessThan(0.53);
  });

  it('and the arrangement that shipped is what that rejects', () => {
    // The mutation, kept rather than done once by hand. The old bands spent the
    // whole visible window on the horizon-into-mid leg and the old glow was
    // still at half strength 31 degrees off a sun sitting inside the frame, so
    // the median came out *above* the darkest snow rather than 30 levels under
    // it. A bound that has never been seen to fail is not known to discriminate.
    expect(quantile(shipped, 0.5)).toBeGreaterThan(PLAY_SURFACE_FLOOR);
    expect(quantile(current, 0.5)).toBeLessThan(PLAY_SURFACE_FLOOR - 0.1);
  });

  it('empties the band the snow occupies rather than only shifting the mean', () => {
    // A mean can be dragged down by a dark corner while most of the dome still
    // sits in the snow's band, which would leave the defect exactly where it
    // was. This counts the pixels that are actually in it: 77% of the visible
    // sky used to be above 150, which is what "no value separation" looked like.
    const inTheBand = (values: number[]): number =>
      values.filter((value) => value > 150 / 255).length / values.length;

    expect(inTheBand(shipped)).toBeGreaterThan(0.6);
    expect(inTheBand(current)).toBeLessThan(0.25);
  });

  it('without turning a late afternoon into a night', () => {
    /*
     * The counterweight, and the one that stops the obvious cheat. "The sky is
     * darker than the snow" is trivially satisfied by a black dome, which would
     * take the frame's warmth, its only hue journey and the light source the eye
     * finds all at once.
     *
     * Two halves: the horizon band has to survive as a genuinely bright edge,
     * and the body of the dome has to stay daylight rather than dusk.
     */
    expect(quantile(current, 0.95)).toBeGreaterThan(0.55);
    expect(quantile(current, 0.5)).toBeGreaterThan(0.35);
  });
});

describe('the mountain ranges sit behind the sky', () => {
  /*
   * The named defect: the ranges are `meshBasicMaterial` and therefore
   * tone-mapped, against a dome that was not, so they rendered *brighter* than
   * the sky over their own ridgelines. Figure and ground inverted is what makes
   * a mountain read as cardboard - and no amount of silhouette detail fixes it,
   * because the eye reads value before it reads shape.
   */

  /** Sine of the elevation a point at height fraction `t` is seen at. */
  function elevationOf(layer: (typeof MOUNTAINS.layers)[number], t: number): number {
    const dy = t * layer.height + RANGE_BASE_Y - TUNING.camera.height;
    return dy / Math.hypot(dy, Math.abs(layer.z));
  }

  /** Matches `RANGE_BASE_Y` in `Mountains.tsx`. */
  const RANGE_BASE_Y = -2;

  const SAMPLES = 21;

  const shadingFor = (layer: (typeof MOUNTAINS.layers)[number]) => ({
    distance: Math.abs(layer.z),
    height: layer.height,
    baseY: RANGE_BASE_Y,
    eyeY: TUNING.camera.height,
  });

  /** Every vertex value a layer can produce, in display luminance. */
  function sweep(layer: (typeof MOUNTAINS.layers)[number], upTo = 1): number[] {
    const body = new THREE.Color(layer.color);
    const shading = shadingFor(layer);

    const out: number[] = [];
    for (let i = 0; i < SAMPLES; i++) {
      const t = (i / (SAMPLES - 1)) * upTo;
      for (const sunFacing of [0, 1]) {
        out.push(displayLuma(asRgb(rangeVertexColour(body, shading, t, sunFacing))));
      }
    }
    return out;
  }

  /** How far the rock rises above the sky in its own direction. Negative is right. */
  function worstInversion(layer: (typeof MOUNTAINS.layers)[number]): number {
    const body = new THREE.Color(layer.color);
    const shading = shadingFor(layer);

    let worst = -Infinity;
    for (let i = 0; i < SAMPLES; i++) {
      // Rock only. Above the snowline the surface is snow, and snow is
      // *supposed* to sit brighter than the sky - that is a cap, not an
      // inversion, and testing it as one would forbid the whole feature.
      const t = (i / (SAMPLES - 1)) * RANGE_SHADING.snowLineFrom;
      const sky = displayLuma(asRgb(skyGradientAt(elevationOf(layer, t))));
      for (const sunFacing of [0, 1]) {
        worst = Math.max(
          worst,
          displayLuma(asRgb(rangeVertexColour(body, shading, t, sunFacing))) - sky,
        );
      }
    }
    return worst;
  }

  it('never puts rock in front of the sky it is seen against', () => {
    // Compared at each vertex's *own* elevation, which is the comparison the
    // eye makes and the one a single hex per range cannot satisfy: this sky
    // runs from 62% at the horizon to 41% eighteen degrees up, so one value
    // cannot sit behind all of it.
    expect(MOUNTAINS.layers.length).toBe(3);
    for (const layer of MOUNTAINS.layers) {
      expect(worstInversion(layer)).toBeLessThan(0);
    }
  });

  it('and the flat body colour is what that rejects', () => {
    // The mutation. The previous builder painted the whole body one colour and
    // only ever lightened it towards a cap, so every layer inverted somewhere -
    // the far range by more than forty points of display luminance at its own
    // ridgeline. This is the shape of the defect, recomputed rather than
    // described.
    const oldCap = (t: number): number => {
      const x = Math.min(1, Math.max(0, (t - 0.55) / 0.45));
      return x * x * (3 - 2 * x) * 0.85;
    };
    const capColour = new THREE.Color(PALETTE.snowLit);

    for (const layer of MOUNTAINS.layers) {
      let worst = -Infinity;
      for (let i = 0; i < SAMPLES; i++) {
        const t = i / (SAMPLES - 1);
        const sky = displayLuma(asRgb(skyGradientAt(elevationOf(layer, t))));
        const old = new THREE.Color(layer.color).lerp(capColour, oldCap(t));
        worst = Math.max(worst, displayLuma(asRgb(old)) - sky);
      }
      expect(worst).toBeGreaterThan(0.25);
    }
  });

  it('gains contrast as it gets closer, which is what makes it three distances', () => {
    /*
     * "Not brighter than the sky" is nearly free at the base, where the range
     * is meant to sit within a point or two of the horizon. What separates
     * three layers is how much *contrast* each one keeps partway up: the far
     * range is nearly dissolved and the near one has to read as a solid mass,
     * and the eye reads that ordering as distance without being told.
     */
    const contrast = MOUNTAINS.layers.map((layer) => {
      const sky = displayLuma(asRgb(skyGradientAt(elevationOf(layer, 0.4))));
      const body = new THREE.Color(layer.color);
      // The sunlit flank is the brighter of the two and therefore the harder case.
      return sky - displayLuma(asRgb(rangeVertexColour(body, shadingFor(layer), 0.4, 1)));
    });

    // Layers run furthest first.
    for (let i = 1; i < contrast.length; i++) {
      expect(contrast[i - 1]!).toBeLessThan(contrast[i]!);
    }
    // And the near range is a mass, not a haze. Without this the ordering above
    // is satisfied by three ranges that have all dissolved.
    expect(contrast[contrast.length - 1]!).toBeGreaterThan(0.15);
  });

  it('keeps the snow caps subordinate to the sky they stand against', () => {
    /*
     * The gap the inversion check above deliberately leaves, and a device found
     * what fell through it. That check stops at `snowLineFrom` on the correct
     * grounds that snow is *meant* to sit brighter than the sky - so nothing was
     * watching the caps at all, and compressing `SKY_GRADIENT` took the dome at
     * the ridgelines down by a third while leaving them exactly where they were.
     * The peaks went from 82/70/46 levels over the sky to 100/92/79 and read as
     * three glowing cones at the vanishing point.
     *
     * So the invariant is not "the cap is darker than the sky", which would
     * forbid snow, it is "the cap is snow rather than a light source". The bound
     * is the contrast the arrangement that was reviewed actually had.
     */
    const capOverSky = MOUNTAINS.layers.map((layer) => {
      const body = new THREE.Color(layer.color);
      const shading = shadingFor(layer);

      let worst = -Infinity;
      for (let i = 0; i < SAMPLES; i++) {
        // Above the snowline only - below it is rock, and rock is the other
        // test's business.
        const t =
          RANGE_SHADING.snowLineFrom + (1 - RANGE_SHADING.snowLineFrom) * (i / (SAMPLES - 1));
        const sky = displayLuma(asRgb(skyGradientAt(elevationOf(layer, t))));
        for (const sunFacing of [0, 1]) {
          worst = Math.max(
            worst,
            displayLuma(asRgb(rangeVertexColour(body, shading, t, sunFacing))) - sky,
          );
        }
      }
      return worst;
    });

    for (const contrast of capOverSky) {
      expect(contrast).toBeLessThan(85 / 255);
    }

    // The counterweight, and it is the whole reason this is a bound rather than
    // a ceiling of zero: "the cap does not shout" is trivially satisfied by a
    // range with no snow on it, which would take the snowline, the massif read
    // and three hundred metres of altitude cue with it.
    for (const contrast of capOverSky) {
      expect(contrast).toBeGreaterThan(30 / 255);
    }
  });

  it('without collapsing into a flat silhouette', () => {
    // The counterweight. "Darker than the sky" is trivially satisfied by
    // painting every range black, which would trade a cardboard cut-out for a
    // hole. Each layer has to span a real value range from its dissolved base
    // to its dark band and back up to its cap.
    for (const layer of MOUNTAINS.layers) {
      const values = sweep(layer);
      expect(Math.max(...values) - Math.min(...values)).toBeGreaterThan(0.15);
    }
  });

  it('closes more of the gap to the sky the further away it is', () => {
    // Aerial perspective is a *distance* cue, so the haze has to be graded by
    // distance rather than applied alike - which is exactly the defect the
    // palette pass fixed on the chroma side. Measured as the fraction of the
    // body-to-sky gap the haze closes at the base of each range, where it is
    // deepest.
    const closed = MOUNTAINS.layers.map((layer) => {
      const body = new THREE.Color(layer.color);
      const skyAtBase = displayLuma(asRgb(skyGradientAt(elevationOf(layer, 0))));
      const raw = Math.abs(displayLuma(asRgb(body)) - skyAtBase);
      const hazed = Math.abs(
        displayLuma(
          asRgb(
            rangeVertexColour(
              body,
              {
                distance: Math.abs(layer.z),
                height: layer.height,
                baseY: RANGE_BASE_Y,
                eyeY: TUNING.camera.height,
              },
              0,
              0.5,
            ),
          ),
        ) - skyAtBase,
      );
      return (raw - hazed) / raw;
    });

    // Layers run furthest first.
    for (let i = 1; i < closed.length; i++) {
      expect(closed[i - 1]!).toBeGreaterThan(closed[i]!);
    }
    // And the nearest range still hazes at all - a flat zero would satisfy the
    // ordering above only if the far ones did too, but a *near* range with no
    // haze is the case that would slip through.
    expect(closed[closed.length - 1]!).toBeGreaterThan(0.2);
  });

  it('puts the snowline at an altitude rather than at a fraction of each peak', () => {
    // A snowline is a height on the mountain, not a property of each summit.
    // The curve this replaced - `smoothstep(h / height, 0.55, 1.0) * 0.85`
    // against peak factors drawn from [0.62, 1.0] - evaluated to 0.055 at the
    // low end, so most peaks carried no cap at all and there was no line.
    const oldCap = (factor: number): number => {
      const t = Math.min(1, Math.max(0, (factor - 0.55) / 0.45));
      return t * t * (3 - 2 * t) * 0.85;
    };
    expect(oldCap(0.62)).toBeLessThan(0.1);

    // The lowest peak the generator can produce still reads as capped.
    const newCap = (factor: number): number => {
      const t = Math.min(
        1,
        Math.max(
          0,
          (factor - RANGE_SHADING.snowLineFrom) /
            (RANGE_SHADING.snowLineTo - RANGE_SHADING.snowLineFrom),
        ),
      );
      return t * t * (3 - 2 * t);
    };
    expect(newCap(0.62)).toBeGreaterThan(0.4);

    // And the counterweight: a snowline that catches the valleys is not a
    // snowline, it is white paint. Valleys are drawn from [0.08, 0.3].
    expect(newCap(0.3)).toBe(0);
  });
});

describe('the rim separates a silhouette without lighting the floor', () => {
  /*
   * The rim is the only mechanism in this renderer that varies with the
   * *viewing* angle, and a silhouette is a viewing-angle phenomenon. Both
   * directional lights point down-track, and `hemisphereLight` gives every
   * vertical face the identical fifty-fifty value whichever way it points.
   */

  it('gives nothing to a surface facing the camera square on', () => {
    expect(rimTerm(1, 0)).toBe(0);
  });

  it('grows as a surface turns away', () => {
    let previous = -1;
    for (const dotNV of [1, 0.8, 0.6, 0.4, 0.2, 0.05]) {
      const term = rimTerm(dotNV, 0);
      expect(term).toBeGreaterThan(previous);
      previous = term;
    }
  });

  it('is strong enough to survive the tone curve', () => {
    // The term is added to `outgoingLight` *before* tone mapping, and ACES
    // compresses its shoulder hard - which is why a value that looks absurd
    // next to a 0-1 albedo is the right size. Measured as it lands: the lift on
    // a typical lit prop at about half linear, in display luminance.
    const rim = rimTerm(0.08, 0);
    const tint = new THREE.Color(RIM.color);

    const plain = displayLuma([0.5, 0.5, 0.5]);
    const rimmed = displayLuma([0.5 + tint.r * rim, 0.5 + tint.g * rim, 0.5 + tint.b * rim]);

    // Under about eight points nobody sees an edge on a six-inch screen at
    // thirty units a second, which is where the first pass at this landed.
    expect(rimmed - plain).toBeGreaterThan(0.08);
  });

  it('gives a horizontal surface nothing at all', () => {
    /*
     * The assertion that protects the whole frame, and the reason the term
     * carries an orientation fade rather than only a Fresnel.
     *
     * The ground at forty metres, seen from a 3.2 m eye, is 4.6 degrees off the
     * view direction: `N.V` is 0.08, which is deep in the Fresnel's strongest
     * region. Fog does not save it either - `exp(-d^2 z^2)` is still 0.92 at
     * that distance. An unfaded rim would pour warm light over the entire
     * mid-ground and refill the exact luminance band the palette pass exists to
     * empty out.
     */
    expect(rimTerm(0.08, 1)).toBe(0);
  });

  it('and the same geometry on a wall is what that rejects', () => {
    // The mutation, stated as a value rather than a code edit: a vertical face
    // at the identical viewing angle takes the full term, so the orientation
    // fade is the *only* thing separating the floor case from it. Remove it and
    // the number above becomes this one.
    expect(rimTerm(0.08, 0)).toBeGreaterThan(0.7);
  });
});
