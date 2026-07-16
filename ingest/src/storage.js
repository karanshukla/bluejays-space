import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';

// The classifier reads draft images back from object storage to send to Claude
// vision. This module used to also upload/compress source images for the old
// generator; that path is gone, so only the read side remains.

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

// Fetches a stored image as bytes for the classifier to pass to Claude vision.
// Returns { contentType, buffer } (buffer is a Node Buffer), or null if the
// object is missing/unreadable — the caller treats a missing image as
// non-fatal and classifies text-only.
export async function getImageBytes(key) {
  const s3 = client();
  let res;
  try {
    res = await s3.send(new GetObjectCommand({ Bucket: bucket(), Key: key }));
  } catch (err) {
    console.warn(`[storage] could not read image ${key}: ${err.message}`);
    return null;
  }
  const contentType = res.ContentType || 'image/webp';
  const chunks = [];
  for await (const chunk of res.Body) chunks.push(chunk);
  return { contentType, buffer: Buffer.concat(chunks) };
}
