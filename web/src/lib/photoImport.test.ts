import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const uploadImage = vi.fn();
vi.mock('./storage', () => ({ uploadImage: (...args: unknown[]) => uploadImage(...args) }));

const { resolvePhotoRef } = await import('./photoImport');

describe('resolvePhotoRef', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    uploadImage.mockReset();
  });

  afterEach(() => {
    global.fetch = originalFetch;
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

  it('downloads and stores an http(s) URL, returning the new key', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'image/jpeg' }),
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    }) as unknown as typeof fetch;

    const key = await resolvePhotoRef('https://www.sportsnet.ca/wp-content/uploads/photo.jpg');
    expect(key).toMatch(/^admin\/\d+-photo\.jpg$/);
    expect(uploadImage).toHaveBeenCalledWith(key, expect.any(Buffer), 'image/jpeg');
  });

  it('throws when the URL fetch fails outright', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network down'));
    await expect(resolvePhotoRef('https://example.com/photo.jpg')).rejects.toThrow(
      'could not reach that URL'
    );
    expect(uploadImage).not.toHaveBeenCalled();
  });

  it('throws when the URL returns a non-2xx status', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 }) as unknown as typeof fetch;
    await expect(resolvePhotoRef('https://example.com/gone.jpg')).rejects.toThrow('HTTP 404');
    expect(uploadImage).not.toHaveBeenCalled();
  });

  it('throws when the URL does not point at an image', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'text/html' }),
    }) as unknown as typeof fetch;
    await expect(resolvePhotoRef('https://example.com/page.html')).rejects.toThrow(
      'did not return an image'
    );
    expect(uploadImage).not.toHaveBeenCalled();
  });
});
