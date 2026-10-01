// @ts-check
import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import svelte from '@astrojs/svelte';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  output: 'server',
  // The adapter's default is 1 GB, which every public POST would otherwise
  // buffer before a route sees it. The largest legitimate body is one photo
  // upload (MAX_BYTES in src/lib/photoImport.ts) plus multipart overhead.
  adapter: node({ mode: 'standalone', bodySizeLimit: 16 * 1024 * 1024 }),
  integrations: [svelte()],
  site: process.env.SITE_URL,
  server: { host: true },
  security: {
    // Disabled because @astrojs/node's standalone adapter derives the request
    // URL scheme from the TCP socket, not X-Forwarded-Proto — and Railway
    // terminates TLS at its edge, so every request looks like http:// here
    // while the browser's Origin is https://. The actual /admin auth boundary
    // is the Cloudflare Access JWT check in src/middleware.ts.
    checkOrigin: false,
  },
  vite: {
    plugins: [tailwindcss()],
  },
});
