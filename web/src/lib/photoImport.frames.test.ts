// Runs against the real sharp, unlike photoImport.test.ts which mocks it. The
// frame-count assertions are the point: a mocked pipeline can show the right
// calls in the right order and still say nothing about whether animation
// survived the re-encode, which is exactly how uploads used to lose it.
import { describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';

const uploads = new Map<string, { buf: Buffer; type: string }>();
vi.mock('./storage', () => ({
  uploadImage: async (key: string, buf: Buffer, contentType: string) => {
    uploads.set(key, { buf, type: contentType });
  },
}));
const { storeImageBytes, smallVariantKey } = await import('./photoImport');

async function makeAnimated(format: 'webp' | 'gif', frames = 4) {
  const W = 200,
    H = 100;
  const raw = Buffer.alloc(W * H * frames * 3);
  for (let f = 0; f < frames; f++) raw.fill(40 + f * 50, f * W * H * 3, (f + 1) * W * H * 3);
  const pipe = sharp(raw, { raw: { width: W, height: H * frames, channels: 3, pageHeight: H } });
  return format === 'webp' ? pipe.webp({ loop: 0 }).toBuffer() : pipe.gif({ loop: 0 }).toBuffer();
}

describe('storeImageBytes (real sharp)', () => {
  it('preserves animation for animated webp, in both variants', async () => {
    uploads.clear();
    const key = await storeImageBytes(await makeAnimated('webp'), 'image/webp', 'anim.webp');
    expect(key).toMatch(/\.webp$/);
    for (const k of [key, smallVariantKey(key)]) {
      const stored = uploads.get(k)!;
      expect(stored.type).toBe('image/webp');
      expect((await sharp(stored.buf).metadata()).pages).toBe(4);
    }
  });

  it('converts an animated gif to a smaller animated webp', async () => {
    uploads.clear();
    const gif = await makeAnimated('gif');
    const key = await storeImageBytes(gif, 'image/gif', 'anim.gif');
    expect(key).toMatch(/\.webp$/);
    const stored = uploads.get(key)!;
    expect(stored.type).toBe('image/webp');
    expect((await sharp(stored.buf).metadata()).pages).toBe(4);
    expect(stored.buf.byteLength).toBeLessThan(gif.byteLength);
  });

  it('still produces a single-frame webp for a still jpeg', async () => {
    uploads.clear();
    const jpg = await sharp({
      create: { width: 1600, height: 900, channels: 3, background: '#134a8e' },
    })
      .jpeg()
      .toBuffer();
    const key = await storeImageBytes(jpg, 'image/jpeg', 'still.jpg');
    const large = await sharp(uploads.get(key)!.buf).metadata();
    expect(large.pages).toBeUndefined();
    expect(large.width).toBe(1024);
    expect((await sharp(uploads.get(smallVariantKey(key))!.buf).metadata()).width).toBe(640);
  });
});
