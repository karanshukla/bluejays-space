import { isIP } from 'node:net';

// Cloudflare sits in front of `web` in production and sets CF-Connecting-IP on
// every request, the same header handles/main.go's clientIP() trusts, and the
// only vantage point that's actually the requester's IP once Railway's own
// proxy is also in the path. Falls back to a shared key in dev/tests (no
// Cloudflare in front), where every request lands in one rate-limit bucket.
//
// Cloudflare replaces any client-supplied value, but the Railway origin also
// answers for the site's hostname directly, and on that path the header is
// whatever the caller sent. Requiring it to parse as an address keeps a forged
// value to one bucket per address instead of one per arbitrary string; the
// route-wide ceiling in PublicRouteLimiter is what bounds the forging itself.
export function clientIp(request: Request): string {
  const claimed = request.headers.get('CF-Connecting-IP');
  return claimed && isIP(claimed) ? claimed : 'unknown';
}
