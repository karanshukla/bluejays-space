// Resolves an admin-submitted photo_ref into a real MinIO object key.
// A bare key passes through unchanged; an http(s) URL is downloaded and stored
// so we never store the raw source-CDN URL as the photo_ref (MinIO rejects it
// as an S3 key, and the spec never hotlinks source CDNs on the live site).
import { uploadImage } from './storage';

const MAX_BYTES = 15 * 1024 * 1024;

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function keyFor(url: string): string {
  const stamp = Date.now();
  const last = url.split('/').pop() ?? '';
  const slug =
    last
      .replace(/[^a-z0-9_.-]/gi, '')
      .slice(0, 40)
      .replace(/^\.+/, '') || 'photo';
  return `admin/${stamp}-${slug}`;
}

export async function resolvePhotoRef(value: string | null): Promise<string | null> {
  if (!value || !isHttpUrl(value)) return value;

  let res: Response;
  try {
    res = await fetch(value);
  } catch {
    throw new Error('could not reach that URL');
  }
  if (!res.ok) throw new Error(`could not fetch that URL (HTTP ${res.status})`);

  const contentType = res.headers.get('content-type') || '';
  if (!contentType.startsWith('image/')) {
    throw new Error(`URL did not return an image (got ${contentType || 'unknown content-type'})`);
  }

  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength > MAX_BYTES) throw new Error('image is too large');

  const key = keyFor(value);
  await uploadImage(key, buf, contentType);
  return key;
}
