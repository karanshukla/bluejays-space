import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { PublicRouteLimiter, RateLimiter } from './rateLimit';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('RateLimiter', () => {
  it('allows up to the limit within the window', () => {
    const limiter = new RateLimiter(3, 1000);
    expect(limiter.allow('ip-a')).toBe(true);
    expect(limiter.allow('ip-a')).toBe(true);
    expect(limiter.allow('ip-a')).toBe(true);
    expect(limiter.allow('ip-a')).toBe(false);
  });

  it('tracks keys independently', () => {
    const limiter = new RateLimiter(1, 1000);
    expect(limiter.allow('ip-a')).toBe(true);
    expect(limiter.allow('ip-b')).toBe(true);
    expect(limiter.allow('ip-a')).toBe(false);
    expect(limiter.allow('ip-b')).toBe(false);
  });

  it('allows again once old hits fall outside the window', () => {
    const limiter = new RateLimiter(1, 1000);
    expect(limiter.allow('ip-a')).toBe(true);
    expect(limiter.allow('ip-a')).toBe(false);

    vi.advanceTimersByTime(1001);

    expect(limiter.allow('ip-a')).toBe(true);
  });

  it('forgets keys whose hits have all expired', () => {
    const limiter = new RateLimiter(1, 1000);
    for (let i = 0; i < 1200; i++) limiter.allow(`203.0.113.${i}`);
    expect(limiter.trackedKeys).toBe(1200);

    vi.advanceTimersByTime(1001);
    limiter.allow('198.51.100.1');

    expect(limiter.trackedKeys).toBe(1);
  });

  it('reports wouldAllow without spending the budget', () => {
    const limiter = new RateLimiter(1, 1000);
    expect(limiter.wouldAllow('ip-a')).toBe(true);
    expect(limiter.wouldAllow('ip-a')).toBe(true);
    expect(limiter.allow('ip-a')).toBe(true);
    expect(limiter.wouldAllow('ip-a')).toBe(false);
  });
});

describe('PublicRouteLimiter', () => {
  it('holds a forged, rotating key to the route-wide ceiling', () => {
    const limiter = new PublicRouteLimiter(2, 5, 1000);

    let allowed = 0;
    for (let i = 0; i < 50; i++) {
      if (limiter.allow(`203.0.113.${i}`)) allowed++;
    }

    expect(allowed).toBe(5);
  });

  it('still applies the per-client budget below the ceiling', () => {
    const limiter = new PublicRouteLimiter(2, 100, 1000);
    expect(limiter.allow('203.0.113.5')).toBe(true);
    expect(limiter.allow('203.0.113.5')).toBe(true);
    expect(limiter.allow('203.0.113.5')).toBe(false);
    expect(limiter.allow('203.0.113.6')).toBe(true);
  });

  it('does not spend the route-wide budget on a request the per-client budget refuses', () => {
    const limiter = new PublicRouteLimiter(1, 3, 1000);
    expect(limiter.allow('203.0.113.5')).toBe(true);
    for (let i = 0; i < 10; i++) expect(limiter.allow('203.0.113.5')).toBe(false);

    expect(limiter.allow('203.0.113.6')).toBe(true);
    expect(limiter.allow('203.0.113.7')).toBe(true);
    expect(limiter.allow('203.0.113.8')).toBe(false);
  });

  it('recovers both budgets once the window passes', () => {
    const limiter = new PublicRouteLimiter(1, 1, 1000);
    expect(limiter.allow('203.0.113.5')).toBe(true);
    expect(limiter.allow('203.0.113.6')).toBe(false);

    vi.advanceTimersByTime(1001);

    expect(limiter.allow('203.0.113.6')).toBe(true);
  });
});
