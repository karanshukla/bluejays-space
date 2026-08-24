import { describe, expect, it, vi, beforeAll, beforeEach, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

const lookup = vi.fn();
vi.mock('node:dns/promises', () => ({ lookup: (...args: unknown[]) => lookup(...args) }));

const fetchMock = vi.fn();
vi.mock('undici', async () => {
  const actual = await vi.importActual<typeof import('undici')>('undici');
  return { ...actual, fetch: fetchMock };
});

const { safeFetch, pinnedDispatcher } = await import('./urlSafety');
const { fetch: realFetch } = await vi.importActual<typeof import('undici')>('undici');

describe('safeFetch', () => {
  beforeEach(() => {
    lookup.mockReset();
    fetchMock.mockReset();
  });

  it('fetches a URL whose hostname resolves to a public address', async () => {
    lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    fetchMock.mockResolvedValue(new Response('ok', { status: 200 }));

    const res = await safeFetch('https://example.com/photo.jpg');
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.com/photo.jpg',
      expect.objectContaining({ redirect: 'manual' })
    );
  });

  it('resolves the hostname once per hop and pins the connection to what it validated', async () => {
    lookup
      .mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }])
      .mockResolvedValue([{ address: '169.254.169.254', family: 4 }]);
    fetchMock.mockResolvedValue(new Response('ok', { status: 200 }));

    await safeFetch('https://rebind.example.com/photo.jpg');

    expect(lookup).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0][1] as RequestInit & {
      dispatcher?: unknown;
    };
    expect(init.dispatcher).toBeDefined();
  });

  it('rejects an IP literal in a private range without a DNS lookup', async () => {
    await expect(safeFetch('http://192.168.1.5/secret')).rejects.toThrow('private address');
    expect(lookup).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
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
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects non-http(s) protocols', async () => {
    await expect(safeFetch('file:///etc/passwd')).rejects.toThrow('only http(s) URLs');
  });

  it('re-validates and follows a redirect to a public address', async () => {
    lookup
      .mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }])
      .mockResolvedValueOnce([{ address: '93.184.216.35', family: 4 }]);
    fetchMock
      .mockResolvedValueOnce(
        new Response(null, { status: 302, headers: { location: 'https://cdn.example.com/x.jpg' } })
      )
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));

    const res = await safeFetch('https://example.com/redirect');
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rejects a redirect to a private address instead of following it', async () => {
    lookup.mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }]);
    fetchMock.mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/' } })
    );

    await expect(safeFetch('https://example.com/redirect')).rejects.toThrow('private address');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('pinnedDispatcher', () => {
  let server: Server;
  let port: number;

  beforeAll(async () => {
    server = createServer((req, res) => res.end(req.headers.host));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(() => {
    server.close();
  });

  it('connects to the pinned address regardless of what the hostname resolves to', async () => {
    // `.invalid` never resolves, so reaching the server at all proves the
    // socket followed the pin rather than a second DNS answer. The echoed Host
    // header proves the hostname (and so TLS SNI) survives the pinning.
    const dispatcher = pinnedDispatcher({ address: '127.0.0.1', family: 4 });
    try {
      const res = await realFetch(`http://rebind.invalid:${port}/`, { dispatcher });
      expect(await res.text()).toBe(`rebind.invalid:${port}`);
    } finally {
      await dispatcher.close();
    }
  });
});
