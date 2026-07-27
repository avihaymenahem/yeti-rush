/// <reference types="vite/client" />

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
