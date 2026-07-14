import type { APIRoute } from 'astro';
import { publishHeadline } from '../../../../lib/db';

export const prerender = false;

export const POST: APIRoute = async ({ params, redirect }) => {
  const id = Number(params.id);
  if (!Number.isInteger(id)) {
    return new Response('Invalid id', { status: 400 });
  }
  await publishHeadline(id);
  return redirect('/admin');
};
