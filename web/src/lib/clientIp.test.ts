import { describe, expect, it } from 'vitest';
import { clientIp } from './clientIp';

describe('clientIp', () => {
  it('reads CF-Connecting-IP when present', () => {
    const request = new Request('https://bluejays.space/api/submit', {
      headers: { 'CF-Connecting-IP': '203.0.113.5' },
    });
    expect(clientIp(request)).toBe('203.0.113.5');
  });

  it('falls back to a shared key when the header is absent (dev/tests)', () => {
    const request = new Request('https://bluejays.space/api/submit');
    expect(clientIp(request)).toBe('unknown');
  });
});
