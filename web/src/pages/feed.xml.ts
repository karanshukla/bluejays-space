import type { APIContext } from 'astro';
import rss from '@astrojs/rss';
import { getRecentPublishedHeadlines } from '../lib/db';

export const prerender = false;

export async function GET(context: APIContext) {
  const headlines = await getRecentPublishedHeadlines(50);

  return rss({
    title: 'bluejays.space',
    description: 'Parody Blue Jays headlines. Not affiliated with MLB or the Toronto Blue Jays.',
    site: context.site ?? 'http://localhost:4321',
    items: headlines.map((h) => ({
      title: h.headline,
      pubDate: h.published_at ? new Date(h.published_at) : undefined,
      link: `/h/${h.id}`,
      description: h.stat_block ?? undefined,
    })),
  });
}
