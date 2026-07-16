import type { APIRoute } from 'astro';
import { storeImageBytes, isAllowedImageType, MAX_BYTES } from '../../../../lib/photoImport';
import { asNullableText } from '../../../../lib/formHelpers';
import { safeFetch } from '../../../../lib/urlSafety';

export const prerender = false;

async function importFromUrl(url: string): Promise<string> {
  let res: Response;
  try {
    res = await safeFetch(url);
  } catch (err) {
    if (err instanceof Error && err.message.includes('private address')) throw err;
    throw new Error('could not reach that URL');
  }
  if (!res.ok) throw new Error(`could not fetch that URL (HTTP ${res.status})`);
  const contentType = res.headers.get('content-type') || '';
  if (!isAllowedImageType(contentType)) {
    throw new Error(`URL did not return a supported image type (got ${contentType || 'unknown'})`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength > MAX_BYTES) throw new Error('image is too large');
  const slug = url.split('/').pop() ?? '';
  return storeImageBytes(buf, contentType, slug);
}

async function importFromFile(file: File): Promise<string> {
  if (!isAllowedImageType(file.type)) {
    throw new Error(`unsupported image type (got ${file.type || 'unknown'})`);
  }
  if (file.size > MAX_BYTES) throw new Error('image is too large');
  const buf = Buffer.from(await file.arrayBuffer());
  return storeImageBytes(buf, file.type, file.name || 'photo');
}

export const POST: APIRoute = async ({ request }) => {
  const form = await request.formData();
  const file = form.get('file');
  const url = asNullableText(form.get('url'));

  try {
    let key: string;
    if (file instanceof File && file.size > 0) {
      key = await importFromFile(file);
    } else if (url) {
      key = await importFromUrl(url);
    } else {
      return new Response('No file or URL provided', { status: 400 });
    }
    return Response.json({ key });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'failed to import photo';
    return new Response(message, { status: 400 });
  }
};
