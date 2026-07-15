// Converts an admin-submitted "Photo ref" value into a real MinIO object key.
//
// Admins naturally paste a source image URL into that field (it's the most
// obvious way to attach a photo to a hand-written or edited draft) — but
// storing that URL verbatim as photo_ref is the bug this fixes: the image
// proxy route (api/images/[...key].ts) passes photo_ref straight to
// GetObjectCommand as an S3 key, and MinIO rejects a URL with
// XMinioInvalidObjectName ("Object name contains unsupported characters").
// A bare value that isn't a URL is assumed to already be a real bucket key
// (e.g. copied from an existing draft, or written by ingest) and is passed
// through unchanged — same as SPEC.md's Image Storage rule (never hotlink a
// source CDN; ingest already downloads-and-stores for its own drafts, this
// is the same treatment for a human-entered one).
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

// Resolves a submitted photo_ref: downloads + stores it if it looks like a
// URL, otherwise returns it unchanged. Throws a user-facing message on
// fetch/validation failure — callers must not fall back to storing the raw
// URL on failure, since that's exactly the bug being fixed here.
export async function resolvePhotoRef(value: string | null): Promise<string | null> {
  if (!value || !isHttpUrl(value)) return value;

  let res: Response;
  try {
    res = await fetch(value);
  } catch {
    throw new Error('could not reach that URL');
  }
  if (!res.ok) {
    throw new Error(`could not fetch that URL (HTTP ${res.status})`);
  }
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.startsWith('image/')) {
    throw new Error(`URL did not return an image (got ${contentType || 'unknown content-type'})`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength > MAX_BYTES) {
    throw new Error('image is too large');
  }

  const key = keyFor(value);
  await uploadImage(key, buf, contentType);
  return key;
}
