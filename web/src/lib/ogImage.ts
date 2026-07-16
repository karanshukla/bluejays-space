import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Headline } from './db';
import { getImage } from './storage';

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

// Content hash of the fields that affect the rendered image. An admin edit
// changes the hash, so the old cached PNG is never looked up again (an orphan
// swept by the general image-cleanup pass in docs/backend-api-plan.md item 3).
export function ogCacheKey(headline: Headline): string {
  const content = `${headline.headline}|${headline.stat_block ?? ''}|${headline.photo_ref ?? ''}`;
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

const CARD_WIDTH = 900;
const CARD_PADDING_X = 56;
const PHOTO_SIZE = 220;
const PHOTO_TEXT_GAP = 36;
// Explicit width, not just flexGrow: 1 — Satori's flex children default to
// not shrinking below their content's natural width (same as browsers' flex
// min-width:auto default), so without a hard width the headline text
// overflowed past the card's right edge instead of wrapping at the intended
// column width.
const TEXT_COLUMN_WIDTH = CARD_WIDTH - CARD_PADDING_X * 2 - PHOTO_SIZE - PHOTO_TEXT_GAP;

// Fetches the headline's photo and inlines it as a base64 PNG data URL so
// Satori (which renders standalone, no network access of its own) can place
// it as an <img> node. Re-encodes through sharp regardless of the stored
// format \u2014 Satori's image handling doesn't reliably decode webp (the format
// storeImageBytes normally produces), so passing the stored bytes straight
// through crashes the render. Pre-cropping to an exact square here also means
// the Satori tree doesn't need to lean on its (patchy) object-fit support.
// Returns null on any failure \u2014 a missing/unreadable/unrecognized photo must
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
      .resize(PHOTO_SIZE, PHOTO_SIZE, { fit: 'cover' })
      .png()
      .toBuffer();
    return `data:image/png;base64,${png.toString('base64')}`;
  } catch {
    return null;
  }
}

// Headline (+ optional stat block) text block. Smaller font size when it's
// sharing the row with a photo (narrower column) than when it has the full
// card width to itself.
function buildTextChildren(headline: Headline, headlineFontSize: number) {
  return [
    {
      type: 'p',
      props: {
        style: {
          fontSize: `${headlineFontSize}px`,
          fontWeight: 600,
          color: INK,
          lineHeight: 1.2,
          fontFamily: 'Fraunces',
        },
        children: headline.headline,
      },
    },
    headline.stat_block
      ? {
          type: 'p',
          props: {
            style: {
              fontSize: '22px',
              color: INK_SOFT,
              fontFamily: 'Space Mono',
              marginTop: '20px',
              paddingTop: '16px',
              borderTop: `2px dashed ${BLUE}66`,
            },
            children: headline.stat_block,
          },
        }
      : null,
  ].filter((c) => c !== null);
}

export async function renderOgPng(headline: Headline): Promise<Buffer> {
  const photoDataUrl = await loadPhotoDataUrl(headline.photo_ref);

  // With a photo: polaroid-style thumbnail on the left, headline/stat block
  // in a narrower column on the right \u2014 the layout most unfurl cards use.
  // Without one: the original full-width text block.
  const contentNode = photoDataUrl
    ? {
        type: 'div',
        props: {
          style: { display: 'flex', flexDirection: 'row', alignItems: 'flex-start' },
          children: [
            {
              type: 'img',
              props: {
                src: photoDataUrl,
                width: PHOTO_SIZE,
                height: PHOTO_SIZE,
                // No object-fit needed — loadPhotoDataUrl already pre-crops
                // to an exact PHOTO_SIZE×PHOTO_SIZE square via sharp.
                style: {
                  width: `${PHOTO_SIZE}px`,
                  height: `${PHOTO_SIZE}px`,
                  border: `3px solid ${CARD}`,
                  outline: `1px solid ${PAPER_EDGE}`,
                  boxShadow: '0 4px 10px rgba(20,33,61,0.25)',
                },
              },
            },
            {
              type: 'div',
              props: {
                style: {
                  display: 'flex',
                  flexDirection: 'column',
                  marginLeft: `${PHOTO_TEXT_GAP}px`,
                  width: `${TEXT_COLUMN_WIDTH}px`,
                },
                children: buildTextChildren(headline, 40),
              },
            },
          ],
        },
      }
    : {
        type: 'div',
        props: {
          style: { display: 'flex', flexDirection: 'column' },
          children: buildTextChildren(headline, 52),
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
          padding: '40px',
        },
        children: {
          type: 'div',
          props: {
            style: {
              display: 'flex',
              flexDirection: 'column',
              width: `${CARD_WIDTH}px`,
              padding: '64px 56px 48px',
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
              { type: 'div', props: { style: { height: '32px' } } },
              {
                type: 'p',
                props: {
                  style: {
                    fontSize: '18px',
                    color: `${INK_SOFT}99`,
                    fontFamily: 'Space Mono',
                    textAlign: 'center',
                  },
                  children: 'bluejays.space \u00B7 parody \u00B7 not affiliated with MLB',
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
          padding: '40px',
        },
        children: {
          type: 'div',
          props: {
            style: {
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              width: `${CARD_WIDTH}px`,
              padding: '84px 56px 56px',
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
                    fontSize: '72px',
                    fontWeight: 600,
                    color: INK,
                    fontFamily: 'Fraunces',
                    textAlign: 'center',
                  },
                  children: 'bluejays.space',
                },
              },
              { type: 'div', props: { style: { height: '28px' } } },
              {
                type: 'p',
                props: {
                  style: {
                    fontSize: '28px',
                    color: INK_SOFT,
                    fontFamily: 'Space Mono',
                    textAlign: 'center',
                  },
                  children: 'The best Blue Jays misinformation on the web',
                },
              },
              { type: 'div', props: { style: { height: '56px' } } },
              {
                type: 'p',
                props: {
                  style: {
                    fontSize: '18px',
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
