import type { APIRoute } from 'astro';
import { createHeadline } from '../../../../lib/db';
import { asNullableText } from '../../../../lib/formHelpers';
import { resolvePhotoRef } from '../../../../lib/photoImport';

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

  let photoRef: string | null;
  try {
    photoRef = await resolvePhotoRef(asNullableText(form.get('photo_ref')));
  } catch (err) {
    // 400, not 502/504/52x: Cloudflare intercepts those "well-known" gateway
    // codes and replaces the whole response with its own generic branded
    // error page, hiding this message entirely — even though the app
    // responded fine, the browser would show the same page as a real
    // upstream outage. This is a client input problem (bad/unfetchable
    // photo URL), not a gateway failure, so it needs a code Cloudflare
    // passes through untouched.
    const message = err instanceof Error ? err.message : 'failed to import photo';
    return new Response(`Photo ref: ${message}`, { status: 400 });
  }

  await createHeadline({
    headline,
    register,
    stat_block: asNullableText(form.get('stat_block')),
    photo_ref: photoRef,
    source_post_url: asNullableText(form.get('source_post_url')),
    source_note: asNullableText(form.get('source_note')),
  });

  return redirect('/admin');
};
