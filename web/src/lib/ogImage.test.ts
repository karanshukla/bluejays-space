import { describe, expect, it } from 'vitest';
import { ogCacheKey, tapeBackgroundFor } from './ogImage';
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
    category: null,
    safety_status: null,
    safety_reason: null,
    classified_at: null,
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

describe('tapeBackgroundFor', () => {
  const RED = '#c8102e';
  const BLUE_TAPE = '#1e4d8c';

  it('maps each of the six variants (id % 6) to the feed-card tape colors', () => {
    const [a, b, c, d, e, f] = [0, 1, 2, 3, 4, 5].map(tapeBackgroundFor);
    expect(a).toContain(BLUE_TAPE);
    expect(b).toContain(BLUE_TAPE);
    expect(c).toContain(RED);
    expect(f).toContain(RED);
    expect(d).toBe(BLUE_TAPE);
    expect(e).toBe(RED);
  });

  it('gives a solid strip (no gradient) only to the solid variants', () => {
    const solids = [3, 4].map(tapeBackgroundFor);
    const stripes = [0, 1, 2, 5].map(tapeBackgroundFor);
    for (const bg of stripes) expect(bg).toContain('repeating-linear-gradient');
    for (const bg of solids) expect(bg).not.toContain('repeating-linear-gradient');
  });

  it('wraps around for ids >= 6 (same tape for id 0 and id 6)', () => {
    expect(tapeBackgroundFor(6)).toBe(tapeBackgroundFor(0));
    expect(tapeBackgroundFor(11)).toBe(tapeBackgroundFor(5));
  });
});
