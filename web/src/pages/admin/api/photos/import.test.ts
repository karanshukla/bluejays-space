import { describe, expect, it, vi, beforeEach } from 'vitest';

const storeImageBytes = vi.fn();
vi.mock('../../../../lib/photoImport', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../lib/photoImport')>();
  return { ...actual, storeImageBytes: (...args: unknown[]) => storeImageBytes(...args) };
});

const safeFetch = vi.fn();
vi.mock('../../../../lib/urlSafety', () => ({
  safeFetch: (...args: unknown[]) => safeFetch(...args),
}));

const { POST } = await import('./import');

function req(body: FormData): Request {
  return new Request('http://localhost/admin/api/photos/import', { method: 'POST', body });
}

async function callPost(body: FormData): Promise<Response> {
  return POST({ request: req(body) } as Parameters<typeof POST>[0]);
}

describe('POST /admin/api/photos/import', () => {
  beforeEach(() => {
    storeImageBytes.mockReset();
    safeFetch.mockReset();
  });

  it('imports an uploaded file and returns its key', async () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'cat.jpg', { type: 'image/jpeg' });
    const form = new FormData();
    form.append('file', file);
    storeImageBytes.mockResolvedValue('admin/123-cat.webp');

    const res = await callPost(form);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ key: 'admin/123-cat.webp' });
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

    const res = await callPost(form);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ key: 'admin/456-x.webp' });
  });

  it('rejects a non-image file', async () => {
    const file = new File([new Uint8Array([1])], 'doc.pdf', { type: 'application/pdf' });
    const form = new FormData();
    form.append('file', file);

    const res = await callPost(form);
    expect(res.status).toBe(400);
    expect(await res.text()).toMatch(/unsupported image type/i);
    expect(storeImageBytes).not.toHaveBeenCalled();
  });

  it('rejects an SVG file (XSS risk) even though the browser reports an image/ type', async () => {
    const file = new File([new Uint8Array([1])], 'evil.svg', { type: 'image/svg+xml' });
    const form = new FormData();
    form.append('file', file);

    const res = await callPost(form);
    expect(res.status).toBe(400);
    expect(await res.text()).toMatch(/unsupported image type/i);
    expect(storeImageBytes).not.toHaveBeenCalled();
  });

  it('returns 400 when neither file nor url is provided', async () => {
    const res = await callPost(new FormData());
    expect(res.status).toBe(400);
    expect(await res.text()).toMatch(/no file or url/i);
  });

  it('returns 400 when a URL fetch fails, surfacing the message', async () => {
    safeFetch.mockResolvedValue({ ok: false, status: 502 });
    const form = new FormData();
    form.append('url', 'https://example.com/x.jpg');

    const res = await callPost(form);
    expect(res.status).toBe(400);
    expect(await res.text()).toMatch(/HTTP 502/);
    expect(storeImageBytes).not.toHaveBeenCalled();
  });

  it('returns 400 when the URL resolves to a private address', async () => {
    safeFetch.mockRejectedValue(new Error('that URL points to a private address'));
    const form = new FormData();
    form.append('url', 'http://169.254.169.254/latest/meta-data/');

    const res = await callPost(form);
    expect(res.status).toBe(400);
    expect(await res.text()).toMatch(/private address/i);
    expect(storeImageBytes).not.toHaveBeenCalled();
  });
});
