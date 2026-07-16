import type { APIRoute } from 'astro';
import { getPublishedHeadlines } from '../lib/db';
import { getSiteUrl } from '../lib/site';
import { permalinkPath } from '../lib/slug';

export const prerender = false;

export const GET: APIRoute = async () => {
  const origin = getSiteUrl().href.replace(/\/$/, '');
  const headlines = await getPublishedHeadlines();

  const urls: { loc: string; lastmod?: string }[] = [{ loc: `${origin}/` }];
  for (const h of headlines) {
    urls.push({
      loc: `${origin}${permalinkPath(h.id, h.headline)}`,
      lastmod: h.published_at ?? undefined,
    });
  }

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    ({ loc, lastmod }) =>
      `  <url><loc>${loc}</loc>${lastmod ? `<lastmod>${new Date(lastmod).toISOString()}</lastmod>` : ''}</url>`
  )
  .join('\n')}
</urlset>
`;

  return new Response(body, {
    headers: { 'Content-Type': 'application/xml' },
  });
};
