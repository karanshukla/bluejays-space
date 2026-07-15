import type { APIRoute } from 'astro';
import { unpublishHeadline } from '../../../../../lib/db';

export const prerender = false;

export const POST: APIRoute = async ({ params, redirect }) => {
  const id = Number(params.id);
  if (!Number.isInteger(id)) return new Response('Invalid id', { status: 400 });
  await unpublishHeadline(id);
  return redirect('/admin');
};
