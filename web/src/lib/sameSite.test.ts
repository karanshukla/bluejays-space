import { describe, expect, it } from 'vitest';
import { isSameSite } from './sameSite';

const ADMIN_URL = new URL('https://bluejays.space/admin/api/headlines/1/publish');

function reqWith(headers: Record<string, string>): Request {
  return new Request(ADMIN_URL, { method: 'POST', headers });
}

describe('isSameSite', () => {
  it('allows a same-origin request (Sec-Fetch-Site: same-origin)', () => {
    expect(isSameSite(reqWith({ 'Sec-Fetch-Site': 'same-origin' }), ADMIN_URL)).toBe(true);
  });

  it('allows a browser-typed/bookmarked navigation (Sec-Fetch-Site: none)', () => {
    expect(isSameSite(reqWith({ 'Sec-Fetch-Site': 'none' }), ADMIN_URL)).toBe(true);
  });

  it('blocks a cross-site request (Sec-Fetch-Site: cross-site)', () => {
    expect(isSameSite(reqWith({ 'Sec-Fetch-Site': 'cross-site' }), ADMIN_URL)).toBe(false);
  });

  it('blocks a same-site-but-different-origin request (Sec-Fetch-Site: same-site)', () => {
    expect(isSameSite(reqWith({ 'Sec-Fetch-Site': 'same-site' }), ADMIN_URL)).toBe(false);
  });

  it('falls back to Origin host comparison when Sec-Fetch-Site is absent', () => {
    expect(isSameSite(reqWith({ Origin: 'https://bluejays.space' }), ADMIN_URL)).toBe(true);
    expect(isSameSite(reqWith({ Origin: 'https://evil.example.com' }), ADMIN_URL)).toBe(false);
  });

  it('ignores scheme mismatch in the Origin fallback (Railway proxy quirk)', () => {
    // The app always sees http:// requests behind Railway's proxy even though
    // the browser's real Origin is https:// — host-only comparison must still pass.
    expect(isSameSite(reqWith({ Origin: 'https://bluejays.space' }), ADMIN_URL)).toBe(true);
  });

  it('allows a request with neither Sec-Fetch-Site nor Origin (non-browser client)', () => {
    expect(isSameSite(reqWith({}), ADMIN_URL)).toBe(true);
  });

  it('blocks a malformed Origin header', () => {
    expect(isSameSite(reqWith({ Origin: 'not a url' }), ADMIN_URL)).toBe(false);
  });
});
