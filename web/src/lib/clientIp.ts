// Cloudflare sits in front of `web` in production and sets CF-Connecting-IP on
// every request, the same header handles/main.go's clientIP() trusts, and the
// only vantage point that's actually the requester's IP once Railway's own
// proxy is also in the path. Falls back to a shared key in dev/tests (no
// Cloudflare in front), where every request lands in one rate-limit bucket.
export function clientIp(request: Request): string {
  return request.headers.get('CF-Connecting-IP') ?? 'unknown';
}
