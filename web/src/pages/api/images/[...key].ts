import { Readable } from 'node:stream';
import type { APIRoute } from 'astro';
import { getImage } from '../../../lib/storage';

export const prerender = false;

export const GET: APIRoute = async ({ params }) => {
  const key = params.key;
  if (!key) return new Response('Not found', { status: 404 });

  const image = await getImage(key);
  if (!image) return new Response('Not found', { status: 404 });

  const stream =
    image.body instanceof Readable
      ? (Readable.toWeb(image.body) as ReadableStream)
      : (image.body as unknown as ReadableStream);

  return new Response(stream, {
    headers: {
      'Content-Type': image.contentType ?? 'application/octet-stream',
      // Safe to cache for a year: every upload gets a fresh timestamped key
      // (photoImport.ts keyForSlug), so a given key's bytes never change.
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    },
  });
};
