// Object storage — self-hosted S3-compatible store (MinIO locally, any
// S3-compatible endpoint in production) standing in for Cloudflare R2.
// Only ingest writes; web only reads (via its own proxy route), so the
// write client and its credentials live here, not in web.

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
