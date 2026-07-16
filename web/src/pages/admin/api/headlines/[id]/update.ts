import type { APIRoute } from 'astro';
import { updateHeadline } from '../../../../../lib/db';
import { asNullableText } from '../../../../../lib/formHelpers';
import { resolvePhotoRef } from '../../../../../lib/photoImport';

export const prerender = false;

export const POST: APIRoute = async ({ params, request }) => {
  const id = Number(params.id);
  if (!Number.isInteger(id)) return new Response('Invalid id', { status: 400 });

  const form = await request.formData();
  const headline = asNullableText(form.get('headline'));
  if (!headline) {
    return new Response('Missing required fields', { status: 400 });
  }
  // Optional, see create.ts. Left blank (e.g. a submitted draft that never
  // had one), it stays null rather than blocking the save.
  const registerNum = Number(form.get('register'));
  const register = registerNum === 1 || registerNum === 2 ? (registerNum as 1 | 2) : null;

  let photoRef: string | null;
  try {
    photoRef = await resolvePhotoRef(asNullableText(form.get('photo_ref')));
  } catch (err) {
    // 400, not 52x — see create.ts: Cloudflare replaces those with its own page.
    const message = err instanceof Error ? err.message : 'failed to import photo';
    return new Response(`Photo ref: ${message}`, { status: 400 });
  }

  await updateHeadline(id, {
    headline,
    register,
    stat_block: asNullableText(form.get('stat_block')),
    photo_ref: photoRef,
    source_post_url: asNullableText(form.get('source_post_url')),
    source_note: asNullableText(form.get('source_note')),
  });

  return Response.json({ photo_ref: photoRef });
};
