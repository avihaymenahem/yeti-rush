/**
 * Builds the launch splash assets from the poster art in `assets/splash.png`.
 *
 *   npm run splash
 *
 * The poster is 2:3. Every phone this ships to is taller than that - 19.5:9 and
 * 20:9 are the norm - and the splash is drawn CENTER_CROP, so handing the art
 * over as-is would scale it to fill the height and slice roughly a third of the
 * width away. That third is the outer half of "YETI", the outer half of "RUSH"
 * and both lines of pines. The title is the one thing a splash exists to show.
 *
 * So the art is not resized to the screen; it is *composed onto* a 1:2 canvas
 * that a phone can crop harmlessly. The poster keeps its full width and sits at
 * the bottom, and the extra height is invented above it as more sky.
 *
 * That works because the top edge of the art is near-uniform night blue (the
 * whole row spans about ten levels per channel), so a gradient continuing it
 * upward has no seam. The bottom edge is not uniform - the board tail and the
 * snow spray are much darker than the piste around them - so the small bottom
 * margin is mirrored rather than filled, which is seamless by construction.
 *
 * Output is WebP, not PNG. This is a rendered poster with wide gradients: as a
 * PNG the phone-sized version is about 2.5 MB, which is a third of the APK for
 * an image shown for two seconds. WebP at quality 82 is under a tenth of that
 * and the banding is invisible at arm's length.
 *
 * One `drawable-nodpi` asset rather than the five density buckets Capacitor
 * generates. The splash is drawn into a full-screen ImageView that rescales it
 * anyway, so the buckets only ever chose how much detail to throw away. `nodpi`
 * is load-bearing, not tidiness: in a plain `drawable/` folder Android treats
 * the file as mdpi and pre-scales it by the device density, so a 3x phone would
 * decode this into a 3600x7200 bitmap before drawing it smaller.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = resolve(root, 'assets/splash.png');

/**
 * Canvas shape, as height / width.
 *
 * Sits between the tall phones (20:9 is 2.22) and the short ones (16:9 is 1.78)
 * so neither is cropped badly: about a tenth of the width goes on the tallest,
 * about a tenth of the height on the shortest. Pushing it taller would protect
 * the 20:9 majority at the cost of cropping the yeti off the bottom on a 16:9.
 */
const ASPECT = 2;

/**
 * Share of the invented height placed *below* the poster rather than above.
 *
 * Deliberately a sliver. A phone taller than this canvas keeps the full height
 * and crops the sides, so whatever goes below the art is *shown*, not spare
 * margin - and a mirrored snowboard nose is very obviously a mirrored snowboard
 * nose. At a few dozen pixels it is a band of snow and nothing else. It earns
 * its place on the shorter phones, where the vertical crop eats this instead of
 * the board.
 */
const BOTTOM_SHARE = 0.06;

/** Rows averaged to find the colour the invented sky has to meet. */
const SEAM_ROWS = 6;

/** How much darker the invented zenith is than the seam. Real sky does this. */
const ZENITH_SCALE = 0.62;

const TARGETS = [
  // The phone. 1200 wide covers a 1440px xxxhdpi panel after CENTER_CROP takes
  // its tenth, and the art is soft-edged low-poly rendering with nothing fine
  // enough to want more.
  { path: 'android/app/src/main/res/drawable-nodpi/splash.webp', width: 1200, quality: 82 },
  // The web boot screen, which has to arrive before the bundle to be worth
  // having, so it is deliberately the cheaper of the two.
  { path: 'public/splash.webp', width: 900, quality: 80 },
];

function hex([r, g, b]) {
  return `#${[r, g, b].map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;
}

/** Mean colour of the top `rows` rows - the colour the invented sky must meet. */
async function seamColour(image) {
  const { width } = await sharp(image).metadata();
  const { data, info } = await sharp(image)
    .extract({ left: 0, top: 0, width, height: SEAM_ROWS })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const sum = [0, 0, 0];
  const pixels = info.width * info.height;
  for (let i = 0; i < pixels; i++) {
    for (let c = 0; c < 3; c++) sum[c] += data[i * info.channels + c];
  }
  return sum.map((total) => total / pixels);
}

async function build() {
  const source = await readFile(SOURCE);
  const { width: srcWidth, height: srcHeight } = await sharp(source).metadata();

  const seam = await seamColour(source);
  const zenith = seam.map((c) => c * ZENITH_SCALE);
  console.log(`seam ${hex(seam)}  zenith ${hex(zenith)}  (source ${srcWidth}x${srcHeight})`);

  for (const target of TARGETS) {
    const width = target.width;
    const artHeight = Math.round((width * srcHeight) / srcWidth);
    const height = Math.round(width * ASPECT);
    const fill = height - artHeight;
    // Nothing here degrades gracefully into a shorter canvas: the composition
    // would silently start cropping the poster instead of extending it, which
    // is the exact failure this script exists to prevent.
    if (fill <= 0) throw new Error(`canvas ${width}x${height} leaves no room to extend the art`);

    const bottom = Math.round(fill * BOTTOM_SHARE);
    const top = fill - bottom;

    // Mirror first, so the bottom margin is a reflection of the snow rather than
    // a flat colour meeting an uneven edge.
    const art = await sharp(source)
      .resize({ width })
      .extend({ bottom, extendWith: 'mirror' })
      .toBuffer();

    // The invented sky, as a gradient that arrives at the seam colour exactly.
    const sky = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${top}">
         <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
           <stop offset="0" stop-color="${hex(zenith)}"/>
           <stop offset="1" stop-color="${hex(seam)}"/>
         </linearGradient>
         <rect width="100%" height="100%" fill="url(#g)"/>
       </svg>`,
    );

    const out = resolve(root, target.path);
    await mkdir(dirname(out), { recursive: true });
    await sharp({
      create: { width, height, channels: 3, background: hex(seam) },
    })
      .composite([
        { input: sky, top: 0, left: 0 },
        { input: art, top, left: 0 },
      ])
      .webp({ quality: target.quality, effort: 6 })
      .toFile(out);

    const bytes = (await readFile(out)).length;
    console.log(
      `${relative(root, out).replace(/\\/g, '/')}  ${width}x${height}  ` +
        `${(bytes / 1024).toFixed(0)} KB  (sky ${top}px, mirror ${bottom}px)`,
    );
  }

  // Written out so the shell colours can be checked against the art rather than
  // trusted to a comment. `tests/splash.test.ts` reads it.
  await writeFile(
    resolve(root, 'assets/splash.json'),
    `${JSON.stringify({ seam: hex(seam), zenith: hex(zenith) }, null, 2)}\n`,
  );
}

await build();
