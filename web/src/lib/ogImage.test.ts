import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import type { Headline } from './db';
import { SUBMITTER_NAME_MAX } from './submissionLimits';

const getImage = vi.fn();
vi.mock('./storage', () => ({ getImage: (...args: unknown[]) => getImage(...args) }));

const sharpChain = {
  resize: vi.fn(() => sharpChain),
  png: vi.fn(() => sharpChain),
  toBuffer: vi.fn(),
};
vi.mock('sharp', () => ({ default: vi.fn(() => sharpChain) }));

const {
  ogCacheKey,
  tapeBackgroundFor,
  loadPhotoDataUrl,
  photoTiltFor,
  fitText,
  fitCardText,
  measureText,
  headlineStyle,
  statStyle,
  labelStyle,
  PARODY_LABEL,
  LABEL_MARGIN_TOP,
  LABEL_TEXT_HEIGHT,
  CONTENT_HEIGHT,
  textBlockHeight,
  TEXT_BUDGET,
  submitterCreditFor,
  SUBMITTER_MARGIN_TOP,
} = await import('./ogImage');

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

  it('changes when the submitter name changes (the credit line is part of the render)', () => {
    const a = ogCacheKey(makeHeadline({ submitter_name: null }));
    const b = ogCacheKey(makeHeadline({ submitter_name: 'Jane' }));
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

const PHOTO_COLUMN = 532;
const FULL_COLUMN = 1040;
const PHOTO_BOUNDS = { cap: 56, floor: 30 };
const FULL_BOUNDS = { cap: 88, floor: 34 };

const SHORT = 'Jays sweep Yankees';
const MEDIUM = 'Vladimir Guerrero Jr. hits ball so hard it files for free agency';
const LONG =
  'Blue Jays announce that Rogers Centre will be renamed the Rogers Centre presented by Rogers in a multi-year deal with Rogers';
const VERY_LONG =
  'Toronto Blue Jays confirm the seventh-inning stretch will now be performed exclusively by a committee of interns who have never attended a baseball game and refuse to learn the words';
// The public submission caps (submissionLimits.ts): the longest input that can
// reach a card without an admin hand-writing something longer.
const MAX_HEADLINE =
  'Toronto Blue Jays front office confirms that the entire 2026 roster construction strategy was in fact decided by a single intern with a spreadsheet, a coin, and an unshakeable belief that every problem in professional baseball can be solved by simply acquiring more relief pitchers';
const MAX_STAT =
  '41 HR / 108 RBI / .382 AVG / 4.1 WAR / 112 consecutive games / 7 different relief pitchers acquired at the deadline / 0 explanations offered by the front office';

function fitHeadline(text: string, columnWidth: number, maxHeight: number, bounds = PHOTO_BOUNDS) {
  return fitText(text, (fontSize) => headlineStyle(columnWidth, fontSize), {
    maxHeight,
    ...bounds,
  });
}

describe('fitText', () => {
  it('gives a short headline the largest allowed size', async () => {
    const fitted = await fitHeadline(SHORT, PHOTO_COLUMN, 446);
    expect(fitted.fontSize).toBe(PHOTO_BOUNDS.cap);
    expect(fitted.text).toBe(SHORT);
  });

  it('shrinks as the headline gets longer', async () => {
    const sizes = await Promise.all(
      [MEDIUM, LONG, VERY_LONG].map(async (t) => (await fitHeadline(t, PHOTO_COLUMN, 300)).fontSize)
    );
    expect(sizes[0]).toBeGreaterThan(sizes[1]);
    expect(sizes[1]).toBeGreaterThan(sizes[2]);
  });

  it('never exceeds the cap or drops below the floor', async () => {
    for (const text of [SHORT, MEDIUM, LONG, VERY_LONG, MAX_HEADLINE, 'a'.repeat(2000)]) {
      const { fontSize } = await fitHeadline(text, PHOTO_COLUMN, 300);
      expect(fontSize).toBeGreaterThanOrEqual(PHOTO_BOUNDS.floor);
      expect(fontSize).toBeLessThanOrEqual(PHOTO_BOUNDS.cap);
    }
  });

  it('reports the height Satori actually lays the block out at', async () => {
    // The whole point of measuring rather than estimating: a character-count
    // guess cannot model word wrapping, so the reported height has to come from
    // the real line count, not from an assumed glyph width.
    for (const text of [SHORT, MEDIUM, LONG, VERY_LONG, MAX_HEADLINE]) {
      const fitted = await fitHeadline(text, PHOTO_COLUMN, 300);
      const measured = await measureText(fitted.text, headlineStyle(PHOTO_COLUMN, fitted.fontSize));
      expect(measured.lines).toBe(fitted.lines);
      expect(fitted.height).toBe(measured.height);
      expect(measured.height).toBeLessThanOrEqual(300);
    }
  });

  it('elides rather than overflowing when even the floor size cannot fit', async () => {
    const fitted = await fitHeadline('a'.repeat(2000), PHOTO_COLUMN, 120);
    expect(fitted.text.endsWith('…')).toBe(true);
    expect(fitted.text.length).toBeLessThan(2000);
    expect(fitted.height).toBeLessThanOrEqual(120);
  });

  it('treats an empty headline as a zero-height block instead of dividing by zero', async () => {
    const fitted = await fitHeadline('', PHOTO_COLUMN, 446);
    expect(fitted.lines).toBe(0);
    expect(fitted.height).toBe(0);
  });

  it('scales up for the wider full-card column a photo-less headline gets', async () => {
    const narrow = await fitHeadline(MEDIUM, PHOTO_COLUMN, 300);
    const wide = await fitHeadline(MEDIUM, FULL_COLUMN, 300, FULL_BOUNDS);
    expect(wide.fontSize).toBeGreaterThan(narrow.fontSize);
  });
});

describe('fitCardText', () => {
  // Every one of these overflowed the card before the layout measured itself:
  // the estimator sized a block to fill exactly N lines and word wrapping made
  // it N+1, pushing the parody label off the bottom of the canvas.
  const CASES: [string, string | null][] = [
    [SHORT, '.382 AVG'],
    [MEDIUM, '.382 AVG / 41 HR / 108 RBI'],
    [LONG, '112 consecutive games / 4.1 WAR / 0 explanations offered by the front office'],
    [VERY_LONG, MAX_STAT],
    [MAX_HEADLINE, MAX_STAT],
    [MAX_HEADLINE, null],
    [LONG, null],
    ['Jays sign Guerrero to an unfathomablyoverwhelminglyenormous extension', '$500,000,000'],
  ];

  for (const [columnWidth, bounds, layout] of [
    [PHOTO_COLUMN, PHOTO_BOUNDS, 'beside a photo'],
    [FULL_COLUMN, FULL_BOUNDS, 'full width'],
  ] as const) {
    it(`keeps the headline and stat block inside the card's text budget (${layout})`, async () => {
      for (const [headline, stat_block] of CASES) {
        const fitted = await fitCardText(
          makeHeadline({ headline, stat_block }),
          columnWidth,
          bounds
        );
        // Re-measured from the text and size that will actually be rendered,
        // deliberately not trusting the heights fitCardText reported: a fitter
        // that scores its own work against its own estimate is how the previous
        // overflow survived a passing test suite.
        const title = await measureText(
          fitted.title.text,
          headlineStyle(columnWidth, fitted.title.fontSize)
        );
        const stat = fitted.stat
          ? await measureText(fitted.stat.text, statStyle(columnWidth, fitted.stat.fontSize))
          : { height: 0 };
        expect(title.height + stat.height).toBeLessThanOrEqual(TEXT_BUDGET);
        expect(textBlockHeight(fitted)).toBe(title.height + stat.height);
      }
    });
  }

  it('never lets the stat block starve the headline down to its floor', async () => {
    const fitted = await fitCardText(
      makeHeadline({ headline: MEDIUM, stat_block: MAX_STAT }),
      PHOTO_COLUMN,
      PHOTO_BOUNDS
    );
    expect(fitted.title.fontSize).toBeGreaterThan(PHOTO_BOUNDS.floor);
  });

  it('gives a headline with no stat block the whole budget', async () => {
    const withStat = await fitCardText(
      makeHeadline({ headline: LONG, stat_block: MAX_STAT }),
      PHOTO_COLUMN,
      PHOTO_BOUNDS
    );
    const withoutStat = await fitCardText(
      makeHeadline({ headline: LONG, stat_block: null }),
      PHOTO_COLUMN,
      PHOTO_BOUNDS
    );
    expect(withoutStat.stat).toBeNull();
    expect(withoutStat.title.fontSize).toBeGreaterThan(withStat.title.fontSize);
  });
});

describe("the card's vertical budget", () => {
  it('reserves exactly the height the parody label actually renders at', async () => {
    // TEXT_BUDGET is the card's content height minus this reservation, so a
    // label taller than the number reserved for it is not a rounding nit: it is
    // the whole line falling off the bottom edge of every preview.
    const { lines, height } = await measureText(PARODY_LABEL, labelStyle(FULL_COLUMN));
    expect(lines).toBe(1);
    expect(height).toBe(LABEL_TEXT_HEIGHT);
    expect(TEXT_BUDGET).toBe(CONTENT_HEIGHT - LABEL_MARGIN_TOP - height);
  });

  it('shrinks the headline/stat budget by the submitter credit reservation when one is passed', async () => {
    // renderOgPng passes TEXT_BUDGET - (SUBMITTER_MARGIN_TOP + LABEL_TEXT_HEIGHT)
    // for a headline carrying a submitter credit — asserted here directly on
    // fitCardText's optional textBudget param, the same seam renderOgPng uses,
    // so a change to that reservation is caught without rendering a full PNG.
    const submitterBudget = SUBMITTER_MARGIN_TOP + LABEL_TEXT_HEIGHT;
    const fitted = await fitCardText(
      makeHeadline({ headline: LONG, stat_block: MAX_STAT }),
      PHOTO_COLUMN,
      PHOTO_BOUNDS,
      TEXT_BUDGET - submitterBudget
    );
    expect(textBlockHeight(fitted)).toBeLessThanOrEqual(TEXT_BUDGET - submitterBudget);
  });
});

describe('submitterCreditFor', () => {
  it('mirrors the live card\'s "submitted by {name}" phrasing', () => {
    expect(submitterCreditFor('Jane')).toBe('submitted by Jane');
  });

  it('fits on a single line at the longest allowed submitter name', async () => {
    // SUBMITTER_NAME_MAX (submissionLimits.ts) is the longest name that can
    // reach a card without an admin hand-writing something longer — if the
    // credit line ever wraps to a second line at that length, the fixed
    // SUBMITTER_MARGIN_TOP + LABEL_TEXT_HEIGHT budget renderOgPng reserves for
    // it is wrong and the parody label gets pushed off the canvas.
    const longest = 'x'.repeat(SUBMITTER_NAME_MAX);
    const { lines, height } = await measureText(
      submitterCreditFor(longest),
      labelStyle(FULL_COLUMN)
    );
    expect(lines).toBe(1);
    expect(height).toBe(LABEL_TEXT_HEIGHT);
  });
});

describe('measureText', () => {
  const styleAt = (fontSize: number) => headlineStyle(PHOTO_COLUMN, fontSize);

  it('breaks a word too long for the column instead of running off the card', async () => {
    // Satori honours word-break but ignores overflow-wrap, so without the
    // former a single unbreakable token renders straight past the card's right
    // edge and off the canvas.
    const { width } = await measureText(
      'Jays sign Guerrero to an unfathomablyoverwhelminglyenormous extension',
      styleAt(44)
    );
    expect(width).toBeLessThanOrEqual(PHOTO_COLUMN);
  });

  it('counts the lines the text actually wraps into, not an estimate', async () => {
    // "Jays sweep Yankees" at 56px does not fit one line of a 532px column,
    // which is exactly the kind of miss a character-count estimate makes.
    expect((await measureText(SHORT, styleAt(56))).lines).toBe(2);
  });

  it('reports no lines for blank text', async () => {
    expect(await measureText('', styleAt(56))).toEqual({ lines: 0, width: 0, height: 0 });
    expect(await measureText('   ', styleAt(56))).toEqual({ lines: 0, width: 0, height: 0 });
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
