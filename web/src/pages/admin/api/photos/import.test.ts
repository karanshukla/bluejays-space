import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const storeImageBytes = vi.fn();
vi.mock('../../../../lib/photoImport', () => ({
  storeImageBytes: (...args: unknown[]) => storeImageBytes(...args),
  MAX_BYTES: 15 * 1024 * 1024,
}));

const { POST } = await import('./import');

function req(body: FormData): Request {
  return new Request('http://localhost/admin/api/photos/import', { method: 'POST', body });
}

async function callPost(body: FormData): Promise<Response> {
  return POST({ request: req(body) } as Parameters<typeof POST>[0]);
}

describe('POST /admin/api/photos/import', () => {
  const originalFetch = global.fetch;

  beforeEach(() => storeImageBytes.mockReset());
  afterEach(() => (global.fetch = originalFetch));

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
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'image/png' }),
      arrayBuffer: async () => new Uint8Array([9]).buffer,
    }) as unknown as typeof fetch;
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
    expect(await res.text()).toMatch(/not an image/i);
    expect(storeImageBytes).not.toHaveBeenCalled();
  });

  it('returns 400 when neither file nor url is provided', async () => {
    const res = await callPost(new FormData());
    expect(res.status).toBe(400);
    expect(await res.text()).toMatch(/no file or url/i);
  });

  it('returns 400 when a URL fetch fails, surfacing the message', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 502 }) as unknown as typeof fetch;
    const form = new FormData();
    form.append('url', 'https://example.com/x.jpg');

    const res = await callPost(form);
    expect(res.status).toBe(400);
    expect(await res.text()).toMatch(/HTTP 502/);
    expect(storeImageBytes).not.toHaveBeenCalled();
  });
});
