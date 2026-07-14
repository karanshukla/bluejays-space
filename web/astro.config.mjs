// @ts-check
import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import svelte from '@astrojs/svelte';
import tailwindcss from '@tailwindcss/vite';

// SSR + standalone Node adapter so the built server (dist/server/entry.mjs)
// runs under a plain `node` process in the production Docker image.
export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  // The admin inline-edit island is the one place that ships client-side JS —
  // public pages stay islands-free (zero/minimal JS) per the spec.
  integrations: [svelte()],
  server: { host: true },
  vite: {
    plugins: [tailwindcss()],
  },
});
