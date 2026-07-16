import { describe, expect, it, vi, beforeEach, afterAll } from 'vitest';

const lookup = vi.fn();
vi.mock('node:dns/promises', () => ({ lookup: (...args: unknown[]) => lookup(...args) }));

const { safeFetch } = await import('./urlSafety');

describe('safeFetch', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    lookup.mockReset();
    global.fetch = vi.fn();
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it('fetches a URL whose hostname resolves to a public address', async () => {
    lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response('ok', { status: 200 })
    );

    const res = await safeFetch('https://example.com/photo.jpg');
    expect(res.status).toBe(200);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://example.com/photo.jpg',
      expect.objectContaining({ redirect: 'manual' })
    );
  });

  it('rejects an IP literal in a private range without a DNS lookup', async () => {
    await expect(safeFetch('http://192.168.1.5/secret')).rejects.toThrow('private address');
    expect(lookup).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('rejects the cloud metadata address', async () => {
    await expect(safeFetch('http://169.254.169.254/latest/meta-data/')).rejects.toThrow(
      'private address'
    );
  });

  it('rejects a loopback IP literal', async () => {
    await expect(safeFetch('http://127.0.0.1:9000/')).rejects.toThrow('private address');
  });

  it('rejects a hostname that resolves to a private address', async () => {
    lookup.mockResolvedValue([{ address: '10.0.0.5', family: 4 }]);
    await expect(safeFetch('http://internal.example.com/')).rejects.toThrow('private address');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('rejects non-http(s) protocols', async () => {
    await expect(safeFetch('file:///etc/passwd')).rejects.toThrow('only http(s) URLs');
  });

  it('re-validates and follows a redirect to a public address', async () => {
    lookup
      .mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }])
      .mockResolvedValueOnce([{ address: '93.184.216.35', family: 4 }]);
    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(
        new Response(null, { status: 302, headers: { location: 'https://cdn.example.com/x.jpg' } })
      )
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));

    const res = await safeFetch('https://example.com/redirect');
    expect(res.status).toBe(200);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('rejects a redirect to a private address instead of following it', async () => {
    lookup.mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }]);
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/' } })
    );

    await expect(safeFetch('https://example.com/redirect')).rejects.toThrow('private address');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
