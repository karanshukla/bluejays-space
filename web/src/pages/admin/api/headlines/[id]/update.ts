import type { APIRoute } from 'astro';
import { updateHeadline } from '../../../../../lib/db';
import { asNullableText } from '../../../../../lib/formHelpers';

export const prerender = false;

export const POST: APIRoute = async ({ params, request, redirect }) => {
  const id = Number(params.id);
  if (!Number.isInteger(id)) {
    return new Response('Invalid id', { status: 400 });
  }

  const form = await request.formData();
  const headline = asNullableText(form.get('headline'));
  const register = Number(form.get('register'));
  if (!headline || (register !== 1 && register !== 2)) {
    return new Response('Missing required fields', { status: 400 });
  }

  await updateHeadline(id, {
    headline,
    register,
    stat_block: asNullableText(form.get('stat_block')),
    photo_ref: asNullableText(form.get('photo_ref')),
    source_post_url: asNullableText(form.get('source_post_url')),
    source_note: asNullableText(form.get('source_note')),
  });

  return redirect('/admin');
};
