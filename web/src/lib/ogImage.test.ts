import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Readable } from 'node:stream';
import type { Headline } from './db';

const getImage = vi.fn();
vi.mock('./storage', () => ({ getImage: (...args: unknown[]) => getImage(...args) }));

const sharpChain = {
  resize: vi.fn(() => sharpChain),
  png: vi.fn(() => sharpChain),
  toBuffer: vi.fn(),
};
vi.mock('sharp', () => ({ default: vi.fn(() => sharpChain) }));

const { ogCacheKey, tapeBackgroundFor, loadPhotoDataUrl } = await import('./ogImage');

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
    source: 'admin',
    submitter_name: null,
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

describe('loadPhotoDataUrl', () => {
  beforeEach(() => {
    getImage.mockReset();
    sharpChain.toBuffer.mockReset();
    sharpChain.toBuffer.mockResolvedValue(Buffer.from([9, 9, 9]));
  });

  it('returns null when there is no photo_ref', async () => {
    expect(await loadPhotoDataUrl(null)).toBeNull();
    expect(getImage).not.toHaveBeenCalled();
  });

  it('returns null when the stored image is missing', async () => {
    getImage.mockResolvedValue(null);
    expect(await loadPhotoDataUrl('admin/gone.webp')).toBeNull();
  });

  it('returns null instead of throwing when storage errors', async () => {
    getImage.mockRejectedValue(new Error('S3 down'));
    expect(await loadPhotoDataUrl('admin/photo.webp')).toBeNull();
  });

  it('returns null instead of throwing when sharp cannot decode the bytes', async () => {
    getImage.mockResolvedValue({
      body: Readable.from([Buffer.from([1, 2, 3])]),
      contentType: 'image/webp',
    });
    sharpChain.toBuffer.mockRejectedValue(new Error('unsupported image format'));
    expect(await loadPhotoDataUrl('admin/photo.webp')).toBeNull();
  });

  it('re-encodes to a PNG data URL regardless of the stored format', async () => {
    // Re-encoding through sharp is required, not optional: Satori's <img>
    // handling doesn't reliably decode webp, which is what storeImageBytes
    // normally produces — passing stored bytes straight through crashes the
    // render (see the "u is not iterable" failure this was written against).
    getImage.mockResolvedValue({
      body: Readable.from([Buffer.from([1, 2, 3])]),
      contentType: 'image/webp',
    });
    const url = await loadPhotoDataUrl('admin/photo.webp');
    expect(url).toBe(`data:image/png;base64,${Buffer.from([9, 9, 9]).toString('base64')}`);
    expect(sharpChain.resize).toHaveBeenCalledWith(280, 280, { fit: 'cover' });
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
