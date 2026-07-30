/**
 * The landing mark.
 *
 * This is a playability guarantee wearing a visual element's clothes, which is
 * why it gets a test file rather than a device check. The measured defect: with
 * the player at four metres a grid sampled across the lower frame came back
 * uniform snow - no shadow anywhere in it - so at the top of every ramp arc the
 * game asks for a lane decision and shows nothing to make it against. At a 0.6 m
 * hop the real cast shadow is there and correct.
 *
 * `tests/visuals.test.ts` already checks that the constants in `LANDING_MARK`
 * are consistent with the light rig. What is checked here is the *curve* built
 * on them: that the two cues overlap rather than merely abut, that the mark is
 * genuinely absent on the snow, and that the disc it draws is soft and stays
 * inside one lane.
 */

import { describe, expect, it } from 'vitest';
import { LANES, TUNING } from '@/game/config/tuning';
import { LANDING_MARK, LIGHTING } from '@/game/config/visuals';
import {
  landingFalloff,
  landingMarkAt,
  landingMarkTexels,
  MARK_TEXTURE_SIZE,
} from '@/game/render/landing';

/**
 * How far across the track the real cast shadow is displaced, per metre of the
 * player's height.
 *
 * Rebuilt from `LIGHTING.key.position` rather than written down, so it cannot
 * drift from the renderer if the sun is ever moved - the whole reason this file
 * exists is a consequence of where that light sits. The shadow travels directly
 * away from the light along the ground, at `horizontal / vertical` of the
 * height, and the across-track share is the X component of that direction.
 */
const acrossPerMetre = ((): number => {
  const [x, y, z] = LIGHTING.key.position;
  const horizontal = Math.hypot(x, z);
  return (horizontal / y) * (Math.abs(x) / horizontal);
})();

/** Lane pitch. The only scale a lane cue can be judged against. */
const laneSpacing = Math.abs(LANES[1]! - LANES[0]!);

/**
 * Displacement at which the cast shadow stops answering the question.
 *
 * Half a lane: past that it is as near the neighbouring lane's centre as its
 * own, and a confident wrong answer is worse than no answer.
 */
const shadowFailsAt = laneSpacing / 2 / acrossPerMetre;

/** The highest the player is ever thrown - a ramp apex, not a hop. */
const apex = TUNING.ramp.peakHeight;

/** Rec. 709 luminance of a hex, on 0-1. */
function luma(hex: string): number {
  const [r, g, b] = [0, 2, 4].map(
    (i) => parseInt(hex.replace('#', '').slice(i, i + 2), 16) / 255,
  ) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

describe('the mark and the cast shadow hand over without a gap', () => {
  it('draws nothing at all while the player is on the snow', () => {
    // Not "approximately nothing". A grounded player already has a real contact
    // shadow about 70 luminance levels deep and in the right desaturated
    // blue-grey; a second disc laid over it is not a stronger cue, it is a
    // doubled one, and a doubled shadow is a rendering fault the player can see.
    // Zero is also what lets the component skip the draw call entirely.
    expect(landingMarkAt(0).strength).toBe(0);
    expect(landingMarkAt(LANDING_MARK.fadeFrom).strength).toBe(0);
  });

  it('but does draw once the player is in the air', () => {
    // The counterweight to the above, which a function returning zero for every
    // height would otherwise satisfy perfectly.
    expect(landingMarkAt(TUNING.player.jumpPeakHeight).strength).toBeGreaterThan(0);
    expect(landingMarkAt(apex).strength).toBe(LANDING_MARK.strength);
  });

  it('leaves no height at which neither cue answers "which lane"', () => {
    /*
     * The guarantee, stated over the whole range the player can occupy rather
     * than at the two constants' values. At every height either the real shadow
     * is still displaced under half a lane, or the mark is carrying at least
     * half its strength - and the two bands overlap, so there is no altitude
     * where the player is flying blind.
     *
     * Sampled at a centimetre. The player leaves the snow at 13.3 u/s, so they
     * cross 22 cm in a frame at the fastest they ever change height - a gap
     * twenty times finer than that cannot hide between samples.
     */
    const step = 0.01;
    let checked = 0;
    let covered = 0;

    for (let height = 0; height <= apex; height += step) {
      checked++;
      const shadowUsable = height * acrossPerMetre < laneSpacing / 2;
      const markUsable = landingMarkAt(height).strength >= LANDING_MARK.strength * 0.5;
      if (shadowUsable || markUsable) covered++;
    }

    expect(checked).toBeGreaterThan(300);
    expect(covered).toBe(checked);
  });

  it('and the overlap is real rather than an exact abutment', () => {
    // The version of the above that fails loudly instead of by one sample. The
    // mark has to reach half strength strictly *below* the height at which the
    // shadow gives up, or the handover is a knife edge that any retune breaks.
    const halfStrengthAt = ((): number => {
      for (let height = 0; height <= apex; height += 0.001) {
        if (landingMarkAt(height).strength >= LANDING_MARK.strength * 0.5) return height;
      }
      return Infinity;
    })();

    expect(halfStrengthAt).toBeLessThan(shadowFailsAt);
    // A tenth of a metre of overlap is about a twentieth of a second of flight
    // at the top of a jump arc - small, but it is the margin, so it is asserted.
    expect(shadowFailsAt - halfStrengthAt).toBeGreaterThan(0.1);
  });

  it('never gets weaker as the player climbs', () => {
    // A non-monotonic cue is a cue that flickers, and this one is read in a
    // fifth of a second at the top of an arc.
    let previous = -1;
    for (let height = 0; height <= apex; height += 0.01) {
      const { strength } = landingMarkAt(height);
      expect(strength).toBeGreaterThanOrEqual(previous);
      previous = strength;
    }
  });
});

describe('the disc itself', () => {
  it('grows with height, and stops before it could touch another lane', () => {
    const low = landingMarkAt(LANDING_MARK.fadeFrom).radius;
    const high = landingMarkAt(apex).radius;

    // It must grow. A mark that stays the size of the player's feet reads as a
    // decal welded to them - the exact "he never left the ground" reading the
    // whole element exists to prevent.
    expect(high).toBeGreaterThan(low);

    // And it must stop growing. The rim may never reach the midpoint between
    // two lanes, or "where you will land" starts covering two answers at the
    // height where the question is hardest. Checked well past the apex, because
    // the cap is what makes that safe rather than the range of `player.y`.
    for (const height of [0, LANDING_MARK.fadeFrom, apex, apex * 4]) {
      expect(landingMarkAt(height).radius * 2).toBeLessThanOrEqual(laneSpacing);
    }
  });

  it('is mostly penumbra, with a core that still reads', () => {
    expect(landingFalloff(0)).toBe(1);
    expect(landingFalloff(1)).toBe(0);
    // Outside the disc, and it has to stay zero rather than wrap - the texture
    // is square and its corners sample past the rim.
    expect(landingFalloff(Math.SQRT2)).toBe(0);

    // Area-weighted, because that is what the eye integrates: a solid core over
    // half the disc's *area* is a hard-edged circle whatever its radius says. A
    // shadow cast from four metres up by a light of any real angular size is
    // nearly all penumbra, and a crisp circle is the fastest way to make this
    // read as a UI element sitting on the world rather than as light on it.
    const samples = 400;
    let solid = 0;
    let total = 0;
    for (let i = 0; i < samples; i++) {
      const radius01 = (i + 0.5) / samples;
      // An annulus at radius r has area proportional to r.
      total += radius01;
      if (landingFalloff(radius01) > 0.999) solid += radius01;
    }

    expect(solid / total).toBeLessThan(0.5);
    // The counterweight: "soft" is trivially satisfied by a disc that is all
    // gradient and has no centre, which reads as a smudge rather than as a
    // position. There has to be something solid to aim at.
    expect(solid).toBeGreaterThan(0);
  });

  it('never brightens as it goes outwards', () => {
    let previous = Infinity;
    for (let i = 0; i <= 200; i++) {
      const value = landingFalloff(i / 200);
      expect(value).toBeLessThanOrEqual(previous);
      previous = value;
    }
  });
});

describe('the texture the mark is actually drawn with', () => {
  /*
   * The curve above is only half the element; these are the bytes that reach
   * the GPU. They get their own block because the failure this guards is
   * *silent*: the previous version drew the profile into a 2D canvas, and
   * `getContext('2d')` returning null - a WebView under canvas-memory pressure -
   * left the image blank, which on a multiply is a framebuffer multiplied by one.
   * An invisible landing mark, no error, on the device it matters most on.
   */
  const size = MARK_TEXTURE_SIZE;
  const texels = landingMarkTexels();
  const alphaAt = (x: number, y: number): number => texels[(y * size + x) * 4 + 3]!;

  it('is a full RGBA image with every texel white', () => {
    expect(texels).toHaveLength(size * size * 4);

    // Load-bearing rather than tidy. The material multiplies `LANDING_MARK.tint`
    // by this RGB and three premultiplies the result by the alpha; a tint baked
    // in here would be applied twice and the core would land about twice as dark
    // as the constant says, on a value that was chosen by measurement.
    for (let i = 0; i < texels.length; i += 4) {
      expect(texels[i]).toBe(255);
      expect(texels[i + 1]).toBe(255);
      expect(texels[i + 2]).toBe(255);
    }
  });

  it('reaches zero on every border texel, so the square never shows', () => {
    // The plane is mapped edge to edge, so this is what makes the mark a disc
    // rather than a faint dark rectangle around the player. It is entirely a
    // property of sampling the outermost texel *centres* at radius 1, which is
    // the one thing in the generator that is easy to get wrong by one.
    for (let i = 0; i < size; i++) {
      expect(alphaAt(i, 0)).toBe(0);
      expect(alphaAt(i, size - 1)).toBe(0);
      expect(alphaAt(0, i)).toBe(0);
      expect(alphaAt(size - 1, i)).toBe(0);
    }
  });

  it('has a solid core, and never brightens on the way out to the rim', () => {
    // 64 is even, so there is no centre texel; the four around the centre are
    // the closest thing to one and all of them have to be solid.
    const inner = size / 2;
    expect(alphaAt(inner - 1, inner - 1)).toBe(255);
    expect(alphaAt(inner, inner)).toBe(255);

    // Along the centre row, which is where the resampling from `landingFalloff`
    // to texels could reintroduce a step the curve itself does not have.
    let previous = 256;
    for (let x = inner; x < size; x++) {
      const alpha = alphaAt(x, inner);
      expect(alpha).toBeLessThanOrEqual(previous);
      previous = alpha;
    }
  });

  it('removes real light from the snow it covers, not a token amount', () => {
    /*
     * The counterweight, and the one that would have caught the blank-canvas
     * failure. Every assertion above is satisfied perfectly by an image of all
     * zeroes: it is white, its border is zero, and it never brightens outwards.
     *
     * Averaged over the whole quad rather than at the core, because that is the
     * patch of snow the element occupies and the average is what makes it findable
     * by someone sweeping the frame - the critique's measurement was a grid, and a
     * grid samples the average. The bar is the measurement it has to beat: a
     * boulder read +8.0 luminance levels against adjacent snow and was called
     * unreadable.
     */
    let alphaSum = 0;
    for (let i = 3; i < texels.length; i += 4) alphaSum += texels[i]!;
    const coverage = alphaSum / 255 / (size * size);

    const removed = coverage * landingMarkAt(apex).strength * (1 - luma(LANDING_MARK.tint));
    // 144.5 is the measured piste, the darker of the two surfaces the mark lands
    // on and therefore the one with the least luminance available to remove.
    expect(144.5 * removed).toBeGreaterThan(8);
  });
});

describe('the mark is legible on both surfaces it lands on', () => {
  /*
   * `LANDING_MARK.tint` is a display-space *multiplier*, so the luminance it
   * removes is a fixed fraction of whatever is underneath - which is the whole
   * reason it is a multiply rather than a colour. The two surfaces below are the
   * measured ones from the frame that prompted this work.
   */
  const removed = landingMarkAt(apex).strength * (1 - luma(LANDING_MARK.tint));
  const surfaces = { piste: 144.5, field: 165 };

  it('darkens by far more than the obstacles the critique called invisible', () => {
    // The bar is set by the measurement, not by taste: a boulder read +8.0
    // luminance levels against adjacent snow and a drift +3.2, and both were
    // called unreadable. A cue the player has to act on inside a fifth of a
    // second has to clear that by a wide margin on both surfaces.
    for (const level of Object.values(surfaces)) {
      expect(level * removed).toBeGreaterThan(20);
    }
  });

  it('and by far less than a shadow of something actually on the snow', () => {
    // The counterweight, and the one that stops this being fixed by simply
    // making the disc black. A real cast shadow takes the piste from 144.5 down
    // to about 29 - some 115 levels. A mark that deep is not standing in for a
    // shadow four metres below the player, it is asserting they have landed.
    for (const level of Object.values(surfaces)) {
      expect(level * removed).toBeLessThan(90);
    }
  });
});
