import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { RateLimiter } from './rateLimit';

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
});
