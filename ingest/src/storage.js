import {
  S3Client,
  PutObjectCommand,
  CreateBucketCommand,
  HeadBucketCommand,
} from '@aws-sdk/client-s3';

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
  await uploadImage(key, bytes, contentType);
  return key;
}
