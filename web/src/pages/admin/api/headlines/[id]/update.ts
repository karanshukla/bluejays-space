import type { APIRoute } from 'astro';
import { updateHeadline } from '../../../../../lib/db';
import { asNullableText } from '../../../../../lib/formHelpers';
import { resolvePhotoRef } from '../../../../../lib/photoImport';

export const prerender = false;

// Only ever called via DraftCard.svelte's fetch (no plain-form fallback), so
// this responds with JSON rather than redirecting — the client needs
// photo_ref back when a submitted URL got downloaded and resolved to a
// stored MinIO key, so its local state matches what was actually saved.
export const POST: APIRoute = async ({ params, request }) => {
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

  let photoRef: string | null;
  try {
    photoRef = await resolvePhotoRef(asNullableText(form.get('photo_ref')));
  } catch (err) {
    // 400, not 502/504/52x — see create.ts for why: Cloudflare replaces those
    // "well-known" gateway codes with its own branded error page regardless
    // of what the app actually sent, hiding this message from the admin.
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
