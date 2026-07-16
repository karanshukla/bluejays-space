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
      'Cache-Control': 'public, max-age=86400',
      'X-Content-Type-Options': 'nosniff',
    },
  });
};
