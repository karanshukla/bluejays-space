import type { APIRoute } from 'astro';
import { getImage } from '../../../lib/storage';

export const prerender = false;

export const GET: APIRoute = async ({ params }) => {
  const key = params.key;
  if (!key) return new Response('Not found', { status: 404 });

  const image = await getImage(key);
  if (!image) return new Response('Not found', { status: 404 });

  const chunks: Buffer[] = [];
  for await (const chunk of image.body) {
    chunks.push(chunk as Buffer);
  }

  return new Response(Buffer.concat(chunks), {
    headers: {
      'Content-Type': image.contentType ?? 'application/octet-stream',
      // Safe to cache for a year: every upload gets a fresh timestamped key
      // (photoImport.ts keyForSlug), so a given key's bytes never change.
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    },
  });
};
