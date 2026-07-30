/**
 * Retiring the GLB texture request that can never succeed.
 *
 * All fourteen Holiday Kit GLBs carry `Textures/colormap.png` as a relative
 * image URI - the shape of the kit as it was downloaded, with the atlas in a
 * sibling folder. Nothing serves that path here and nothing ever will: the
 * models sit in `src/assets/models/` with the atlas beside them rather than
 * under `Textures/`, and a build flattens every asset to
 * `assets/<name>-<hash>.png`. There is no `Textures/` directory in either tree,
 * so the loader asks for a file that does not exist and logs a
 * `GLTFLoader: Couldn't load texture` for every textured model it touches.
 *
 * The error is noise rather than a fault - `useModel` assigns the atlas it
 * imported through the bundler over the top, which is exactly why it does so
 * explicitly - but console noise is not free. It is a screenful of red a reader
 * has to learn to scroll past, and the habit of scrolling past it is what hides
 * the next one.
 *
 * The reference lives inside a binary asset, so the repair has to happen at the
 * loader. Two ways to do that, and the cheaper one is not the obvious one:
 *
 *  - **Point the path at the real atlas.** Reads as the honest fix, and buys
 *    four copies of the same image: three's `Cache` is off by default, so each
 *    textured GLB fetches, decodes and uploads its own atlas - which `prepare`
 *    then discards along with the rest of the imported material.
 *  - **Point it at a 1x1 stub.** The request never leaves the page, and the
 *    texture that gets discarded is 68 bytes rather than 12 KB.
 *
 * The stub wins only because the loaded material is thrown away either way. If
 * that ever stops being true - if anything renders with the material the loader
 * built rather than the one `prepare` makes - this becomes the wrong trade and
 * the redirect is the right one.
 */

import * as THREE from 'three';

/**
 * A valid 1x1 RGBA PNG, inline so that resolving to it costs no request.
 *
 * `tests/models.test.ts` decodes this rather than trusting it: a base64 typo
 * would fail the same way the broken path does, and would look identical in the
 * console.
 */
export const ATLAS_STUB_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+A8AAQUBASfYRQoAAAAASUVORK5CYII=';

/**
 * Whether a URL is the kit's unresolvable atlas reference.
 *
 * Anchored on the `Textures/` segment on purpose. The bundled atlas arrives as
 * `colormap-<hash>.png` and never carries that segment, so this cannot swallow
 * the real one - which would not throw, it would quietly texture every imported
 * model with a single transparent pixel.
 */
export function isKitAtlasReference(url: string): boolean {
  return /(?:^|\/)Textures\/colormap\.png(?:[?#].*)?$/.test(url);
}

/**
 * Installs the redirect on the manager three's loaders default to.
 *
 * Safe to call from module scope and safe to call twice: `setURLModifier` holds
 * one slot, so a second call replaces the modifier rather than chaining onto it.
 * Nothing else in the app sets one, and nothing reads this manager for load
 * progress - the splash bar is driven by its own milestones.
 */
export function stubKitAtlasRequests(): void {
  THREE.DefaultLoadingManager.setURLModifier((url) =>
    isKitAtlasReference(url) ? ATLAS_STUB_URL : url,
  );
}
