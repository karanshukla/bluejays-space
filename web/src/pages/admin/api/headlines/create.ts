import type { APIRoute } from 'astro';
import { createHeadline } from '../../../../lib/db';
import { asNullableText } from '../../../../lib/formHelpers';

export const prerender = false;

// Inserts a hand-written draft, bypassing the ingest generation pipeline —
// for a headline written directly rather than waiting on the next cron run.
// Lands as an ordinary draft row; goes through the same review/publish flow.
export const POST: APIRoute = async ({ request, redirect }) => {
  const form = await request.formData();
  const headline = asNullableText(form.get('headline'));
  const register = Number(form.get('register'));
  if (!headline || (register !== 1 && register !== 2)) {
    return new Response('Missing required fields', { status: 400 });
  }

  await createHeadline({
    headline,
    register,
    stat_block: asNullableText(form.get('stat_block')),
    photo_ref: asNullableText(form.get('photo_ref')),
    source_post_url: asNullableText(form.get('source_post_url')),
    source_note: asNullableText(form.get('source_note')),
  });

  return redirect('/admin');
};
