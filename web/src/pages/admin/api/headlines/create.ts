import type { APIRoute } from 'astro';
import { createHeadline } from '../../../../lib/db';
import { asNullableText } from '../../../../lib/formHelpers';
import { resolvePhotoRef } from '../../../../lib/photoImport';

export const prerender = false;

export const POST: APIRoute = async ({ request, redirect }) => {
  const form = await request.formData();
  const headline = asNullableText(form.get('headline'));
  if (!headline) {
    return new Response('Missing required fields', { status: 400 });
  }
  // Optional: register is a leftover generation-style tag (real-event riff vs.
  // fabricated scenario), not a field an admin (or a public submitter) needs
  // to set to author a headline. Left blank on the form, it stays null.
  const registerNum = Number(form.get('register'));
  const register = registerNum === 1 || registerNum === 2 ? (registerNum as 1 | 2) : null;

  let photoRef: string | null;
  try {
    photoRef = await resolvePhotoRef(asNullableText(form.get('photo_ref')));
  } catch (err) {
    // 400, not 52x: Cloudflare replaces well-known gateway codes with its own
    // branded page, hiding this client-input message from the browser.
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
