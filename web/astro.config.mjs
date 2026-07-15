// @ts-check
import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import svelte from '@astrojs/svelte';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  integrations: [svelte()],
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
