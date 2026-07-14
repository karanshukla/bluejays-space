// @ts-check
import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import tailwindcss from '@tailwindcss/vite';

// SSR + standalone Node adapter so the built server (dist/server/entry.mjs)
// runs under a plain `node` process in the production Docker image.
export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  server: { host: true },
  vite: {
    plugins: [tailwindcss()],
  },
});
