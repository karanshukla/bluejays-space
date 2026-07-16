import type { APIRoute } from 'astro';
import { getHeadlineById } from '../../../lib/db';
import { getImage, uploadImage } from '../../../lib/storage';
import { ogCacheKey, renderOgPng } from '../../../lib/ogImage';

export const prerender = false;

// Deduplicates near-simultaneous renders for the same headline revision so two
// crawler hits don't race two full Satori+resvg passes. Process-local — a
// second server instance would miss it, but that's a redundant-render, not a
// correctness problem.
const inFlight = new Map<string, Promise<Buffer>>();

async function getOrRender(key: string, render: () => Promise<Buffer>): Promise<Buffer> {
  const existing = inFlight.get(key);
  if (existing) return existing;

  const promise = (async () => {
    const png = await render();
    await uploadImage(key, png, 'image/png');
    return png;
  })();

  inFlight.set(key, promise);
  try {
    return await promise;
  } finally {
    inFlight.delete(key);
  }
}

export const GET: APIRoute = async ({ params }) => {
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return new Response('Not Found', { status: 404 });
  }

  const headline = await getHeadlineById(id);
  if (!headline) {
    return new Response('Not Found', { status: 404 });
  }

  const key = ogCacheKey(headline);

  // Serve from cache if a previous render already stored it.
  const cached = await getImage(key);
  if (cached) {
    const chunks: Buffer[] = [];
    for await (const chunk of cached.body) chunks.push(chunk as Buffer);
    return new Response(Buffer.concat(chunks), {
      headers: {
        'Content-Type': 'image/png',
        // Safe to cache for a year: ogCacheKey hashes the content that affects
        // the render (headline/stat_block/photo_ref), so a given key's bytes
        // never change — an edit produces a new key instead.
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  }

  try {
    const png = await getOrRender(key, () => renderOgPng(headline));
    return new Response(new Uint8Array(png), {
      headers: {
        'Content-Type': 'image/png',
        // Safe to cache for a year: ogCacheKey hashes the content that affects
        // the render (headline/stat_block/photo_ref), so a given key's bytes
        // never change — an edit produces a new key instead.
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  } catch (err) {
    // A render failure should never break a crawler's unfurl — fall back to the
    // static default so the link still has a preview image.
    console.error(`[og] render failed for headline ${id}:`, err);
    return new Response(null, {
      status: 302,
      headers: { Location: '/og-default.png' },
    });
  }
};
