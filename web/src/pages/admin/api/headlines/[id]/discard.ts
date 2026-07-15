import type { APIRoute } from 'astro';
import { discardHeadline } from '../../../../../lib/db';

export const prerender = false;

export const POST: APIRoute = async ({ params, redirect }) => {
  const id = Number(params.id);
  if (!Number.isInteger(id)) {
    return new Response('Invalid id', { status: 400 });
  }
  await discardHeadline(id);
  return redirect('/admin');
};
