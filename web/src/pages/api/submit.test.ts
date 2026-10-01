import { describe, expect, it, vi, beforeEach } from 'vitest';

const createSubmittedHeadline = vi.fn();
vi.mock('../../lib/db', () => ({
  createSubmittedHeadline: (...args: unknown[]) => createSubmittedHeadline(...args),
}));

const { POST } = await import('./submit');

async function callPost(fields: Record<string, string>, ip: string): Promise<Response> {
  const body = new FormData();
  for (const [name, value] of Object.entries(fields)) body.append(name, value);
  const request = new Request('http://localhost/api/submit', {
    method: 'POST',
    body,
    headers: { 'CF-Connecting-IP': ip },
  });
  const redirect = (location: string, status: number) =>
    new Response(null, { status, headers: { Location: location } });
  return POST({ request, redirect } as unknown as Parameters<typeof POST>[0]);
}

describe('POST /api/submit', () => {
  beforeEach(() => {
    createSubmittedHeadline.mockReset();
  });

  it('attaches a photo key issued by the import pipeline', async () => {
    const res = await callPost(
      { headline: 'Vlad hits one to the moon', photo_ref: 'admin/1737012345678-vlad.webp' },
      '203.0.113.20'
    );
    expect(res.headers.get('Location')).toBe('/submit?sent=1');
    expect(createSubmittedHeadline).toHaveBeenCalledWith(
      expect.objectContaining({ photo_ref: 'admin/1737012345678-vlad.webp' })
    );
  });

  it('rejects a photo_ref the import pipeline could not have issued', async () => {
    for (const [i, photoRef] of [
      'og/7-abc123.png',
      'https://example.com/x.png',
      `admin/1-${'a'.repeat(5000)}`,
    ].entries()) {
      const res = await callPost(
        { headline: 'Vlad hits one to the moon', photo_ref: photoRef },
        `203.0.113.${30 + i}`
      );
      expect(res.headers.get('Location')).toBe('/submit?error=server-error');
    }
    expect(createSubmittedHeadline).not.toHaveBeenCalled();
  });
});
