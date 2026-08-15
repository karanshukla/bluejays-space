// In-memory sliding-window rate limiter, same shape as handles/main.go's
// newRateLimiter/allow, ported to TS for the public /submit route. Per-process
// state: fine at today's single Railway instance, but resets on deploy/restart
// and won't be shared across replicas if the service ever scales horizontally.
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number
  ) {}

  get trackedKeys(): number {
    return this.hits.size;
  }

  private recentHits(key: string, cutoff: number): number[] {
    return (this.hits.get(key) ?? []).filter((t) => t > cutoff);
  }

  // Same verdict as allow() without spending anything, so a caller checking
  // several budgets can decline before it has consumed any of them.
  wouldAllow(key: string): boolean {
    return this.recentHits(key, Date.now() - this.windowMs).length < this.limit;
  }

  allow(key: string): boolean {
    const now = Date.now();
    const cutoff = now - this.windowMs;
    const recent = this.recentHits(key, cutoff);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    this.forgetExpiredKeys(cutoff);
    return true;
  }

  // Pruning per key on access still leaves the key itself behind forever, so a
  // caller keyed on anything an attacker can vary grows this map without bound.
  private forgetExpiredKeys(cutoff: number): void {
    if (this.hits.size <= SWEEP_ABOVE_KEYS) return;
    for (const [key, times] of this.hits) {
      if (times.every((t) => t <= cutoff)) this.hits.delete(key);
    }
  }
}

const SWEEP_ABOVE_KEYS = 1024;
const ROUTE_WIDE_KEY = '*';

// The public routes budget per client by clientIp(), which reads a request
// header. Railway's origin answers for the site's hostname without Cloudflare
// in the path, so a caller that goes straight there supplies that header
// itself, and rotating it mints a fresh per-client budget on every request.
// The route-wide ceiling is what actually bounds that: forged identities buy a
// larger share of one fixed budget rather than an unlimited one, and they can
// no longer grow the per-client map past that budget either. The trade-off is
// that a flood can exhaust the ceiling and make the route refuse everyone for
// the rest of the window, which is bounded degradation in place of unbounded
// abuse. Closing it properly needs the origin to stop answering requests that
// did not come through Cloudflare.
export class PublicRouteLimiter {
  private readonly perClient: RateLimiter;
  private readonly routeWide: RateLimiter;

  constructor(perClientLimit: number, routeWideLimit: number, windowMs: number) {
    this.perClient = new RateLimiter(perClientLimit, windowMs);
    this.routeWide = new RateLimiter(routeWideLimit, windowMs);
  }

  allow(key: string): boolean {
    if (!this.perClient.wouldAllow(key)) return false;
    if (!this.routeWide.wouldAllow(ROUTE_WIDE_KEY)) return false;
    this.perClient.allow(key);
    this.routeWide.allow(ROUTE_WIDE_KEY);
    return true;
  }
}
