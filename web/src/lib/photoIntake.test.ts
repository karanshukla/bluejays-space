import { describe, expect, it, vi, beforeEach } from 'vitest';

const storeImageBytes = vi.fn();
vi.mock('./photoImport', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./photoImport')>();
  return { ...actual, storeImageBytes: (...args: unknown[]) => storeImageBytes(...args) };
});

const safeFetch = vi.fn();
vi.mock('./urlSafety', () => ({
  safeFetch: (...args: unknown[]) => safeFetch(...args),
}));

const { importPhotoFromForm } = await import('./photoIntake');

beforeEach(() => {
  storeImageBytes.mockReset();
  safeFetch.mockReset();
});

describe('importPhotoFromForm', () => {
  it('imports an uploaded file and returns its key', async () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'cat.jpg', { type: 'image/jpeg' });
    const form = new FormData();
    form.append('file', file);
    storeImageBytes.mockResolvedValue('admin/123-cat.webp');

    expect(await importPhotoFromForm(form)).toBe('admin/123-cat.webp');
    expect(storeImageBytes).toHaveBeenCalledWith(expect.any(Buffer), 'image/jpeg', 'cat.jpg');
  });

  it('imports a URL and returns its key', async () => {
    safeFetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'image/png' }),
      arrayBuffer: async () => new Uint8Array([9]).buffer,
    });
    const form = new FormData();
    form.append('url', 'https://example.com/x.png');
    storeImageBytes.mockResolvedValue('admin/456-x.webp');

    expect(await importPhotoFromForm(form)).toBe('admin/456-x.webp');
  });

  it('rejects a non-image file', async () => {
    const file = new File([new Uint8Array([1])], 'doc.pdf', { type: 'application/pdf' });
    const form = new FormData();
    form.append('file', file);

    await expect(importPhotoFromForm(form)).rejects.toThrow(/unsupported image type/i);
    expect(storeImageBytes).not.toHaveBeenCalled();
  });

  it('rejects an SVG file (XSS risk) even though the browser reports an image/ type', async () => {
    const file = new File([new Uint8Array([1])], 'evil.svg', { type: 'image/svg+xml' });
    const form = new FormData();
    form.append('file', file);

    await expect(importPhotoFromForm(form)).rejects.toThrow(/unsupported image type/i);
    expect(storeImageBytes).not.toHaveBeenCalled();
  });

  it('rejects when neither file nor url is provided', async () => {
    await expect(importPhotoFromForm(new FormData())).rejects.toThrow(/no file or url/i);
  });

  it('rejects when a URL fetch fails, surfacing the message', async () => {
    safeFetch.mockResolvedValue({ ok: false, status: 502 });
    const form = new FormData();
    form.append('url', 'https://example.com/x.jpg');

    await expect(importPhotoFromForm(form)).rejects.toThrow(/HTTP 502/);
    expect(storeImageBytes).not.toHaveBeenCalled();
  });

  it('rejects when the URL resolves to a private address', async () => {
    safeFetch.mockRejectedValue(new Error('that URL points to a private address'));
    const form = new FormData();
    form.append('url', 'http://169.254.169.254/latest/meta-data/');

    await expect(importPhotoFromForm(form)).rejects.toThrow(/private address/i);
    expect(storeImageBytes).not.toHaveBeenCalled();
  });
});
