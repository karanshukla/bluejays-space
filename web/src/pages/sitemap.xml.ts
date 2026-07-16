import type { APIRoute } from 'astro';
import { getPublishedHeadlines } from '../lib/db';
import { getSiteUrl } from '../lib/site';

export const prerender = false;

export const GET: APIRoute = async () => {
  const origin = getSiteUrl().href.replace(/\/$/, '');
  const headlines = await getPublishedHeadlines();

  const urls = [`${origin}/`];
  for (const h of headlines) {
    urls.push(`${origin}/h/${h.id}`);
  }

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((loc) => `  <url><loc>${loc}</loc></url>`).join('\n')}
</urlset>
`;

  return new Response(body, {
    headers: { 'Content-Type': 'application/xml' },
  });
};
