import { storeImageBytes, isAllowedImageType, MAX_BYTES } from './photoImport';
import { safeFetch } from './urlSafety';

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

// Shared by the admin photo-import route and the public submission photo
// route: parses a multipart form's `file` or `url` field and returns the
// stored object key. Both callers get the same content-type/size/SSRF
// checks, since neither an admin nor a public submitter should have a
// weaker-validated upload path.
export async function importPhotoFromForm(form: FormData): Promise<string> {
  const file = form.get('file');
  const url = form.get('url');
  if (file instanceof File && file.size > 0) return importFromFile(file);
  if (typeof url === 'string' && url.trim()) return importFromUrl(url.trim());
  throw new Error('No file or URL provided');
}
