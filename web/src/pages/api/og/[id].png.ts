import type { APIRoute } from 'astro';
import { getHeadlineById } from '../../../lib/db';
import { getImage, uploadImage } from '../../../lib/storage';
import { ogCacheKey, renderOgPng } from '../../../lib/ogImage';

export const prerender = false;

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
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  }

  try {
    const png = await getOrRender(key, () => renderOgPng(headline));
    return new Response(new Uint8Array(png), {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  } catch (err) {
    console.error(`[og] render failed for headline ${id}:`, err);
    return new Response(null, {
      status: 302,
      headers: { Location: '/og-default.png' },
    });
  }
};
