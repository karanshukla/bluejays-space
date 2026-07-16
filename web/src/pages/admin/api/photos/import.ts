import type { APIRoute } from 'astro';
import { importPhotoFromForm } from '../../../../lib/photoIntake';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const form = await request.formData();
  try {
    const key = await importPhotoFromForm(form);
    return Response.json({ key });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'failed to import photo';
    return new Response(message, { status: 400 });
  }
};
