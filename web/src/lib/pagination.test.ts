import { describe, expect, it } from 'vitest';
import { NO_NEXT_PAGE, nextPageAfter, parsePage } from './pagination';

describe('parsePage', () => {
  it('defaults to page 1 when the param is missing or empty', () => {
    expect(parsePage(null, 12)).toBe(1);
    expect(parsePage('', 12)).toBe(1);
  });

  it('accepts a positive integer', () => {
    expect(parsePage('3', 12)).toBe(3);
  });

  it('rejects anything that is not a positive integer', () => {
    expect(parsePage('0', 12)).toBeNull();
    expect(parsePage('-1', 12)).toBeNull();
    expect(parsePage('1.5', 12)).toBeNull();
    expect(parsePage('abc', 12)).toBeNull();
  });

  it('rejects a page whose offset is past the safe integer range', () => {
    expect(parsePage('1e300', 12)).toBeNull();
    expect(parsePage(String(Number.MAX_SAFE_INTEGER), 12)).toBeNull();
  });
});

describe('nextPageAfter', () => {
  it('returns the following page when more pages remain', () => {
    expect(nextPageAfter(1, 3)).toBe(2);
    expect(nextPageAfter(2, 3)).toBe(3);
  });

  it('returns NO_NEXT_PAGE once the current page is the last one', () => {
    expect(nextPageAfter(3, 3)).toBe(NO_NEXT_PAGE);
    expect(nextPageAfter(1, 1)).toBe(NO_NEXT_PAGE);
  });
});
