// S3-compatible client. Reads back the image proxy route needs (GetObject);
// writes back the one admin-triggered case that needs them — importing a
// pasted photo URL into MinIO (see photoImport.ts). ingest remains the
// primary uploader for the automated generation pipeline.
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
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

export interface StoredImage {
  body: Readable;
  contentType?: string;
}

export async function getImage(key: string): Promise<StoredImage | null> {
  try {
    const res = await getClient().send(
      new GetObjectCommand({ Bucket: process.env.S3_BUCKET || 'bluejays-images', Key: key })
    );
    return { body: res.Body as Readable, contentType: res.ContentType };
  } catch (err) {
    // A genuinely missing key is normal (a stale/typo'd photo_ref) and not worth
    // logging. Anything else — wrong S3_ENDPOINT, bad credentials, MinIO
    // unreachable, bucket missing — was previously indistinguishable from a
    // missing key (both just returned null, so the proxy route always answered
    // a flat 404 with no server-side trace of what actually went wrong).
    const { name, message } = (err as { name?: string; message?: string } | undefined) ?? {};
    if (name !== 'NoSuchKey' && name !== 'NotFound') {
      // One concise line, not the full error object — a burst of these (e.g.
      // a live UI preview re-fetching on every keystroke of a bad key) must
      // not be able to flood the logs with a full AWS SDK stack trace each,
      // which is heavy enough on its own to hit Railway's log rate limit.
      console.error(`[images] getImage(${key}) failed: ${name ?? 'Error'}: ${message ?? err}`);
    }
    return null;
  }
}

export async function uploadImage(key: string, body: Buffer, contentType: string): Promise<void> {
  await getClient().send(
    new PutObjectCommand({
      Bucket: process.env.S3_BUCKET || 'bluejays-images',
      Key: key,
      Body: body,
      ContentType: contentType,
    })
  );
}
