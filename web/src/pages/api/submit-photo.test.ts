import { describe, expect, it, vi, beforeEach } from 'vitest';

const importPhotoFromForm = vi.fn();
vi.mock('../../lib/photoIntake', () => ({
  importPhotoFromForm: (...args: unknown[]) => importPhotoFromForm(...args),
}));

const { POST } = await import('./submit-photo');

function req(body: FormData, ip = '203.0.113.5'): Request {
  return new Request('http://localhost/api/submit-photo', {
    method: 'POST',
    body,
    headers: { 'CF-Connecting-IP': ip },
  });
}

async function callPost(body: FormData, ip?: string): Promise<Response> {
  return POST({ request: req(body, ip) } as Parameters<typeof POST>[0]);
}

describe('POST /api/submit-photo', () => {
  beforeEach(() => {
    importPhotoFromForm.mockReset();
  });

  it('returns the stored key on success', async () => {
    importPhotoFromForm.mockResolvedValue('admin/123-cat.webp');

    const res = await callPost(new FormData(), '203.0.113.10');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ key: 'admin/123-cat.webp' });
  });

  it('returns 400 with the failure message', async () => {
    importPhotoFromForm.mockRejectedValue(new Error('unsupported image type (got text/plain)'));

    const res = await callPost(new FormData(), '203.0.113.11');
    expect(res.status).toBe(400);
    expect(await res.text()).toMatch(/unsupported image type/i);
  });

  it('returns 400, not 500, when the body is not parseable form data', async () => {
    const request = new Request('http://localhost/api/submit-photo', {
      method: 'POST',
      body: 'not form data',
      headers: { 'CF-Connecting-IP': '203.0.113.13' },
    });
    const res = await POST({ request } as Parameters<typeof POST>[0]);
    expect(res.status).toBe(400);
    expect(importPhotoFromForm).not.toHaveBeenCalled();
  });

  it('rate-limits repeated uploads from the same IP', async () => {
    importPhotoFromForm.mockResolvedValue('admin/1-x.webp');

    for (let i = 0; i < 10; i++) {
      const res = await callPost(new FormData(), '203.0.113.12');
      expect(res.status).toBe(200);
    }
    const res = await callPost(new FormData(), '203.0.113.12');
    expect(res.status).toBe(429);
  });

  it('rate-limits a caller rotating a forged CF-Connecting-IP', async () => {
    importPhotoFromForm.mockResolvedValue('admin/1-x.webp');

    const statuses = [];
    for (let i = 0; i < 120; i++) {
      statuses.push((await callPost(new FormData(), `198.51.100.${i % 250}`)).status);
    }

    expect(statuses).toContain(429);
  });
});
