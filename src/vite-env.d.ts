/// <reference types="vite/client" />

/**
 * The version from package.json, substituted at build time by `vite.config.ts`.
 *
 * Shown in the credits so a bug report from a store player says which build it
 * came from. Once the app is public, "it crashes on the ramp" is only actionable
 * alongside a version number, and the player cannot be expected to find one that
 * is not on screen.
 */
declare const __APP_VERSION__: string;

// Vite resolves these to an emitted asset URL; `vite/client` does not cover
// GLB/GLTF out of the box.
declare module '*.glb' {
  const src: string;
  export default src;
}

declare module '*.gltf' {
  const src: string;
  export default src;
}
