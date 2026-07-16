import { describe, expect, it, vi, beforeEach } from 'vitest';

const uploadImage = vi.fn();
vi.mock('./storage', () => ({ uploadImage: (...args: unknown[]) => uploadImage(...args) }));

const safeFetch = vi.fn();
vi.mock('./urlSafety', () => ({ safeFetch: (...args: unknown[]) => safeFetch(...args) }));

const chain = {
  rotate: vi.fn(() => chain),
  clone: vi.fn(() => chain),
  resize: vi.fn(() => chain),
  webp: vi.fn(() => chain),
  toBuffer: vi.fn(),
};
vi.mock('sharp', () => ({ default: vi.fn(() => chain) }));

const { resolvePhotoRef, storeImageBytes, isAllowedImageType, smallVariantKey } =
  await import('./photoImport');

describe('smallVariantKey', () => {
  it('inserts -sm before the extension', () => {
    expect(smallVariantKey('admin/123-photo.webp')).toBe('admin/123-photo-sm.webp');
  });
});

describe('isAllowedImageType', () => {
  it('accepts common raster types', () => {
    expect(isAllowedImageType('image/jpeg')).toBe(true);
    expect(isAllowedImageType('image/png')).toBe(true);
    expect(isAllowedImageType('image/webp')).toBe(true);
    expect(isAllowedImageType('image/gif')).toBe(true);
    expect(isAllowedImageType('image/avif; charset=binary')).toBe(true);
  });

  it('rejects SVG (XML that can carry <script>) and other non-raster types', () => {
    expect(isAllowedImageType('image/svg+xml')).toBe(false);
    expect(isAllowedImageType('text/html')).toBe(false);
    expect(isAllowedImageType('application/pdf')).toBe(false);
  });
});

describe('storeImageBytes', () => {
  beforeEach(() => {
    uploadImage.mockReset();
    chain.toBuffer.mockReset();
    chain.toBuffer.mockResolvedValue(Buffer.from([1]));
  });

  it('stores a GIF untouched (no re-encode)', async () => {
    const buf = Buffer.from([1, 2, 3]);
    const key = await storeImageBytes(buf, 'image/gif', 'anim.gif');
    expect(key).toMatch(/^admin\/\d+-anim\.gif$/);
    expect(uploadImage).toHaveBeenCalledWith(key, buf, 'image/gif');
  });

  it('re-encodes a non-GIF image to webp, storing a large and a small variant', async () => {
    const buf = Buffer.from([4, 5, 6]);
    const key = await storeImageBytes(buf, 'image/jpeg', 'photo.jpg');
    expect(key).toMatch(/^admin\/\d+-photo\.webp$/);
    expect(uploadImage).toHaveBeenCalledTimes(2);
    expect(uploadImage).toHaveBeenCalledWith(key, expect.any(Buffer), 'image/webp');
    expect(uploadImage).toHaveBeenCalledWith(
      smallVariantKey(key),
      expect.any(Buffer),
      'image/webp'
    );
  });

  it('throws when over the size cap', async () => {
    const buf = Buffer.alloc(16 * 1024 * 1024);
    await expect(storeImageBytes(buf, 'image/png', 'big.png')).rejects.toThrow('too large');
    expect(uploadImage).not.toHaveBeenCalled();
  });

  it('rejects a disallowed content type (e.g. SVG) before touching storage', async () => {
    const buf = Buffer.from([1]);
    await expect(storeImageBytes(buf, 'image/svg+xml', 'evil.svg')).rejects.toThrow(
      'unsupported image type'
    );
    expect(uploadImage).not.toHaveBeenCalled();
  });
});

describe('resolvePhotoRef', () => {
  beforeEach(() => {
    uploadImage.mockReset();
    safeFetch.mockReset();
    chain.toBuffer.mockReset();
    chain.toBuffer.mockResolvedValue(Buffer.from([1]));
  });

  it('passes through null unchanged', async () => {
    expect(await resolvePhotoRef(null)).toBeNull();
    expect(uploadImage).not.toHaveBeenCalled();
  });

  it('passes through a bare object key unchanged (not a URL)', async () => {
    expect(await resolvePhotoRef('reddit/abc123-1737012345678.jpg')).toBe(
      'reddit/abc123-1737012345678.jpg'
    );
    expect(uploadImage).not.toHaveBeenCalled();
  });

  it('downloads and stores an http(s) URL, returning the webp key', async () => {
    safeFetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'image/jpeg' }),
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    });

    const key = await resolvePhotoRef('https://www.sportsnet.ca/wp-content/uploads/photo.jpg');
    expect(key).toMatch(/^admin\/\d+-photo\.webp$/);
    expect(uploadImage).toHaveBeenCalledTimes(2);
    expect(uploadImage).toHaveBeenCalledWith(key, expect.any(Buffer), 'image/webp');
    expect(uploadImage).toHaveBeenCalledWith(
      smallVariantKey(key as string),
      expect.any(Buffer),
      'image/webp'
    );
  });

  it('throws when the URL fetch fails outright', async () => {
    safeFetch.mockRejectedValue(new Error('network down'));
    await expect(resolvePhotoRef('https://example.com/photo.jpg')).rejects.toThrow(
      'could not reach that URL'
    );
    expect(uploadImage).not.toHaveBeenCalled();
  });

  it('surfaces the SSRF-guard message unchanged when the URL resolves to a private address', async () => {
    safeFetch.mockRejectedValue(new Error('that URL points to a private address'));
    await expect(resolvePhotoRef('https://example.com/photo.jpg')).rejects.toThrow(
      'private address'
    );
    expect(uploadImage).not.toHaveBeenCalled();
  });

  it('throws when the URL returns a non-2xx status', async () => {
    safeFetch.mockResolvedValue({ ok: false, status: 404 });
    await expect(resolvePhotoRef('https://example.com/gone.jpg')).rejects.toThrow('HTTP 404');
    expect(uploadImage).not.toHaveBeenCalled();
  });

  it('throws when the URL does not point at a supported image type', async () => {
    safeFetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'text/html' }),
    });
    await expect(resolvePhotoRef('https://example.com/page.html')).rejects.toThrow(
      'did not return a supported image type'
    );
    expect(uploadImage).not.toHaveBeenCalled();
  });

  it('rejects SVG even though it starts with "image/" (XSS risk)', async () => {
    safeFetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'image/svg+xml' }),
    });
    await expect(resolvePhotoRef('https://example.com/evil.svg')).rejects.toThrow(
      'did not return a supported image type'
    );
    expect(uploadImage).not.toHaveBeenCalled();
  });
});
