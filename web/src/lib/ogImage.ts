import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Headline } from './db';

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

export async function renderOgPng(headline: Headline): Promise<Buffer> {
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
              width: '900px',
              padding: '64px 56px 48px',
              backgroundColor: CARD,
              border: `2px solid ${PAPER_EDGE}`,
              boxShadow: '4px 6px 0 rgba(20,33,61,0.12), 0 14px 36px -8px rgba(20,33,61,0.28)',
            },
            children: [
              // Washi tape pinned across the top — diagonal blue/white stripe,
              // same repeating-linear-gradient as the live .clipping::before.
              {
                type: 'div',
                props: {
                  style: {
                    position: 'absolute',
                    top: '-12px',
                    left: '60px',
                    width: '100px',
                    height: '28px',
                    backgroundImage: `repeating-linear-gradient(45deg, ${TAPE}, ${TAPE} 6px, white 6px, white 12px)`,
                    opacity: 0.94,
                    transform: 'rotate(-4deg)',
                  },
                },
              },
              {
                type: 'p',
                props: {
                  style: {
                    fontSize: '52px',
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
                        fontSize: '24px',
                        color: INK_SOFT,
                        fontFamily: 'Space Mono',
                        marginTop: '28px',
                        paddingTop: '20px',
                        borderTop: `2px dashed ${BLUE}66`,
                      },
                      children: headline.stat_block,
                    },
                  }
                : null,
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
            ].filter((c) => c !== null),
          },
        },
      },
    },
    { width: OG_WIDTH, height: OG_HEIGHT, fonts: loadFonts() }
  );

  return new Resvg(svg, { fitTo: { mode: 'width', value: OG_WIDTH } }).render().asPng();
}
