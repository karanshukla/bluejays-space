// In-memory sliding-window rate limiter — same shape as handles/main.go's
// newRateLimiter/allow, ported to TS for the public /submit route. Per-process
// state: fine at today's single Railway instance, but resets on deploy/restart
// and won't be shared across replicas if the service ever scales horizontally.
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number
  ) {}

  allow(key: string): boolean {
    const cutoff = Date.now() - this.windowMs;
    const recent = (this.hits.get(key) ?? []).filter((t) => t > cutoff);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(Date.now());
    this.hits.set(key, recent);
    return true;
  }
}
