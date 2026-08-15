import type { APIRoute } from 'astro';
import { importPhotoFromForm } from '../../lib/photoIntake';
import { clientIp } from '../../lib/clientIp';
import { PublicRouteLimiter } from '../../lib/rateLimit';

export const prerender = false;

// Public, unauthenticated photo intake for /submit, reusing the same
// validated import path (content-type/size/SSRF checks) as the admin photo
// picker. Separate rate-limit budget from api/submit.ts's text limiter, so
// someone picking a photo before finishing the rest of the form doesn't burn
// through their allowance for the final submit. The route-wide ceiling is set
// well above real traffic and sized for the fact that every allowed request
// here costs an outbound fetch, an image re-encode and a MinIO write.
const limiter = new PublicRouteLimiter(10, 100, 60 * 60 * 1000);

export const POST: APIRoute = async ({ request }) => {
  if (!limiter.allow(clientIp(request))) {
    return new Response('Too many photo uploads, try again later', { status: 429 });
  }

  const form = await request.formData();
  try {
    const key = await importPhotoFromForm(form);
    return Response.json({ key });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'failed to import photo';
    return new Response(message, { status: 400 });
  }
};
