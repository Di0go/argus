import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { organon } from '@organon/core/vite';

// The interface is in ui/ and builds to dist/ui. In dev, Vite serves it on 5203 and passes /api and /mcp to the dev
// server on 4940 (the core's plugin reads both from app.json).
export default defineConfig({
  root: 'ui',
  plugins: [svelte(), organon({ root: import.meta.dirname })],
  build: { outDir: '../dist/ui', emptyOutDir: true },
});
