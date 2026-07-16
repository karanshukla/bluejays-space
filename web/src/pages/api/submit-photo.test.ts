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

    const res = await callPost(new FormData(), 'ip-a');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ key: 'admin/123-cat.webp' });
  });

  it('returns 400 with the failure message', async () => {
    importPhotoFromForm.mockRejectedValue(new Error('unsupported image type (got text/plain)'));

    const res = await callPost(new FormData(), 'ip-b');
    expect(res.status).toBe(400);
    expect(await res.text()).toMatch(/unsupported image type/i);
  });

  it('rate-limits repeated uploads from the same IP', async () => {
    importPhotoFromForm.mockResolvedValue('admin/1-x.webp');

    for (let i = 0; i < 10; i++) {
      const res = await callPost(new FormData(), 'ip-c');
      expect(res.status).toBe(200);
    }
    const res = await callPost(new FormData(), 'ip-c');
    expect(res.status).toBe(429);
  });
});
