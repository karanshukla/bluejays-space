import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
} from '@aws-sdk/client-s3';
import type { Readable } from 'node:stream';

let client: S3Client | undefined;

function getClient(): S3Client {
  if (!client) {
    client = new S3Client({
      region: process.env.S3_REGION || 'us-east-1',
      endpoint: process.env.S3_ENDPOINT,
      forcePathStyle: true,
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID ?? '',
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? '',
      },
    });
  }
  return client;
}

const bucket = () => process.env.S3_BUCKET || 'bluejays-images';

export interface StoredImage {
  body: Readable;
  contentType?: string;
}

export async function getImage(key: string): Promise<StoredImage | null> {
  try {
    const res = await getClient().send(new GetObjectCommand({ Bucket: bucket(), Key: key }));
    return { body: res.Body as Readable, contentType: res.ContentType };
  } catch (err) {
    // NoSuchKey/NotFound are expected (stale/typo'd photo_ref); anything else is
    // logged concisely so a burst of bad-key previews can't flood the logs.
    const { name, message } = (err as { name?: string; message?: string } | undefined) ?? {};
    if (name !== 'NoSuchKey' && name !== 'NotFound') {
      console.error(`[images] getImage(${key}) failed: ${name ?? 'Error'}: ${message ?? err}`);
    }
    return null;
  }
}

async function ensureBucket(): Promise<void> {
  const s3 = getClient();
  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucket() }));
  } catch {
    await s3.send(new CreateBucketCommand({ Bucket: bucket() }));
  }
}

export async function uploadImage(key: string, body: Buffer, contentType: string): Promise<void> {
  await ensureBucket();
  await getClient().send(
    new PutObjectCommand({ Bucket: bucket(), Key: key, Body: body, ContentType: contentType })
  );
}
