/**
 * The launch splash.
 *
 * A splash is judged by looking at it, and this file does not pretend
 * otherwise. What it holds is the two things about one that fail silently: the
 * shape it was composed to, and the four separate places that declare the
 * colour behind it.
 *
 * Both have a history. The colour was previously "kept in step" by a comment in
 * three files, which is a convention rather than a guarantee. And the reason the
 * poster is composed onto a taller canvas at all is that handing the raw 2:3 art
 * to a CENTER_CROP splash slices a third of the width off a modern phone -
 * which on this poster is most of the title, and which would read as nothing
 * worse than a tight crop to anyone who had not measured it.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { SPLASH_BACKGROUND } from '@/game/config/visuals';

const root = new URL('../', import.meta.url);
const file = (path: string) => fileURLToPath(new URL(path, root));
const read = (path: string) => readFileSync(file(path), 'utf8');

const ANDROID_SPLASH = 'android/app/src/main/res/drawable-nodpi/splash.webp';
const WEB_SPLASH = 'public/splash.webp';

/** 20:9. The tallest shape in common use, and the worst case for the width. */
const TALLEST = 20 / 9;
/** 16:9. Now the short end of the range, and the worst case for the height. */
const SHORTEST = 16 / 9;

/**
 * Fraction of an image's width that survives CENTER_CROP on a given screen.
 *
 * Both aspects are height / width. The image is scaled by whichever axis has to
 * grow more to cover the screen, so a screen taller than the image binds on
 * height and it is the width that gets cut.
 */
function keptWidth(image: number, screen: number): number {
  return screen > image ? image / screen : 1;
}

/** The same for the height, on a screen shorter than the image. */
function keptHeight(image: number, screen: number): number {
  return screen < image ? screen / image : 1;
}

describe('the composed splash canvas', () => {
  it('is committed for both the phone and the web', () => {
    for (const path of [ANDROID_SPLASH, WEB_SPLASH]) {
      expect(readFileSync(file(path)).subarray(8, 12).toString('ascii')).toBe('WEBP');
    }
  });

  it('keeps nearly all the poster width on the tallest phones', async () => {
    // The point of the whole exercise. Ninety per cent leaves the title, both
    // lines of pines and the outer fence posts on screen.
    const { width, height } = await size(ANDROID_SPLASH);
    expect(keptWidth(height / width, TALLEST)).toBeGreaterThan(0.88);
  });

  it('would have lost a third of it uncomposed', async () => {
    // The counterweight, and the reason this file exists. Every bound above is
    // satisfied by a square canvas that crops nothing and shows nothing, so this
    // asserts the raw art really is the wrong shape for the job.
    const source = await size('assets/splash.png');
    expect(keptWidth(source.height / source.width, TALLEST)).toBeLessThan(0.7);
  });

  it('crops into margin rather than into the rider on the shortest phones', async () => {
    // A screen shorter than the canvas takes its cut off the top and the bottom
    // equally. The top is invented sky and can lose any amount; the bottom is a
    // deliberately thin mirrored band, and a crop deeper than that is eating the
    // snowboard.
    const { width, height } = await size(ANDROID_SPLASH);
    const lostBelow = (1 - keptHeight(height / width, SHORTEST)) / 2;
    expect(lostBelow).toBeLessThan(0.06);
  });
});

describe('the colour behind the poster', () => {
  /*
   * Four declarations of one colour, in four languages, none of which can see
   * the others. The player sees them as a single launch sequence - system
   * splash, then window, then poster, then game - and any disagreement between
   * them is a flash.
   */
  it('is the colour the generator sampled from the art', () => {
    const sampled = JSON.parse(read('assets/splash.json')) as { zenith: string };
    expect(SPLASH_BACKGROUND).toBe(sampled.zenith);
  });

  it('matches the top of the image it sits behind', async () => {
    // The one assertion that survives the art being replaced. The others agree
    // with a constant; this agrees with the pixels, so regenerating from a
    // different poster and forgetting the colour fails here and not on a device.
    const { data } = await sharp(file(ANDROID_SPLASH))
      .extract({ left: 0, top: 0, width: 1, height: 1 })
      .raw()
      .toBuffer({ resolveWithObject: true });

    const declared = [1, 3, 5].map((i) => parseInt(SPLASH_BACKGROUND.slice(i, i + 2), 16));
    // Generous: the asset is lossy WebP, so the corner is not bit-exact.
    for (let channel = 0; channel < 3; channel++) {
      expect(Math.abs((data[channel] as number) - (declared[channel] as number))).toBeLessThan(8);
    }
  });

  it('is declared identically by the web, the native shell and the theme', () => {
    const css = /--splash:\s*(#[0-9a-f]{6})/.exec(read('src/index.css'));
    const capacitor = /SplashScreen:\s*\{[\s\S]*?backgroundColor:\s*'(#[0-9a-f]{6})'/.exec(
      read('capacitor.config.ts'),
    );
    const colors = /<color name="splashSky">(#[0-9A-Fa-f]{6})<\/color>/.exec(
      read('android/app/src/main/res/values/colors.xml'),
    );

    expect(css?.[1]).toBe(SPLASH_BACKGROUND);
    expect(capacitor?.[1]).toBe(SPLASH_BACKGROUND);
    expect(colors?.[1]?.toLowerCase()).toBe(SPLASH_BACKGROUND);
  });

  it('is what Android 12 paints under the launcher icon', () => {
    // Without this the system splash falls back to the AppCompat window
    // background, which is white - a white flash in front of a dusk poster.
    const theme = read('android/app/src/main/res/values-v31/styles.xml');
    expect(theme).toContain('android:windowSplashScreenBackground');
    expect(theme).toContain('@color/splashSky');
  });

  it('is not the daylight sky the game itself runs under', () => {
    // The counterweight to all of the above, which a single find-and-replace
    // would otherwise satisfy by making every colour in the project the same.
    const sky = /--sky:\s*(#[0-9a-f]{6})/.exec(read('src/index.css'));
    expect(sky?.[1]).not.toBe(SPLASH_BACKGROUND);
  });
});

async function size(path: string): Promise<{ width: number; height: number }> {
  const { width, height } = await sharp(file(path)).metadata();
  if (!width || !height) throw new Error(`${path}: no dimensions`);
  return { width, height };
}
