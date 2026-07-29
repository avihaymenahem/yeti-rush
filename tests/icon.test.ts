/**
 * The launcher and store icons.
 *
 * The app wore Ionic's Capacitor logo for eight releases. Nothing caught it,
 * because a wrong icon is not a wrong *behaviour* - the build succeeds, the app
 * installs, every test passes, and the only symptom is on a home screen nobody
 * was looking at. So what is asserted here is provenance: that the committed
 * PNGs are cut from `assets/splash.png` and not from anything else.
 *
 * The second thing tested is the adaptive geometry, which fails the same silent
 * way. An adaptive icon hands the launcher a 108dp layer and shows the middle
 * 72dp; generate that layer from the visible crop instead of the wider one and
 * every device that masks to a circle quietly shaves the yeti's crown off.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

const root = new URL('../', import.meta.url);
const file = (path: string) => fileURLToPath(new URL(path, root));
const read = (path: string) => readFileSync(file(path), 'utf8');

const RES = 'android/app/src/main/res';
const POSTER = 'assets/splash.png';

interface IconManifest {
  background: string;
  subject: { left: number; top: number; width: number; height: number };
}

const manifest = JSON.parse(read('assets/icon.json')) as IconManifest;

/** Every bucket Android will look in, with the size each file must be. */
const DENSITIES = [
  { dir: 'mdpi', legacy: 48, adaptive: 108 },
  { dir: 'hdpi', legacy: 72, adaptive: 162 },
  { dir: 'xhdpi', legacy: 96, adaptive: 216 },
  { dir: 'xxhdpi', legacy: 144, adaptive: 324 },
  { dir: 'xxxhdpi', legacy: 192, adaptive: 432 },
];

/** Fixed by the platform: the layer is 108dp, the guaranteed-visible part 72dp. */
const SAFE_FRACTION = 72 / 108;

/**
 * An image reduced to an 8x8 RGB thumbprint.
 *
 * Coarse on purpose. The committed PNGs are palette-quantised and resampled, so
 * nothing here can be compared bit for bit - but at 8x8 a crop of the poster and
 * a crop of anything else are nowhere near each other.
 */
async function print(path: string): Promise<number[]> {
  const { data, info } = await sharp(file(path))
    .flatten({ background: '#ffffff' })
    .resize(8, 8, { fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const out: number[] = [];
  for (let i = 0; i < 64; i++) {
    for (let c = 0; c < 3; c++) out.push(data[i * info.channels + c] as number);
  }
  return out;
}

interface Region {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** The same thumbprint, taken from a region of the source poster. */
async function printOfPoster(region: Region): Promise<number[]> {
  const { data, info } = await sharp(file(POSTER))
    .extract(region)
    .resize(8, 8, { fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const out: number[] = [];
  for (let i = 0; i < 64; i++) {
    for (let c = 0; c < 3; c++) out.push(data[i * info.channels + c] as number);
  }
  return out;
}

/** Mean RGB of every row of an image, top to bottom. */
async function rowProfile(path: string): Promise<number[][]> {
  const { data, info } = await sharp(file(path))
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const rows: number[][] = [];
  for (let y = 0; y < info.height; y++) {
    let r = 0;
    let g = 0;
    let b = 0;
    for (let x = 0; x < info.width; x++) {
      const i = (y * info.width + x) * info.channels;
      r += data[i] as number;
      g += data[i + 1] as number;
      b += data[i + 2] as number;
    }
    rows.push([r / info.width, g / info.width, b / info.width]);
  }
  return rows;
}

/** Mean absolute per-channel difference between two thumbprints, 0-255. */
function distance(a: number[], b: number[]): number {
  let total = 0;
  for (let i = 0; i < a.length; i++) total += Math.abs((a[i] as number) - (b[i] as number));
  return total / a.length;
}

describe('where the icon came from', () => {
  it('is a crop of the poster the game launches on', async () => {
    // The assertion the Capacitor logo would have failed for eight releases.
    const committed = await print(`${RES}/mipmap-xxxhdpi/ic_launcher.png`);
    expect(distance(committed, await printOfPoster(manifest.subject))).toBeLessThan(8);
  });

  it('is not a crop of some other part of it', async () => {
    /*
     * The counterweight. "Close to the poster" is nearly satisfied by any patch
     * of pale blue piste, and this whole file would then be passing on an icon
     * of empty snow. The title block is the same source image and the same
     * generator, and it must not match.
     */
    const committed = await print(`${RES}/mipmap-xxxhdpi/ic_launcher.png`);
    const elsewhere = await printOfPoster({ left: 200, top: 200, width: 600, height: 600 });
    expect(distance(committed, elsewhere)).toBeGreaterThan(20);
  });

  it('has something in it rather than being one flat colour', async () => {
    // The other way the tests above pass on nothing: a solid fill of the mean
    // colour is within a few levels of the crop it was averaged from.
    const values = await print(`${RES}/mipmap-xxxhdpi/ic_launcher.png`);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const spread = Math.sqrt(
      values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length,
    );
    expect(spread).toBeGreaterThan(25);
  });
});

describe('the adaptive layer', () => {
  it('shows the legacy icon in the part the mask cannot cut', async () => {
    /*
     * The load-bearing one, and the reason the generator crops twice. Whatever
     * a launcher masks the 108dp layer down to, it always keeps the middle
     * 72dp - so that middle has to hold the same picture the pre-adaptive icon
     * shows. Generate the layer from the visible crop and this fails by a mile,
     * which is exactly the bug that would otherwise ship as "the crown looks
     * cropped on some phones".
     */
    const layer = `${RES}/mipmap-xxxhdpi/ic_launcher_foreground.png`;
    const { width } = await sharp(file(layer)).metadata();
    const inner = Math.round((width as number) * SAFE_FRACTION);
    const offset = Math.round(((width as number) - inner) / 2);

    const { data, info } = await sharp(file(layer))
      .extract({ left: offset, top: offset, width: inner, height: inner })
      .resize(8, 8, { fit: 'fill' })
      .raw()
      .toBuffer({ resolveWithObject: true });

    const safeArea: number[] = [];
    for (let i = 0; i < 64; i++) {
      for (let c = 0; c < 3; c++) safeArea.push(data[i * info.channels + c] as number);
    }

    expect(distance(safeArea, await print(`${RES}/mipmap-xxxhdpi/ic_launcher.png`))).toBeLessThan(8);
  });

  it('sits on a colour sampled from itself, not on white', async () => {
    // The scaffold left this white. The foreground is opaque so it should never
    // show, but a launcher that composites the layers differently would flash.
    const xml = /<color name="ic_launcher_background">(#[0-9a-fA-F]{6})<\/color>/.exec(
      read(`${RES}/values/ic_launcher_background.xml`),
    );
    expect(xml?.[1]?.toLowerCase()).toBe(manifest.background);
    expect(manifest.background).not.toBe('#ffffff');
  });

  it('is declared with both layers', () => {
    const xml = read(`${RES}/mipmap-anydpi-v26/ic_launcher.xml`);
    expect(xml).toContain('@mipmap/ic_launcher_foreground');
    expect(xml).toContain('@color/ic_launcher_background');
  });
});

describe('every density bucket', () => {
  it('carries all three files at the exact size Android expects', async () => {
    // A missing bucket is not a crash: Android scales the nearest one it finds,
    // and the icon is merely soft on that class of device.
    for (const density of DENSITIES) {
      for (const [name, expected] of [
        ['ic_launcher.png', density.legacy],
        ['ic_launcher_round.png', density.legacy],
        ['ic_launcher_foreground.png', density.adaptive],
      ] as const) {
        const meta = await sharp(file(`${RES}/mipmap-${density.dir}/${name}`)).metadata();
        expect(`${density.dir}/${name} ${meta.width}x${meta.height}`).toBe(
          `${density.dir}/${name} ${expected}x${expected}`,
        );
      }
    }
  });
});

describe('the round icon', () => {
  it('is actually round, and not merely a square that says so', async () => {
    const path = file(`${RES}/mipmap-xxxhdpi/ic_launcher_round.png`);
    const { width } = await sharp(path).metadata();
    const px = width as number;

    const alphaAt = async (left: number, top: number) => {
      const { data, info } = await sharp(path)
        .ensureAlpha()
        .extract({ left, top, width: 1, height: 1 })
        .raw()
        .toBuffer({ resolveWithObject: true });
      return data[info.channels - 1] as number;
    };

    expect(await alphaAt(0, 0)).toBe(0);
    expect(await alphaAt(px - 1, px - 1)).toBe(0);
    // The counterweight: a fully transparent file satisfies the corners.
    expect(await alphaAt(px >> 1, px >> 1)).toBe(255);
  });
});

describe('the store artwork', () => {
  it('is exactly the sizes Play will accept', async () => {
    // Play rejects the upload outright on either of these, which is a slow way
    // to find out on submission day.
    const icon = await sharp(file('store/icon-512.png')).metadata();
    expect([icon.width, icon.height]).toEqual([512, 512]);

    const feature = await sharp(file('store/feature.png')).metadata();
    expect([feature.width, feature.height]).toEqual([1024, 500]);
  });

  it('is an unresampled full-width slice of the poster, taken across the title', async () => {
    /*
     * Where the slice is taken is a composition decision and was made by
     * looking, the same way the splash was. What is worth pinning is that it is
     * still a *slice*: the poster is 1024 wide and the banner is 1024 wide, so
     * the cut costs nothing in sharpness - and if anyone ever swaps in a
     * squashed or letterboxed version, the offset below stops matching.
     *
     * An earlier version of this test tried to prove the lettering was not cut
     * by looking for bright pixels on the edge rows. It found a star. Bright
     * things are everywhere in a night sky over snow, so the check was measuring
     * nothing - which is why this asks where the slice came from instead.
     */
    // A full-width slice is uniquely identified by the mean colour of each of
    // its rows, and comparing those is a thousand times cheaper than comparing
    // every candidate crop pixel by pixel.
    const banner = await rowProfile('store/feature.png');
    const poster = await rowProfile(POSTER);

    let bestTop = -1;
    let bestDistance = Infinity;
    for (let top = 0; top + banner.length <= poster.length; top++) {
      let total = 0;
      for (let y = 0; y < banner.length; y++) {
        for (let c = 0; c < 3; c++) {
          total += Math.abs((banner[y] as number[])[c]! - (poster[top + y] as number[])[c]!);
        }
      }
      const d = total / (banner.length * 3);
      if (d < bestDistance) [bestDistance, bestTop] = [d, top];
    }

    // Straight pixels, no scaling: the match is far tighter than the icons can
    // manage, since those are quantised and resized and this is neither.
    expect(bestDistance).toBeLessThan(2);

    // The title runs from roughly y=200 to y=610 in the poster. A slice that
    // does not span all of it has cut a word in half.
    expect(bestTop).toBeLessThanOrEqual(200);
    expect(bestTop + 500).toBeGreaterThanOrEqual(610);
  });
});
