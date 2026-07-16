import { describe, expect, it, vi, beforeEach } from 'vitest';

const importPhotoFromForm = vi.fn();
vi.mock('../../../../lib/photoIntake', () => ({
  importPhotoFromForm: (...args: unknown[]) => importPhotoFromForm(...args),
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
    importPhotoFromForm.mockReset();
  });

  it('returns the stored key on success', async () => {
    importPhotoFromForm.mockResolvedValue('admin/123-cat.webp');

    const res = await callPost(new FormData());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ key: 'admin/123-cat.webp' });
  });

  it('returns 400 with the failure message', async () => {
    importPhotoFromForm.mockRejectedValue(new Error('unsupported image type (got text/plain)'));

    const res = await callPost(new FormData());
    expect(res.status).toBe(400);
    expect(await res.text()).toMatch(/unsupported image type/i);
  });
});
