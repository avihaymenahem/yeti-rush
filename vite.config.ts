import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Read rather than imported: a JSON import here would be pulled into the config
// bundle differently across Node versions, and this only needs one field.
const { version } = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as { version: string };

export default defineConfig({
  // Substituted into the credits screen. `android/app/build.gradle` carries the
  // same number by hand, and `tests/release.test.ts` fails if they disagree.
  define: { __APP_VERSION__: JSON.stringify(version) },
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
    /*
     * `PORT` first, 5173 only as the fallback. Vite does not read `PORT` itself,
     * so a bare `port: 5173` is a hardcoded port however the server is launched
     * - and it fails in the least obvious way. Nothing errors: `strictPort` is
     * off, so a clash makes Vite quietly serve on 5174 instead, and any tool
     * that assigned a free port and then probed it finds nothing there.
     *
     * The game itself has no opinion about the port. It makes no network
     * requests at all - `tests/release.test.ts` fails on a `fetch` appearing
     * anywhere in `src/` - so there is no callback URL or allowed origin pinned
     * to a number here.
     */
    port: Number(process.env.PORT) || 5173,
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
