import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { Agent, fetch as undiciFetch, type Response as UndiciResponse } from 'undici';

// Guards admin-supplied photo URLs against SSRF: refuses to fetch hosts that
// resolve to private, loopback, link-local, or cloud-metadata addresses, and
// re-validates every redirect hop (a same-origin-looking URL could otherwise
// redirect to an internal address after the initial DNS check passes).

const FETCH_TIMEOUT_MS = 10_000;
const ALLOWED_PORTS = new Set(['', '80', '443']);

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
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved / future use + broadcast (255.255.255.255)
];

function ipToInt(ip: string): number {
  return ip.split('.').reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
}

export function isBlockedV4(ip: string): boolean {
  const target = ipToInt(ip);
  return BLOCKED_V4_RANGES.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (target & mask) === (ipToInt(base) & mask);
  });
}

const BLOCKED_V6_RANGES: [string, number][] = [
  ['::', 128], // unspecified
  ['::1', 128], // loopback
  ['::', 96], // IPv4-compatible
  ['::ffff:0:0', 96], // IPv4-mapped
  ['64:ff9b::', 96], // NAT64 well-known prefix
  ['64:ff9b:1::', 48], // NAT64 local-use
  ['100::', 64], // discard-only
  ['2001::', 32], // Teredo tunneling
  ['2001:db8::', 32], // documentation
  ['2002::', 16], // 6to4
  ['fc00::', 7], // unique local (fc00::/7 -> fc00..fdff)
  ['fe80::', 10], // link-local (fe80::/10 -> fe80..febf)
  ['ff00::', 8], // multicast
];

function ipv6ToBigInt(ip: string): bigint | null {
  const clean = ip.toLowerCase().split('%')[0];
  let work = clean;

  // Handle trailing dotted-quad IPv4 (e.g. ::ffff:127.0.0.1)
  const lastColon = work.lastIndexOf(':');
  if (lastColon !== -1 && work.includes('.')) {
    const v4Part = work.slice(lastColon + 1);
    const octets = v4Part.split('.');
    if (octets.length !== 4) return null;
    const nums = octets.map((o) => Number(o));
    if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
    const hi = ((nums[0] << 8) | nums[1]).toString(16);
    const lo = ((nums[2] << 8) | nums[3]).toString(16);
    work = `${work.slice(0, lastColon)}:${hi}:${lo}`;
  }

  const halves = work.split('::');
  if (halves.length > 2) return null;

  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - (left.length + right.length);
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) {
    return null;
  }

  const groups = [...left, ...Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...right];
  if (groups.length !== 8) return null;

  let result = 0n;
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    result = (result << 16n) | BigInt(parseInt(g, 16));
  }
  return result;
}

export function isBlockedV6(ip: string): boolean {
  const target = ipv6ToBigInt(ip);
  if (target === null) return true;
  return BLOCKED_V6_RANGES.some(([baseStr, prefix]) => {
    const base = ipv6ToBigInt(baseStr);
    if (base === null) return false;
    const shift = BigInt(128 - prefix);
    return prefix === 0 ? true : target >> shift === base >> shift;
  });
}

type ResolvedAddress = { address: string; family: number };

async function resolvePublicHttpUrl(rawUrl: string): Promise<ResolvedAddress> {
  const url = new URL(rawUrl);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('only http(s) URLs are allowed');
  }
  if (!ALLOWED_PORTS.has(url.port)) {
    throw new Error('non-standard ports are not allowed');
  }

  const hostname =
    url.hostname.startsWith('[') && url.hostname.endsWith(']')
      ? url.hostname.slice(1, -1)
      : url.hostname;
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
    connectTimeout: FETCH_TIMEOUT_MS,
    headersTimeout: FETCH_TIMEOUT_MS,
    bodyTimeout: FETCH_TIMEOUT_MS,
    connect: {
      timeout: FETCH_TIMEOUT_MS,
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
      res = await undiciFetch(current, {
        redirect: 'manual',
        dispatcher,
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
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
