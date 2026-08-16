import { describe, expect, it } from 'vitest';
import { NO_NEXT_PAGE, nextPageAfter } from './pagination';

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
