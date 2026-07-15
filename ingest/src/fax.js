// FAX Sports (mlbonfax.com) — style/tone reference for the generator.
// Style-only: NEVER surfaced, credited, or linked on the live site (SPEC.md).
// Fetched as RSS (far less brittle than scraping Wix's generated HTML).

const FAX_FEED_URL = 'https://mlbonfax.com/blog-feed.xml';

function itemText(block, tag) {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`);
  const match = block.match(re);
  return match ? match[1].trim() : '';
}

export function parseFaxFeed(xml) {
  const itemMatches = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)];
  return itemMatches.map((m) => {
    const block = m[1];
    return {
      title: itemText(block, 'title'),
      excerpt: itemText(block, 'description'),
      link: itemText(block, 'link'),
      guid: itemText(block, 'guid'),
      pubDate: itemText(block, 'pubDate'),
    };
  });
}

export async function fetchFaxPosts(limit = 10) {
  const res = await fetch(FAX_FEED_URL, {
    headers: { 'User-Agent': 'bluejays-ingest/1.0 (style reference fetch)' },
  });
  if (!res.ok) {
    console.warn(`[fax] feed fetch failed: ${res.status}`);
    return [];
  }
  const xml = await res.text();
  const posts = parseFaxFeed(xml).slice(0, limit);
  console.log(`[fax] parsed ${posts.length} style-reference post(s)`);
  return posts;
}
