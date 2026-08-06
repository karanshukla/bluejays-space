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
const OG_LAYOUT_VERSION = 2;

// Content hash of the fields that affect the rendered image. An admin edit
// changes the hash, so the old cached PNG is never looked up again (an orphan
// swept by the general image-cleanup pass in docs/backend-api-plan.md item 3).
export function ogCacheKey(headline: Headline): string {
  const content = `v${OG_LAYOUT_VERSION}|${headline.headline}|${headline.stat_block ?? ''}|${headline.photo_ref ?? ''}`;
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

// Satori has no text measurement to auto-fit against, so the size is estimated
// from the character count: how big can this headline be and still fill no more
// than `maxLines` of a column this wide? Fraunces 600 averages a little over
// half its em per character in mixed-case text — the constant only has to be
// stable and err small, since a headline that renders a size down still reads
// fine while one that overflows the card does not.
const AVERAGE_GLYPH_RATIO = 0.52;

export function headlineFontSize(
  text: string,
  columnWidth: number,
  { maxLines, cap, floor }: { maxLines: number; cap: number; floor: number }
): number {
  if (!text.length) return cap;
  const fitted = (columnWidth * maxLines) / (text.length * AVERAGE_GLYPH_RATIO);
  return Math.max(floor, Math.min(cap, Math.round(fitted)));
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
// with nothing else competing for the space.
function buildTextChildren(headline: Headline, columnWidth: number, fontSize: number) {
  return [
    {
      type: 'p',
      props: {
        style: {
          fontSize: `${fontSize}px`,
          fontWeight: 600,
          color: INK,
          lineHeight: 1.18,
          fontFamily: 'Fraunces',
          width: `${columnWidth}px`,
        },
        children: headline.headline,
      },
    },
    headline.stat_block
      ? {
          type: 'p',
          props: {
            style: {
              fontSize: '30px',
              lineHeight: 1.35,
              color: INK_SOFT,
              fontFamily: 'Space Mono',
              marginTop: '28px',
              paddingTop: '22px',
              borderTop: `2px dashed ${BLUE}66`,
              width: `${columnWidth}px`,
            },
            children: headline.stat_block,
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

export async function renderOgPng(headline: Headline): Promise<Buffer> {
  const photoDataUrl = await loadPhotoDataUrl(headline.photo_ref);

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
                children: buildTextChildren(
                  headline,
                  TEXT_COLUMN_WIDTH,
                  headlineFontSize(headline.headline, TEXT_COLUMN_WIDTH, {
                    maxLines: 5,
                    cap: 56,
                    floor: 34,
                  })
                ),
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
          children: buildTextChildren(
            headline,
            FULL_WIDTH_TEXT_COLUMN,
            headlineFontSize(headline.headline, FULL_WIDTH_TEXT_COLUMN, {
              maxLines: 4,
              cap: 88,
              floor: 42,
            })
          ),
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
                    marginTop: '24px',
                  },
                  children: {
                    type: 'p',
                    props: {
                      style: {
                        fontSize: '20px',
                        color: `${INK_SOFT}99`,
                        fontFamily: 'Space Mono',
                      },
                      children: 'bluejays.space · parody · not affiliated with MLB',
                    },
                  },
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
