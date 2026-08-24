import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { Agent, fetch as undiciFetch, type Response as UndiciResponse } from 'undici';

// Guards admin-supplied photo URLs against SSRF: refuses to fetch hosts that
// resolve to private, loopback, link-local, or cloud-metadata addresses, and
// re-validates every redirect hop (a same-origin-looking URL could otherwise
// redirect to an internal address after the initial DNS check passes).

const BLOCKED_V4_RANGES: [string, number][] = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10], // CGNAT
  ['127.0.0.0', 8],
  ['169.254.0.0', 16], // link-local, incl. cloud metadata (169.254.169.254)
  ['172.16.0.0', 12],
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4], // multicast/reserved
];

function ipToInt(ip: string): number {
  return ip.split('.').reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
}

function isBlockedV4(ip: string): boolean {
  const target = ipToInt(ip);
  return BLOCKED_V4_RANGES.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (target & mask) === (ipToInt(base) & mask);
  });
}

function isBlockedV6(ip: string): boolean {
  const lower = ip.toLowerCase();
  return (
    lower === '::1' ||
    lower.startsWith('fe80:') || // link-local
    lower.startsWith('fc') ||
    lower.startsWith('fd') || // unique local
    lower.startsWith('::ffff:') // v4-mapped — treat conservatively as blocked
  );
}

type ResolvedAddress = { address: string; family: number };

async function resolvePublicHttpUrl(rawUrl: string): Promise<ResolvedAddress> {
  const url = new URL(rawUrl);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('only http(s) URLs are allowed');
  }

  const hostname = url.hostname;
  const literalFamily = isIP(hostname);
  const addresses = literalFamily
    ? [{ address: hostname, family: literalFamily }]
    : await lookup(hostname, { all: true });

  for (const { address, family } of addresses) {
    if (family === 4 && isBlockedV4(address)) {
      throw new Error('that URL points to a private address');
    }
    if (family === 6 && isBlockedV6(address)) {
      throw new Error('that URL points to a private address');
    }
  }

  const first = addresses[0];
  if (!first) throw new Error('that URL did not resolve to any address');
  return first;
}

// Closes the check-to-connect gap: without pinning, fetch() resolves the
// hostname a second time and connects to whatever that lookup returns, so a
// host whose DNS answers public-then-private (rebinding) sails past the
// address checks above. The hostname still travels in the URL, so the Host
// header and TLS SNI — and therefore certificate validation — are unaffected.
//
// Must be dispatched via undici's own fetch(), not Node's global fetch: the
// global fetch is backed by whatever undici version ships inside the Node
// runtime, and handing it an Agent from a different major version of the npm
// package trips undici's internal handler-shape validation.
export function pinnedDispatcher({ address, family }: ResolvedAddress): Agent {
  return new Agent({
    connect: {
      lookup: (_hostname, options, callback) =>
        options?.all ? callback(null, [{ address, family }]) : callback(null, address, family),
    },
  });
}

// close() is graceful, so a response already in flight stays readable by the
// caller and its socket is released once the body has been consumed. It
// settles after safeFetch has returned, so it must not reject unhandled.
function release(dispatcher: Agent): void {
  void dispatcher.close().catch(() => {});
}

// Drop-in replacement for fetch() that validates the target host (and every
// redirect hop) isn't a private/internal address before connecting to it.
export async function safeFetch(rawUrl: string, maxRedirects = 5): Promise<UndiciResponse> {
  let current = rawUrl;
  for (let i = 0; i <= maxRedirects; i++) {
    const dispatcher = pinnedDispatcher(await resolvePublicHttpUrl(current));
    let res: UndiciResponse;
    try {
      res = await undiciFetch(current, { redirect: 'manual', dispatcher });
    } catch (err) {
      release(dispatcher);
      throw err;
    }
    if (res.status >= 300 && res.status < 400) {
      await res.body?.cancel();
      release(dispatcher);
      const location = res.headers.get('location');
      if (!location) throw new Error('redirect with no location');
      current = new URL(location, current).toString();
      continue;
    }
    release(dispatcher);
    return res;
  }
  throw new Error('too many redirects');
}
