import {
  S3Client,
  PutObjectCommand,
  CreateBucketCommand,
  HeadBucketCommand,
} from '@aws-sdk/client-s3';
import sharp from 'sharp';

// Cards render at most ~640px wide even on the widest single-column mobile
// layout; 1280 covers that at 2x retina. Re-encoding to WebP at this size
// cuts typical multi-MB source photos down by 80-90% with no visible loss
// at display size (GSC was flagging these as "improperly sized images").
const MAX_WIDTH = 1280;
const WEBP_QUALITY = 82;

function client() {
  return new S3Client({
    region: process.env.S3_REGION || 'us-east-1',
    endpoint: process.env.S3_ENDPOINT,
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    },
  });
}

const bucket = () => process.env.S3_BUCKET || 'bluejays-images';

export async function ensureBucket() {
  const s3 = client();
  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucket() }));
  } catch {
    await s3.send(new CreateBucketCommand({ Bucket: bucket() }));
  }
}

export async function uploadImage(key, body, contentType) {
  const s3 = client();
  await s3.send(
    new PutObjectCommand({ Bucket: bucket(), Key: key, Body: body, ContentType: contentType })
  );
  return key;
}

// Downloads a source image and stores it under `key` so photo_ref points at our
// own copy — never hotlink a source CDN on the live site (SPEC.md). Returns the
// key, or null if the fetch fails or the content isn't an image.
export async function downloadAndStoreImage(url, key) {
  const res = await fetch(url);
  if (!res.ok) {
    console.warn(`[storage] image fetch failed: ${url} -> ${res.status}`);
    return null;
  }
  const contentType = res.headers.get('content-type') || 'image/jpeg';
  if (!contentType.startsWith('image/')) {
    console.warn(`[storage] not an image (${contentType}): ${url}`);
    return null;
  }
  const bytes = Buffer.from(await res.arrayBuffer());

  // GIFs are almost always animated on Reddit/Bluesky; re-encoding through
  // sharp would flatten them to a single frame, so store those untouched.
  if (contentType === 'image/gif') {
    await uploadImage(key, bytes, contentType);
    return key;
  }

  try {
    const webp = await sharp(bytes)
      .rotate()
      .resize({ width: MAX_WIDTH, withoutEnlargement: true })
      .webp({ quality: WEBP_QUALITY })
      .toBuffer();
    const webpKey = key.replace(/\.[a-z0-9]+$/i, '') + '.webp';
    await uploadImage(webpKey, webp, 'image/webp');
    return webpKey;
  } catch (err) {
    console.warn(`[storage] compression failed, storing original: ${err.message}`);
    await uploadImage(key, bytes, contentType);
    return key;
  }
}
