// Read-only S3-compatible client for the image proxy route. web never writes
// — only ingest uploads — so this only needs GetObject.
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
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
  } catch {
    return null;
  }
}
