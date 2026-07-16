import sharp from 'sharp';
import { uploadImage } from './storage';
import { safeFetch } from './urlSafety';

export const MAX_BYTES = 15 * 1024 * 1024;

const MAX_WIDTH = 1280;
const WEBP_QUALITY = 82;

// Raster formats only — deliberately excludes image/svg+xml, which is XML
// that browsers parse and execute <script> inside, unlike a real raster image.
const ALLOWED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
]);

export function isAllowedImageType(contentType: string): boolean {
  return ALLOWED_IMAGE_TYPES.has(contentType.split(';')[0].trim().toLowerCase());
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\/[^\s]+$/i.test(value);
}

export function keyForSlug(slug: string): string {
  const stamp = Date.now();
  const cleaned =
    slug
      .replace(/[^a-z0-9_.-]/gi, '')
      .slice(0, 40)
      .replace(/^\.+/, '') || 'photo';
  return `admin/${stamp}-${cleaned}`;
}

export async function storeImageBytes(
  buf: Buffer,
  contentType: string,
  slug: string
): Promise<string> {
  if (!isAllowedImageType(contentType)) throw new Error(`unsupported image type: ${contentType}`);
  if (buf.byteLength > MAX_BYTES) throw new Error('image is too large');
  const key = keyForSlug(slug);

  if (contentType === 'image/gif') {
    await uploadImage(key, buf, contentType);
    return key;
  }

  try {
    const webp = await sharp(buf)
      .rotate()
      .resize({ width: MAX_WIDTH, withoutEnlargement: true })
      .webp({ quality: WEBP_QUALITY })
      .toBuffer();
    const webpKey = key.replace(/\.[a-z0-9]+$/i, '') + '.webp';
    await uploadImage(webpKey, webp, 'image/webp');
    return webpKey;
  } catch {
    await uploadImage(key, buf, contentType);
    return key;
  }
}

export async function resolvePhotoRef(value: string | null): Promise<string | null> {
  if (!value || !isHttpUrl(value)) return value;

  let res: Response;
  try {
    res = await safeFetch(value);
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
  const slug = value.split('/').pop() ?? '';
  return storeImageBytes(buf, contentType, slug);
}
