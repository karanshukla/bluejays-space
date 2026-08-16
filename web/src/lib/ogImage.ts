import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Headline } from './db';
import { getImage } from './storage';
import { variantFor } from './cardVariants';

// Loaded once, reused across renders. Satori needs the raw font binary (TTF/
// OTF/WOFF, not woff2); @fontsource ships a .woff alongside the .woff2.
// Resolved from cwd (the project root in dev, /app in the Docker image) because
// the built server chunks live in dist/ and import.meta.url points there, not
// at the source tree where node_modules actually sits.
let fontsCache: { name: string; data: Buffer; weight: 400 | 600; style: 'normal' }[] | undefined;

function loadFonts() {
  if (fontsCache) return fontsCache;
  const files = join(process.cwd(), 'node_modules/@fontsource');
  fontsCache = [
    {
      name: 'Fraunces',
      data: readFileSync(join(files, 'fraunces/files/fraunces-latin-600-normal.woff')),
      weight: 600 as const,
      style: 'normal' as const,
    },
    {
      name: 'Space Mono',
      data: readFileSync(join(files, 'space-mono/files/space-mono-latin-400-normal.woff')),
      weight: 400 as const,
      style: 'normal' as const,
    },
  ];
  return fontsCache;
}

const OG_WIDTH = 1200;
const OG_HEIGHT = 630;

// Bump when the layout below changes. Rendered PNGs are stored under a
// content-hash key and served back with a one-year immutable cache, so without
// this a redesign would only ever reach headlines created after it shipped —
// every existing preview would keep serving its old bytes forever.
const OG_LAYOUT_VERSION = 3;

// Content hash of the fields that affect the rendered image. An admin edit
// changes the hash, so the old cached PNG is never looked up again (an orphan
// swept by the general image-cleanup pass in docs/backend-api-plan.md item 3).
export function ogCacheKey(headline: Headline): string {
  const content = `v${OG_LAYOUT_VERSION}|${headline.headline}|${headline.stat_block ?? ''}|${headline.photo_ref ?? ''}|${headline.submitter_name ?? ''}`;
  const hash = createHash('sha256').update(content).digest('hex').slice(0, 12);
  return `og/${headline.id}-${hash}.png`;
}

// Palette tokens mirrored from web/src/styles/global.css so the OG card reads
// as the same scrapbook aesthetic as the live feed card.
const PAPER = '#eef3fb';
const CARD = '#ffffff';
const INK = '#14213d';
const INK_SOFT = '#3d5578';
const PAPER_EDGE = '#b8cbe8';
const BLUE = '#134a8e';
const TAPE = '#1e4d8c';
const TAPE_ALT = '#c8102e';

// Mirrors the six washi-tape variants in global.css (.tape-a..f), keyed the
// same way as the feed card (HeadlineCard.astro: id % 6) so a headline's OG
// preview wears the same tape color/pattern its card does. a/b blue stripe,
// c/f red stripe, d solid blue, e solid red — an even blue/red mix with two
// solid strips for variety, rather than every preview identical blue.
export function tapeBackgroundFor(id: number): string {
  switch (id % 6) {
    case 2: // tape-c
    case 5: // tape-f
      return `repeating-linear-gradient(45deg, ${TAPE_ALT}, ${TAPE_ALT} 6px, white 6px, white 12px)`;
    case 3: // tape-d, solid blue
      return TAPE;
    case 4: // tape-e, solid red
      return TAPE_ALT;
    default: // tape-a, tape-b, blue stripe
      return `repeating-linear-gradient(45deg, ${TAPE}, ${TAPE} 6px, white 6px, white 12px)`;
  }
}

// Card fills almost the whole canvas (a slim margin, not the large gutter the
// original 900px card left) so the headline/photo read as the dominant
// content instead of a small island of text in a sea of paper background.
const OUTER_PADDING = 24;
const CARD_WIDTH = OG_WIDTH - OUTER_PADDING * 2;
const CARD_HEIGHT = OG_HEIGHT - OUTER_PADDING * 2;
const CARD_PADDING_X = 56;
const CARD_PADDING_Y = 44;

// The photo is the thing that stops a share looking like a wall of text, so it
// gets a third of the card's width at the feed card's own 4:3 rather than the
// small square it used to be. Mounted like the live card's polaroid: white
// border, wider at the bottom, tilted, taped down.
const PHOTO_WIDTH = 440;
const PHOTO_HEIGHT = 330;
const MOUNT_BORDER = 14;
const MOUNT_BORDER_BOTTOM = 26;
const MOUNT_WIDTH = PHOTO_WIDTH + MOUNT_BORDER * 2;
const PHOTO_TEXT_GAP = 40;

// Explicit width, not just flexGrow: 1 — Satori's flex children default to
// not shrinking below their content's natural width (same as browsers' flex
// min-width:auto default), so without a hard width the headline text
// overflowed past the card's right edge instead of wrapping at the intended
// column width.
const TEXT_COLUMN_WIDTH = CARD_WIDTH - CARD_PADDING_X * 2 - MOUNT_WIDTH - PHOTO_TEXT_GAP;
const FULL_WIDTH_TEXT_COLUMN = CARD_WIDTH - CARD_PADDING_X * 2;

// Mirrors the live card's per-headline photo tilt (.mount-a..g in global.css),
// drawn with the same seed so a headline's preview leans the way its card does.
const MOUNT_TILT_SEED = 1;
const MOUNT_TILTS = [-1.7, 1.3, -0.7, 2, -1.1, 0.6, -2];

export function photoTiltFor(id: number): number {
  return variantFor(id, MOUNT_TILTS, MOUNT_TILT_SEED);
}

// Vertical budget the headline and stat block have to share. The parody label
// is pinned to the card's bottom edge, so whatever the two text blocks take
// beyond this pushes it off the canvas — Satori clips nothing and Yoga's
// flex-shrink defaults to 0, so an over-tall content block is not squeezed, it
// simply overflows.
export const PARODY_LABEL = 'bluejays.space · parody · not affiliated with MLB';
const LABEL_FONT_SIZE = 20;
const LABEL_LINE_HEIGHT = 1.2;
export const LABEL_MARGIN_TOP = 24;
// The label is one line at a fixed size, so unlike the two variable blocks its
// height is a constant rather than something measured per render. The test suite
// measures it once and asserts this matches, since a budget derived from a wrong
// label height is exactly how the parody line got pushed off the card before.
export const LABEL_TEXT_HEIGHT = Math.round(LABEL_FONT_SIZE * LABEL_LINE_HEIGHT);
export const CONTENT_HEIGHT = CARD_HEIGHT - CARD_PADDING_Y * 2;
export const TEXT_BUDGET = CONTENT_HEIGHT - LABEL_MARGIN_TOP - LABEL_TEXT_HEIGHT;

// Mirrors HeadlineCard.astro's "submitted by {name}" credit so a submission's
// preview carries the same attribution its live card does. Same font/line-height
// as the parody label, so it reuses LABEL_TEXT_HEIGHT rather than a constant of
// its own; SUBMITTER_NAME_MAX (40 chars, submissionLimits.ts) keeps the prefixed
// string comfortably inside one line at the label's full-card column width — see
// the "fits on one line" test in ogImage.test.ts, which is what actually pins this.
export function submitterCreditFor(name: string): string {
  return `submitted by ${name}`;
}
export const SUBMITTER_MARGIN_TOP = 10;

const HEADLINE_LINE_HEIGHT = 1.18;
const STAT_LINE_HEIGHT = 1.35;
const STAT_MARGIN_TOP = 28;
const STAT_PADDING_TOP = 22;
const STAT_RULE_WIDTH = 2;

// The headline is what a share is read for, so the stat block is capped at a
// share of the budget rather than being allowed to take whatever it wants and
// squeeze the headline down to the floor behind it.
const STAT_BUDGET_SHARE = 0.4;
const STAT_BUDGET = Math.floor(TEXT_BUDGET * STAT_BUDGET_SHARE);
const STAT_FONT_CAP = 30;
const STAT_FONT_FLOOR = 18;

// Tall enough that no measured block is ever clipped by the probe canvas: at
// the smallest floor above this is well over a hundred lines.
const MEASURE_CANVAS_HEIGHT = 4000;

// Satori honours `word-break` but ignores `overflow-wrap`, so this is the only
// way to stop a single unbreakable token (a long URL, a joke compound word)
// running straight off the right edge of the card.
const WORD_BREAK = 'break-word' as const;

interface TextBlockStyle {
  columnWidth: number;
  fontSize: number;
  fontFamily: 'Fraunces' | 'Space Mono';
  fontWeight: 400 | 600;
  lineHeight: number;
  marginTop?: number;
  paddingTop?: number;
  borderTopWidth?: number;
}

// The single source of every property that decides how a text block is laid out.
// The measurement pass and the real render both build their node from this, so a
// measured height is the height that actually renders — there is no second model
// to drift out of step.
//
// The explicit margin matters more than it looks: Satori gives <p> the browser
// default 1em vertical margin (16px top and bottom, regardless of the element's
// own font size), which silently adds 32px to a block nothing here would expect.
// The border is split into longhands so the render can add only its colour
// without a shorthand overwriting the width this measured.
function textNodeStyle(style: TextBlockStyle) {
  return {
    fontSize: `${style.fontSize}px`,
    fontFamily: style.fontFamily,
    fontWeight: style.fontWeight,
    lineHeight: style.lineHeight,
    margin: `${style.marginTop ?? 0}px 0px 0px 0px`,
    paddingTop: `${style.paddingTop ?? 0}px`,
    borderTopWidth: `${style.borderTopWidth ?? 0}px`,
    borderTopStyle: 'dashed',
    width: `${style.columnWidth}px`,
    wordBreak: WORD_BREAK,
  };
}

// Satori exposes no text-measurement API, and a character-count estimate cannot
// stand in for one: word wrapping leaves a ragged right edge on every line, so a
// block sized to fill "exactly N lines" on paper reliably renders N+1 and runs
// off the card.
//
// Rendering the block on its own instead gives all three numbers directly. With
// embedFont:false Satori emits one <text> per word carrying its own x/y/width
// (so, line count and horizontal extent), and the wrapper's background rect
// carries the block's full laid-out height, margins and padding and border
// included.
export async function measureText(
  text: string,
  style: TextBlockStyle
): Promise<{ lines: number; width: number; height: number }> {
  if (!text.trim()) return { lines: 0, width: 0, height: 0 };
  const svg = await satori(
    {
      type: 'div',
      props: {
        style: { display: 'flex', width: `${style.columnWidth}px`, backgroundColor: '#000' },
        children: { type: 'p', props: { style: textNodeStyle(style), children: text } },
      },
    },
    {
      width: style.columnWidth,
      height: MEASURE_CANVAS_HEIGHT,
      fonts: loadFonts(),
      embedFont: false,
    }
  );
  const runs = [
    ...svg.matchAll(/<text[^>]*\sx="(-?[\d.]+)"[^>]*\sy="([\d.]+)"[^>]*\swidth="([\d.]+)"/g),
  ];
  return {
    lines: new Set(runs.map((run) => run[2])).size,
    width: Math.max(0, ...runs.map((run) => Number(run[1]) + Number(run[3]))),
    height: Number(svg.match(/<rect[^>]*\sheight="([\d.]+)"/)?.[1] ?? 0),
  };
}

export interface FittedText {
  text: string;
  fontSize: number;
  lines: number;
  height: number;
}

// Longest prefix whose rendered block still fits `maxHeight`. Only reached when
// a block overflows even at its floor size — a headline long enough to need this
// is an essay, and a clipped preview reads far worse than an elided one.
async function truncateToHeight(
  text: string,
  maxHeight: number,
  style: TextBlockStyle
): Promise<string> {
  let fits = 0;
  let tooLong = text.length;
  while (fits < tooLong) {
    const mid = Math.ceil((fits + tooLong) / 2);
    const candidate = `${text.slice(0, mid).trimEnd()}…`;
    if ((await measureText(candidate, style)).height <= maxHeight) fits = mid;
    else tooLong = mid - 1;
  }
  return `${text.slice(0, fits).trimEnd()}…`;
}

// The two blocks a card carries, each described once so the fitting pass and
// the render agree on every property that decides how they wrap.
export function headlineStyle(columnWidth: number, fontSize: number): TextBlockStyle {
  return {
    columnWidth,
    fontSize,
    fontFamily: 'Fraunces',
    fontWeight: 600,
    lineHeight: HEADLINE_LINE_HEIGHT,
  };
}

// Carries its own chrome (the gap above it and the dashed rule it sits behind)
// so a measured stat block height is the whole block, not just its text.
export function labelStyle(columnWidth: number): TextBlockStyle {
  return {
    columnWidth,
    fontSize: LABEL_FONT_SIZE,
    fontFamily: 'Space Mono',
    fontWeight: 400,
    lineHeight: LABEL_LINE_HEIGHT,
  };
}

// Satori rejects an explicitly-undefined style property, so the label's width is
// dropped by destructuring rather than overwritten.
const { width: _labelColumnWidth, ...labelNodeStyle } = textNodeStyle(
  labelStyle(FULL_WIDTH_TEXT_COLUMN)
);

export function statStyle(columnWidth: number, fontSize: number): TextBlockStyle {
  return {
    columnWidth,
    fontSize,
    fontFamily: 'Space Mono',
    fontWeight: 400,
    lineHeight: STAT_LINE_HEIGHT,
    marginTop: STAT_MARGIN_TOP,
    paddingTop: STAT_PADDING_TOP,
    borderTopWidth: STAT_RULE_WIDTH,
  };
}

// Largest size in [floor, cap] whose measured block fits `maxHeight`. Line count
// (and so block height) rises monotonically with font size, which is what makes
// the binary search valid — and what makes this cost ~6 probe renders rather
// than one per candidate size.
export async function fitText(
  text: string,
  styleAt: (fontSize: number) => TextBlockStyle,
  { maxHeight, cap, floor }: { maxHeight: number; cap: number; floor: number }
): Promise<FittedText> {
  if (!text.trim()) return { text, fontSize: cap, lines: 0, height: 0 };

  let smallest = floor;
  let largest = cap;
  let best: FittedText | null = null;
  while (smallest <= largest) {
    const fontSize = Math.floor((smallest + largest) / 2);
    const { lines, height } = await measureText(text, styleAt(fontSize));
    if (height <= maxHeight) {
      best = { text, fontSize, lines, height };
      smallest = fontSize + 1;
    } else {
      largest = fontSize - 1;
    }
  }
  if (best) return best;

  const style = styleAt(floor);
  const truncated = await truncateToHeight(text, maxHeight, style);
  const { lines, height } = await measureText(truncated, style);
  return { text: truncated, fontSize: floor, lines, height };
}

// Stat block first: it is bounded to a share of the budget regardless of the
// headline, and the headline then gets everything it leaves behind. Fitting the
// headline first would let a two-word headline at cap size starve a stat block
// that had room to render at full size.
export async function fitCardText(
  headline: Headline,
  columnWidth: number,
  { cap, floor }: { cap: number; floor: number },
  textBudget: number = TEXT_BUDGET
): Promise<{ title: FittedText; stat: FittedText | null }> {
  const stat = headline.stat_block
    ? await fitText(headline.stat_block, (fontSize) => statStyle(columnWidth, fontSize), {
        maxHeight: STAT_BUDGET,
        cap: STAT_FONT_CAP,
        floor: STAT_FONT_FLOOR,
      })
    : null;

  const title = await fitText(
    headline.headline,
    (fontSize) => headlineStyle(columnWidth, fontSize),
    { maxHeight: textBudget - (stat?.height ?? 0), cap, floor }
  );

  return { title, stat };
}

// Total laid-out height of the two text blocks, for the tests that assert a
// rendered card never pushes the parody label off the bottom edge.
export function textBlockHeight({
  title,
  stat,
}: {
  title: FittedText;
  stat: FittedText | null;
}): number {
  return title.height + (stat?.height ?? 0);
}

// Fetches the headline's photo and inlines it as a base64 PNG data URL so
// Satori (which renders standalone, no network access of its own) can place
// it as an <img> node. Re-encodes through sharp regardless of the stored
// format — Satori's image handling doesn't reliably decode webp (the format
// storeImageBytes normally produces), so passing the stored bytes straight
// through crashes the render. Pre-cropping to the mount's exact pixel size here
// also means the Satori tree doesn't need to lean on its (patchy) object-fit
// support.
// Returns null on any failure — a missing/unreadable/unrecognized photo must
// degrade to the text-only layout, never break the render (same "never break
// a crawler's unfurl" rule the route itself already follows).
export async function loadPhotoDataUrl(photoRef: string | null): Promise<string | null> {
  if (!photoRef) return null;
  try {
    const image = await getImage(photoRef);
    if (!image) return null;
    const chunks: Buffer[] = [];
    for await (const chunk of image.body) chunks.push(chunk as Buffer);
    const png = await sharp(Buffer.concat(chunks))
      .resize(PHOTO_WIDTH, PHOTO_HEIGHT, { fit: 'cover' })
      .png()
      .toBuffer();
    return `data:image/png;base64,${png.toString('base64')}`;
  } catch {
    return null;
  }
}

// Headline first and largest, stat line directly under it behind the same
// dashed rule the live card uses — the two things a share is actually read for,
// with nothing else competing for the space. Both sizes come from fitCardText,
// which measured them against the card's real vertical budget.
function buildTextChildren(
  { title, stat }: { title: FittedText; stat: FittedText | null },
  columnWidth: number
) {
  return [
    {
      type: 'p',
      props: {
        style: { ...textNodeStyle(headlineStyle(columnWidth, title.fontSize)), color: INK },
        children: title.text,
      },
    },
    stat && stat.lines > 0
      ? {
          type: 'p',
          props: {
            style: {
              ...textNodeStyle(statStyle(columnWidth, stat.fontSize)),
              color: INK_SOFT,
              borderTopColor: `${BLUE}66`,
            },
            children: stat.text,
          },
        }
      : null,
  ].filter((c) => c !== null);
}

// The photo as it sits on the live card: white polaroid border (deeper at the
// bottom), a hairline paper edge, a drop shadow, tilted a degree or two, with
// its own strip of tape across the top.
function buildPhotoMount(photoDataUrl: string, id: number) {
  return {
    type: 'div',
    props: {
      style: {
        display: 'flex',
        position: 'relative',
        padding: `${MOUNT_BORDER}px ${MOUNT_BORDER}px ${MOUNT_BORDER_BOTTOM}px`,
        backgroundColor: CARD,
        border: `1px solid ${PAPER_EDGE}`,
        boxShadow: '0 6px 16px -4px rgba(20,33,61,0.35)',
        transform: `rotate(${photoTiltFor(id)}deg)`,
      },
      children: [
        {
          type: 'img',
          props: {
            src: photoDataUrl,
            width: PHOTO_WIDTH,
            height: PHOTO_HEIGHT,
            // No object-fit needed — loadPhotoDataUrl already pre-crops to
            // exactly PHOTO_WIDTH × PHOTO_HEIGHT via sharp.
            style: { width: `${PHOTO_WIDTH}px`, height: `${PHOTO_HEIGHT}px` },
          },
        },
        {
          type: 'div',
          props: {
            style: {
              position: 'absolute',
              top: '-13px',
              left: '155px',
              width: '110px',
              height: '28px',
              // Offset id so the print's tape isn't off the same roll as the
              // strip holding the card down behind it.
              backgroundImage: tapeBackgroundFor(id + 3),
              opacity: 0.92,
              transform: 'rotate(3deg)',
            },
          },
        },
      ],
    },
  };
}

// Size bounds per layout. The floors are what a preview drops to before text
// gets elided, so they sit at the smallest size still comfortably readable in a
// 1200×630 unfurl rather than at the largest size that usually works.
const PHOTO_HEADLINE_BOUNDS = { cap: 56, floor: 30 };
const FULL_WIDTH_HEADLINE_BOUNDS = { cap: 88, floor: 34 };

export async function renderOgPng(headline: Headline): Promise<Buffer> {
  const photoDataUrl = await loadPhotoDataUrl(headline.photo_ref);
  const columnWidth = photoDataUrl ? TEXT_COLUMN_WIDTH : FULL_WIDTH_TEXT_COLUMN;
  const submitterLine = headline.submitter_name
    ? submitterCreditFor(headline.submitter_name)
    : null;
  const submitterBudget = submitterLine ? SUBMITTER_MARGIN_TOP + LABEL_TEXT_HEIGHT : 0;
  const fitted = await fitCardText(
    headline,
    columnWidth,
    photoDataUrl ? PHOTO_HEADLINE_BOUNDS : FULL_WIDTH_HEADLINE_BOUNDS,
    TEXT_BUDGET - submitterBudget
  );

  // With a photo: the mounted print on the left at a third of the card's width,
  // headline and stat line in a column beside it, the two centred against each
  // other so neither dangles. Without one: the headline takes the full card
  // width and scales up into the space the photo would have used.
  const contentNode = photoDataUrl
    ? {
        type: 'div',
        props: {
          style: {
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            flexGrow: 1,
          },
          children: [
            buildPhotoMount(photoDataUrl, headline.id),
            {
              type: 'div',
              props: {
                style: {
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'center',
                  marginLeft: `${PHOTO_TEXT_GAP}px`,
                  width: `${TEXT_COLUMN_WIDTH}px`,
                },
                children: buildTextChildren(fitted, TEXT_COLUMN_WIDTH),
              },
            },
          ],
        },
      }
    : {
        type: 'div',
        props: {
          style: {
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            flexGrow: 1,
          },
          children: buildTextChildren(fitted, FULL_WIDTH_TEXT_COLUMN),
        },
      };

  const svg = await satori(
    {
      type: 'div',
      props: {
        style: {
          width: `${OG_WIDTH}px`,
          height: `${OG_HEIGHT}px`,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: PAPER,
          padding: `${OUTER_PADDING}px`,
        },
        children: {
          type: 'div',
          props: {
            style: {
              display: 'flex',
              flexDirection: 'column',
              width: `${CARD_WIDTH}px`,
              height: `${CARD_HEIGHT}px`,
              padding: `${CARD_PADDING_Y}px ${CARD_PADDING_X}px`,
              backgroundColor: CARD,
              border: `2px solid ${PAPER_EDGE}`,
              boxShadow: '4px 6px 0 rgba(20,33,61,0.12), 0 14px 36px -8px rgba(20,33,61,0.28)',
            },
            children: [
              {
                type: 'div',
                props: {
                  style: {
                    position: 'absolute',
                    top: '-12px',
                    left: '60px',
                    width: '100px',
                    height: '28px',
                    backgroundImage: tapeBackgroundFor(headline.id),
                    opacity: 0.94,
                    transform: 'rotate(-4deg)',
                  },
                },
              },
              contentNode,
              submitterLine && {
                type: 'div',
                props: {
                  style: {
                    display: 'flex',
                    justifyContent: 'center',
                    width: `${FULL_WIDTH_TEXT_COLUMN}px`,
                    marginTop: `${SUBMITTER_MARGIN_TOP}px`,
                  },
                  children: {
                    type: 'p',
                    props: {
                      style: { ...labelNodeStyle, color: `${INK_SOFT}CC` },
                      children: submitterLine,
                    },
                  },
                },
              },
              // flexGrow on the content block pins the label to the card's
              // bottom edge, so it sits in the same place on every preview
              // instead of floating with the headline's length. Centred by a
              // flex wrapper rather than textAlign, which Satori ignores on a
              // block whose width it derived from the text itself.
              {
                type: 'div',
                props: {
                  style: {
                    display: 'flex',
                    justifyContent: 'center',
                    width: `${FULL_WIDTH_TEXT_COLUMN}px`,
                    marginTop: `${LABEL_MARGIN_TOP}px`,
                  },
                  children: {
                    type: 'p',
                    props: {
                      // The same shared style the budget's label height is
                      // measured from, minus its fixed column width: the label
                      // sizes to its own text inside the centring wrapper above.
                      style: { ...labelNodeStyle, color: `${INK_SOFT}99` },
                      children: PARODY_LABEL,
                    },
                  },
                },
              },
            ].filter(Boolean),
          },
        },
      },
    },
    { width: OG_WIDTH, height: OG_HEIGHT, fonts: loadFonts() }
  );

  return new Resvg(svg, { fitTo: { mode: 'width', value: OG_WIDTH } }).render().asPng();
}

// Renders the static site-wide fallback (public/og-default.png) — used for
// the homepage's og:image and whenever a per-headline render fails. Same
// scrapbook look (tape, card, Fraunces/Space Mono) as the live site, so a
// generic share never looks like a different, unstyled product. Not called
// at runtime: this is a one-off asset generator. To regenerate after a design
// tweak, call it from a throwaway vitest test (writeFileSync the result to
// public/og-default.png) — see git history for the pattern, no permanent
// script exists since this asset changes rarely.
export async function renderDefaultOgPng(): Promise<Buffer> {
  const svg = await satori(
    {
      type: 'div',
      props: {
        style: {
          width: `${OG_WIDTH}px`,
          height: `${OG_HEIGHT}px`,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: PAPER,
          padding: `${OUTER_PADDING}px`,
        },
        children: {
          type: 'div',
          props: {
            style: {
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              width: `${CARD_WIDTH}px`,
              height: `${CARD_HEIGHT}px`,
              padding: `48px ${CARD_PADDING_X}px`,
              backgroundColor: CARD,
              border: `2px solid ${PAPER_EDGE}`,
              boxShadow: '4px 6px 0 rgba(20,33,61,0.12), 0 14px 36px -8px rgba(20,33,61,0.28)',
            },
            children: [
              {
                type: 'div',
                props: {
                  style: {
                    position: 'absolute',
                    top: '-12px',
                    left: '60px',
                    width: '100px',
                    height: '28px',
                    backgroundImage: tapeBackgroundFor(0),
                    opacity: 0.94,
                    transform: 'rotate(-4deg)',
                  },
                },
              },
              {
                type: 'p',
                props: {
                  style: {
                    fontSize: '96px',
                    fontWeight: 600,
                    color: INK,
                    fontFamily: 'Fraunces',
                    textAlign: 'center',
                  },
                  children: 'bluejays.space',
                },
              },
              { type: 'div', props: { style: { height: '32px' } } },
              {
                type: 'p',
                props: {
                  style: {
                    fontSize: '34px',
                    color: INK_SOFT,
                    fontFamily: 'Space Mono',
                    textAlign: 'center',
                  },
                  children: 'The best Blue Jays misinformation on the web',
                },
              },
              { type: 'div', props: { style: { height: '64px' } } },
              {
                type: 'p',
                props: {
                  style: {
                    fontSize: '20px',
                    color: `${INK_SOFT}99`,
                    fontFamily: 'Space Mono',
                    textAlign: 'center',
                  },
                  children: 'Parody · not affiliated with MLB or the Toronto Blue Jays',
                },
              },
            ],
          },
        },
      },
    },
    { width: OG_WIDTH, height: OG_HEIGHT, fonts: loadFonts() }
  );

  return new Resvg(svg, { fitTo: { mode: 'width', value: OG_WIDTH } }).render().asPng();
}
