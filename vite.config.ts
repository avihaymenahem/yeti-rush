import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  /**
   * Where the bundle believes it is served from.
   *
   * Root by default, which is what Capacitor needs - the Android WebView loads
   * the copied bundle from the top of its own asset server, and a hardcoded
   * project path would break every asset URL in the app. GitHub Pages serves
   * from a repository subpath instead, so the Pages workflow sets `PAGES_BASE`
   * and nothing else has to know.
   */
  base: process.env.PAGES_BASE ?? '/',
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  // GLB/GLTF must be emitted as files, never inlined as base64.
  assetsInclude: ['**/*.glb', '**/*.gltf', '**/*.hdr'],
  server: {
    host: true, // needed for LAN phone testing: `npm run dev:host`
    port: 5173,
  },
  build: {
    target: 'es2022',
    // Capacitor serves from the filesystem, so relative asset URLs are required.
    assetsDir: 'assets',
    sourcemap: true,
    // three.js is most of the bundle and changes only when we upgrade it, so
    // splitting it out means a gameplay patch does not invalidate it.
    rollupOptions: {
      output: {
        // Rolldown (Vite 8) requires the function form here, not a map.
        manualChunks(id: string) {
          // Windows ids come through with backslashes.
          const path = id.replace(/\\/g, '/');
          if (path.includes('/node_modules/three/')) return 'three';
          if (
            path.includes('/node_modules/react/') ||
            path.includes('/node_modules/react-dom/') ||
            path.includes('/node_modules/scheduler/')
          ) {
            return 'react';
          }
          return undefined;
        },
      },
    },
    // The three.js chunk is legitimately large; warn on anything else growing.
    chunkSizeWarningLimit: 900,
  },
  test: {
    // Every test in this project is pure logic - no DOM, no WebGL.
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
