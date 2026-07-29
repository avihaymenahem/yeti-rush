/**
 * Builds the launcher icons and the store artwork from `assets/splash.png`.
 *
 *   npm run icon
 *
 * The app shipped its first eight releases wearing Ionic's Capacitor logo,
 * which is what `npx cap add android` leaves in the `mipmap` folders and which
 * nothing ever overwrote. That is someone else's trademark on the home screen, so this
 * generator exists mainly to make the icon a solved problem rather than a thing
 * to remember.
 *
 * Everything is cut from the poster for the same reason the splash is: one
 * source of truth for what the game looks like. Replace `assets/splash.png` and
 * re-run both scripts, and the launcher, the splash and the store listing move
 * together.
 *
 * ## Why the crop is the head
 *
 * The obvious crop is the whole rider, and it is wrong. A launcher icon is 48dp
 * - a little over a centimetre - and the full figure at that size is a pale
 * grey smudge on a pale blue smudge. The head, crown and red scarf carry the
 * only silhouette and the only strong hue in the character, so the icon is
 * those and nothing else.
 *
 * ## Why the adaptive foreground is wider than the crop
 *
 * An adaptive icon hands the launcher a 108dp layer and shows the middle 72dp
 * of it; the outer ring is what the mask eats when the device wants a circle, a
 * squircle or a teardrop. So the *visible* icon is `SUBJECT`, and the layer
 * handed over is the same square grown by 108/72 about the same centre - which
 * means the ring the mask cuts into is real poster instead of invented padding.
 *
 * The layer is opaque and full-bleed, so `@color/ic_launcher_background` is
 * never actually seen. It is still written to the sampled colour rather than
 * left white, because "never seen" holds only until a launcher does something
 * unusual with the two layers, and a white flash behind a night-blue icon is a
 * silly way to find that out.
 *
 * ## The formats are not a preference
 *
 * PNG, not the WebP the splash uses: `mipmap-*` is decoded by the framework at
 * install time and the store requires a 32-bit PNG. The store icon is a plain
 * square with square corners - Play applies its own rounding, and an icon that
 * arrives pre-rounded gets rounded twice.
 *
 * The legacy `ic_launcher.png` set cannot be dropped in favour of the adaptive
 * one. `minSdkVersion` is 24 and adaptive icons start at 26.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = resolve(root, 'assets/splash.png');
const MIPMAP = 'android/app/src/main/res';

/**
 * The square of the poster the icon shows, in source pixels.
 *
 * Centred on the yeti's head rather than on the figure. Chosen by generating
 * four crops and looking at them side by side, which is the only way to judge
 * one: the wider crops all put a coin from the centre lane through the top edge
 * as a large cut disc, and the looser ones shrank the head until the crown
 * spikes stopped reading as spikes. At 260px the coins are a small gold accent
 * above the crown instead of a severed shape, and the scarf still lands inside
 * the circular mask.
 */
const SUBJECT = { cx: 512, cy: 1175, size: 260 };

/**
 * How much bigger the handed-over adaptive layer is than the visible icon.
 *
 * Fixed by the platform, not chosen: the layer is 108dp and the guaranteed-safe
 * area inside it is 72dp.
 */
const ADAPTIVE_BLEED = 108 / 72;

/** Legacy square/round px, then adaptive layer px, per density bucket. */
const DENSITIES = [
  { dir: 'mdpi', legacy: 48, adaptive: 108 },
  { dir: 'hdpi', legacy: 72, adaptive: 162 },
  { dir: 'xhdpi', legacy: 96, adaptive: 216 },
  { dir: 'xxhdpi', legacy: 144, adaptive: 324 },
  { dir: 'xxxhdpi', legacy: 192, adaptive: 432 },
];

/**
 * The Play listing banner.
 *
 * 1024x500 is the required size, and the poster happens to be 1024 wide - so
 * this is a straight cut with no resampling at all. `top` puts the crop just
 * above "YETI" and lands just below "RUSH", which is the one region of the art
 * that is already composed as a wide lockup.
 */
const FEATURE = { width: 1024, height: 500, top: 155 };

function hex([r, g, b]) {
  return `#${[r, g, b].map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;
}

/** A centred square of the source, clamped to stay inside it. */
function square(cx, cy, size, bounds) {
  const side = Math.min(size, bounds.width, bounds.height);
  const left = Math.round(Math.min(Math.max(cx - side / 2, 0), bounds.width - side));
  const top = Math.round(Math.min(Math.max(cy - side / 2, 0), bounds.height - side));
  return { left, top, width: Math.round(side), height: Math.round(side) };
}

/** Mean colour of a buffer - the fallback the adaptive background is set to. */
async function meanColour(image) {
  const { data, info } = await sharp(image).raw().toBuffer({ resolveWithObject: true });
  const sum = [0, 0, 0];
  const pixels = info.width * info.height;
  for (let i = 0; i < pixels; i++) {
    for (let c = 0; c < 3; c++) sum[c] += data[i * info.channels + c];
  }
  return sum.map((total) => total / pixels);
}

/**
 * Writes a PNG, making the directory first, and reports what it cost.
 *
 * `palette` quantises to 256 colours. That is on for everything in `mipmap`,
 * where fifteen full-colour PNGs of a shaded render came to 1 MB against a 6 MB
 * app - and the icon is a white yeti on blue snow, so 256 colours is more than
 * the art actually contains. It stays off for the store artwork, which is never
 * downloaded by a player and is the version people zoom into.
 */
async function emit(pipeline, path, { palette = false, note = '' } = {}) {
  const out = resolve(root, path);
  await mkdir(dirname(out), { recursive: true });
  await pipeline.png({ compressionLevel: 9, palette, quality: 100, effort: 10 }).toFile(out);
  const bytes = (await readFile(out)).length;
  console.log(`${path}  ${(bytes / 1024).toFixed(0)} KB${note ? `  (${note})` : ''}`);
}

/** Circular cut of a square buffer, for the pre-adaptive round icon. */
function circleMask(px) {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}">
       <circle cx="${px / 2}" cy="${px / 2}" r="${px / 2}" fill="#fff"/>
     </svg>`,
  );
}

async function build() {
  const source = await readFile(SOURCE);
  const bounds = await sharp(source).metadata();

  const visible = square(SUBJECT.cx, SUBJECT.cy, SUBJECT.size, bounds);
  const layer = square(SUBJECT.cx, SUBJECT.cy, SUBJECT.size * ADAPTIVE_BLEED, bounds);
  // The bleed only works if there was room for it. Silently clamping to the
  // visible crop would put the mask straight through the yeti's ears.
  if (layer.width < Math.round(SUBJECT.size * ADAPTIVE_BLEED)) {
    throw new Error(`no room for the adaptive bleed around (${SUBJECT.cx},${SUBJECT.cy})`);
  }

  const visibleArt = await sharp(source).extract(visible).toBuffer();
  const layerArt = await sharp(source).extract(layer).toBuffer();

  const background = await meanColour(layerArt);
  console.log(
    `subject ${visible.width}px at (${visible.left},${visible.top})  ` +
      `layer ${layer.width}px  background ${hex(background)}`,
  );

  for (const density of DENSITIES) {
    const dir = `${MIPMAP}/mipmap-${density.dir}`;

    await emit(sharp(visibleArt).resize(density.legacy, density.legacy), `${dir}/ic_launcher.png`, {
      palette: true,
    });

    await emit(
      sharp(visibleArt)
        .resize(density.legacy, density.legacy)
        .ensureAlpha()
        .composite([{ input: circleMask(density.legacy), blend: 'dest-in' }]),
      `${dir}/ic_launcher_round.png`,
      { palette: true },
    );

    await emit(
      sharp(layerArt).resize(density.adaptive, density.adaptive),
      `${dir}/ic_launcher_foreground.png`,
      { palette: true },
    );
  }

  // The store listing. Not shipped in the APK, and not in `public/` either -
  // uploading it is a manual step in the Play Console, so it lives with the
  // rest of the listing copy.
  await emit(sharp(visibleArt).resize(512, 512), 'store/icon-512.png', {
    note: 'Play listing icon',
  });
  await emit(sharp(source).extract({ left: 0, top: FEATURE.top, ...FEATURE }), 'store/feature.png', {
    note: `${FEATURE.width}x${FEATURE.height}, uncropped title`,
  });

  // The web demo had no icon at all, so the browser tab fell back to a blank
  // page glyph. Same art, so the tab and the home screen agree.
  await emit(sharp(visibleArt).resize(192, 192), 'public/icon.png', {
    palette: true,
    note: 'favicon',
  });

  // Read by `tests/icon.test.ts`, which is the only thing that can catch the
  // adaptive background drifting away from the art it sits behind.
  await writeFile(
    resolve(root, 'assets/icon.json'),
    `${JSON.stringify({ background: hex(background), subject: visible }, null, 2)}\n`,
  );
}

await build();
