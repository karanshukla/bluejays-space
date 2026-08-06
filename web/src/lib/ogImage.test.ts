import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import type { Headline } from './db';

const getImage = vi.fn();
vi.mock('./storage', () => ({ getImage: (...args: unknown[]) => getImage(...args) }));

const sharpChain = {
  resize: vi.fn(() => sharpChain),
  png: vi.fn(() => sharpChain),
  toBuffer: vi.fn(),
};
vi.mock('sharp', () => ({ default: vi.fn(() => sharpChain) }));

const { ogCacheKey, tapeBackgroundFor, loadPhotoDataUrl, headlineFontSize, photoTiltFor } =
  await import('./ogImage');

function makeHeadline(overrides: Partial<Headline> = {}): Headline {
  return {
    id: 1,
    headline: 'Vlad walks it off',
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

  it('folds a layout version into the hash so a redesign invalidates old renders', () => {
    // Stored PNGs are served back with a one-year immutable cache. Hashing the
    // headline's content alone would leave every existing preview serving its
    // pre-redesign bytes forever, so the key must not be derivable from the
    // content fields on their own.
    const h = makeHeadline();
    const contentOnly = createHash('sha256')
      .update(`${h.headline}|${h.stat_block}|${h.photo_ref}`)
      .digest('hex')
      .slice(0, 12);
    expect(ogCacheKey(h)).not.toBe(`og/${h.id}-${contentOnly}.png`);
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
    expect(sharpChain.resize).toHaveBeenCalledWith(440, 330, { fit: 'cover' });
  });
});

describe('headlineFontSize', () => {
  const COLUMN = 532;
  const BOUNDS = { maxLines: 5, cap: 56, floor: 34 };

  it('gives a short headline the largest allowed size', () => {
    expect(headlineFontSize('Jays sweep Yankees', COLUMN, BOUNDS)).toBe(56);
  });

  it('shrinks as the headline gets longer', () => {
    const short = headlineFontSize('a'.repeat(60), COLUMN, BOUNDS);
    const medium = headlineFontSize('a'.repeat(120), COLUMN, BOUNDS);
    const long = headlineFontSize('a'.repeat(200), COLUMN, BOUNDS);
    expect(short).toBeGreaterThan(medium);
    expect(medium).toBeGreaterThan(long);
  });

  it('never exceeds the cap or drops below the floor', () => {
    for (const length of [1, 20, 80, 150, 400, 2000]) {
      const size = headlineFontSize('a'.repeat(length), COLUMN, BOUNDS);
      expect(size).toBeGreaterThanOrEqual(BOUNDS.floor);
      expect(size).toBeLessThanOrEqual(BOUNDS.cap);
    }
  });

  it('keeps the estimated block inside the lines it was given', () => {
    // The size is only useful if the headline it was picked for actually fits:
    // at that size, the text should wrap into no more than maxLines (unless it
    // was already clamped to the floor, where overflow is the accepted tradeoff
    // against an unreadably small headline).
    for (const length of [40, 90, 130]) {
      const size = headlineFontSize('a'.repeat(length), COLUMN, BOUNDS);
      const charsPerLine = COLUMN / (size * 0.52);
      expect(Math.ceil(length / charsPerLine)).toBeLessThanOrEqual(BOUNDS.maxLines);
    }
  });

  it('falls back to the cap for an empty headline instead of dividing by zero', () => {
    expect(headlineFontSize('', COLUMN, BOUNDS)).toBe(56);
  });

  it('scales up for the wider full-card column a photo-less headline gets', () => {
    const text = 'Vladimir Guerrero Jr. hits ball so hard it files for free agency';
    const narrow = headlineFontSize(text, COLUMN, BOUNDS);
    const wide = headlineFontSize(text, 1040, { maxLines: 4, cap: 88, floor: 42 });
    expect(wide).toBeGreaterThan(narrow);
  });
});

describe('photoTiltFor', () => {
  it('is stable per headline and stays within the subtle range the card uses', () => {
    for (let id = 1; id <= 100; id++) {
      const tilt = photoTiltFor(id);
      expect(tilt).toBe(photoTiltFor(id));
      expect(Math.abs(tilt)).toBeLessThanOrEqual(2);
    }
  });

  it('does not give every headline the same lean', () => {
    const tilts = new Set(Array.from({ length: 100 }, (_, i) => photoTiltFor(i + 1)));
    expect(tilts.size).toBeGreaterThan(3);
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
