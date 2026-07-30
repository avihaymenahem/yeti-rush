/**
 * The maths behind the mark under an airborne player.
 *
 * Split out of `LandingMark.tsx` for the reason `nearField.ts` records: the lint
 * rule will not let a `.tsx` export anything but components, and - the reason
 * that outlives the rule - what is in here is a **gameplay readout**, not
 * decoration. It answers "which lane am I coming down in" at thirty units a
 * second, and a readout that can only be checked by looking at a GL context is a
 * readout nobody checks. `tests/landing.test.ts` checks this one.
 *
 * Named `landing.ts` rather than the `landingMark.ts` the pairing would suggest
 * because Windows resolves module paths case-insensitively: a `landingMark.ts`
 * beside a `LandingMark.tsx` is two files TypeScript sees as one, and it says so.
 *
 * `LANDING_MARK` carries the constants and the measurement behind them. The
 * short version: the key light throws the player's real cast shadow 0.96 m of
 * ground per metre of height, 92% of it *across* the track, so by the top of a
 * ramp arc the only honest altitude cue in the frame is somewhere outside it.
 * These two curves are what takes over.
 */

import { LANDING_MARK } from '@/game/config/visuals';
import { clamp01, lerp, smoothstep } from '@/game/core/math';

export interface LandingMarkPose {
  /** Radius on the snow, in metres. */
  radius: number;
  /**
   * How far the snow under the centre is taken towards `LANDING_MARK.tint`.
   *
   * **Exactly zero means there is nothing to draw**, and the caller is expected
   * to skip the mesh rather than submit a transparent quad - see `fadeFrom` for
   * why the ground has to be genuinely empty, and `LandingMark.tsx` for the draw
   * call it saves for most of a run.
   */
  strength: number;
}

/**
 * The mark at a given height above the snow.
 *
 * One function of one number, with no reference to `motion`. That is
 * deliberate: a rail exit, a ramp descent and an ordinary hop are all "the
 * player is above the snow and coming down", and the three special cases a
 * motion switch would need are three chances to leave one of them without a
 * cue. Height is the whole question being asked.
 *
 * Both curves ride the same eased fade, so the mark grows into strength rather
 * than appearing at full size and brightening. Eased rather than linear because
 * the player crosses `fadeFrom` twice on every single hop - a linear ramp has a
 * corner in it at each crossing, and a corner at the bottom of a jump reads as a
 * flicker.
 */
export function landingMarkAt(height: number): LandingMarkPose {
  const fade = smoothstep(
    clamp01((height - LANDING_MARK.fadeFrom) / (LANDING_MARK.fadeTo - LANDING_MARK.fadeFrom)),
  );

  return {
    // Capped at `airRadius` rather than left growing, which is where a real
    // penumbra and a readout part company. A mark that kept spreading with
    // height would be at its vaguest at the ramp apex - the one moment the
    // question "which lane" is hardest and matters most.
    radius: lerp(LANDING_MARK.groundRadius, LANDING_MARK.airRadius, fade),
    strength: LANDING_MARK.strength * fade,
  };
}

/**
 * The disc's own profile: 1 at the centre, 0 at the rim.
 *
 * Baked into a texture once rather than evaluated per fragment, so this runs at
 * build-the-texture time and never in a frame.
 *
 * The whole outer `softness` of the radius is gradient. A shadow cast from four
 * metres up by a light of any real angular size is nearly all penumbra, and a
 * crisp circle is the fastest way to make this read as a game UI element sitting
 * on the world rather than as light falling on it.
 */
export function landingFalloff(radius01: number): number {
  return smoothstep(clamp01((1 - radius01) / LANDING_MARK.softness));
}

/**
 * Texels across the mark's texture.
 *
 * The image is a radial gradient with no detail in it, so resolution buys
 * nothing past the point where filtering stops showing steps. The disc
 * magnifies to roughly 230 px on a phone at the ramp apex, which is a 3.5x
 * blow-up - but a bilinear blow-up of a smooth ramp is a smooth ramp, and the
 * artefact this size could produce needs a *feature* to sit on. There is none.
 */
export const MARK_TEXTURE_SIZE = 64;

/**
 * The disc, as RGBA bytes ready for a `DataTexture`.
 *
 * Built here rather than drawn into a 2D canvas inside the component, and both
 * reasons come back to this being a **playability** element.
 *
 * `canvas.getContext('2d')` may return null - a WebView under canvas-memory
 * pressure is the realistic case - and the only thing a drawing routine can
 * then do is leave the image blank. Blank on this material means `src.a = 0`,
 * which multiplies the framebuffer by exactly one: an *invisible* landing mark,
 * with no error, on the class of device where it is hardest to notice. That is
 * indistinguishable from never having built the thing, which is precisely the
 * measurement - a grid across the lower frame coming back as uniform snow -
 * that this element exists to answer.
 *
 * The other reason is that a byte array can be checked without a GL context,
 * which is the bar this file's header sets for a readout.
 *
 * **White RGB with the profile in the alpha, and that split is load-bearing.**
 * The material multiplies its `color` by this texture's RGB, so white delivers
 * `LANDING_MARK.tint` to the framebuffer untouched and the alpha is what three's
 * premultiply then scales it by. A tint baked in here would be applied twice.
 */
export function landingMarkTexels(size: number = MARK_TEXTURE_SIZE): Uint8Array {
  const data = new Uint8Array(size * size * 4);

  /*
   * `(size - 1) / 2`, so the outermost texel *centres* sit at radius 1 rather
   * than the outer edge of them. The plane is mapped edge to edge, so any other
   * choice leaves the falloff short of zero on the border and the disc shows
   * the four corners of its own square - on a multiply, as a faint dark frame
   * around the player.
   */
  const centre = (size - 1) / 2;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x - centre) / centre;
      const dy = (y - centre) / centre;
      const i = (y * size + x) * 4;
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = Math.round(255 * landingFalloff(Math.hypot(dx, dy)));
    }
  }

  return data;
}
