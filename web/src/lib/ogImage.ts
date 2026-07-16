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
          justifyContent: 'center',
          padding: '80px',
          backgroundColor: '#134a8e',
        },
        children: [
          {
            type: 'p',
            props: {
              style: {
                fontSize: '60px',
                fontWeight: 600,
                color: 'white',
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
                    fontSize: '26px',
                    color: 'rgba(255,255,255,0.8)',
                    fontFamily: 'Space Mono',
                    marginTop: '24px',
                  },
                  children: headline.stat_block,
                },
              }
            : null,
          {
            type: 'p',
            props: {
              style: {
                fontSize: '20px',
                color: 'rgba(255,255,255,0.55)',
                fontFamily: 'Space Mono',
                marginTop: 'auto',
              },
              children: 'bluejays.space \u00B7 parody \u00B7 not affiliated with MLB',
            },
          },
        ].filter((c) => c !== null),
      },
    },
    { width: OG_WIDTH, height: OG_HEIGHT, fonts: loadFonts() }
  );

  return new Resvg(svg, { fitTo: { mode: 'width', value: OG_WIDTH } }).render().asPng();
}
