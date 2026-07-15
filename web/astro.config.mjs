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
  security: {
    // Astro's default same-origin check compares the request's Origin header
    // against a URL it builds from the raw request — and @astrojs/node's
    // standalone adapter derives that URL's scheme purely from the TCP
    // socket's TLS state (see createRequestFromNodeRequest in
    // @astrojs/node/dist/../astro/dist/core/app/node.js), not from
    // X-Forwarded-Proto. Railway terminates TLS at its edge and forwards
    // plain HTTP to this container, so every request looks like
    // http://bluejays.space here while the browser's real Origin is
    // https://bluejays.space — an always-on false positive that blocked
    // every admin POST (save/publish) with a 403. The actual auth boundary
    // for /admin is the Cloudflare Access JWT check in src/middleware.ts,
    // not this heuristic, so disabling it is safe.
    checkOrigin: false,
  },
  vite: {
    plugins: [tailwindcss()],
  },
});
