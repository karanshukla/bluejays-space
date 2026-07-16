import { describe, expect, it } from 'vitest';
import { ogCacheKey } from './ogImage';
import type { Headline } from './db';

function makeHeadline(overrides: Partial<Headline> = {}): Headline {
  return {
    id: 1,
    headline: 'Vlad walks it off',
    register: 1,
    player_ids: ['vladimir-guerrero-jr'],
    stat_block: '.382 AVG',
    photo_ref: 'photos/vlad.jpg',
    source_post_url: null,
    source_note: null,
    status: 'published',
    created_at: '2026-01-01',
    published_at: '2026-01-01',
    ...overrides,
  };
}

describe('ogCacheKey', () => {
  it('is deterministic for the same content', () => {
    const h = makeHeadline();
    expect(ogCacheKey(h)).toBe(ogCacheKey(makeHeadline()));
  });

  it('includes the id in the key', () => {
    expect(ogCacheKey(makeHeadline({ id: 5 })).startsWith('og/5-')).toBe(true);
  });

  it('changes when the headline text changes (content-hash invalidation)', () => {
    const a = ogCacheKey(makeHeadline({ headline: 'First headline' }));
    const b = ogCacheKey(makeHeadline({ headline: 'Second headline' }));
    expect(a).not.toBe(b);
  });

  it('changes when the stat block changes', () => {
    const a = ogCacheKey(makeHeadline({ stat_block: '.300 AVG' }));
    const b = ogCacheKey(makeHeadline({ stat_block: '.350 AVG' }));
    expect(a).not.toBe(b);
  });

  it('changes when the photo ref changes', () => {
    const a = ogCacheKey(makeHeadline({ photo_ref: 'photos/a.jpg' }));
    const b = ogCacheKey(makeHeadline({ photo_ref: 'photos/b.jpg' }));
    expect(a).not.toBe(b);
  });

  it('handles null stat_block and photo_ref without throwing', () => {
    const key = ogCacheKey(makeHeadline({ stat_block: null, photo_ref: null }));
    expect(key).toMatch(/^og\/1-[0-9a-f]{12}\.png$/);
  });

  it('produces a 12-hex-char hash segment', () => {
    expect(ogCacheKey(makeHeadline())).toMatch(/^og\/1-[0-9a-f]{12}\.png$/);
  });
});
