import type { APIRoute } from 'astro';
import rss from '@astrojs/rss';
import { getRecentPublishedHeadlines } from '../lib/db';
import { getSiteUrl } from '../lib/site';
import { permalinkPath } from '../lib/slug';

export const prerender = false;

export const GET: APIRoute = async () => {
  const headlines = await getRecentPublishedHeadlines(50);

  return rss({
    title: 'bluejays.space',
    description: 'Parody Blue Jays headlines. Not affiliated with MLB or the Toronto Blue Jays.',
    site: getSiteUrl(),
    items: headlines.map((h) => ({
      title: h.headline,
      pubDate: h.published_at ? new Date(h.published_at) : undefined,
      link: permalinkPath(h.id, h.headline),
      description: h.stat_block ?? undefined,
    })),
  });
};
