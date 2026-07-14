// FAX Sports (mlbonfax.com) — live style/tone reference for the generator.
//
// This content feeds the generation prompt to calibrate register-2 deadpan
// voice; it is NEVER surfaced, credited, or linked on the live site (per
// SPEC.md). Fetched as RSS (confirmed at /blog-feed.xml, RSS 2.0, CDATA-wrapped
// items) — far less brittle than scraping Wix's generated HTML.

const FAX_FEED_URL = 'https://mlbonfax.com/blog-feed.xml';

// Extract the inner text of a tag within a single <item> block, tolerating
// CDATA wrapping and missing tags. `tag` is the element name (no namespace
// prefix); returns '' if absent.
function itemText(block, tag) {
  // Match <tag>...</tag> or <tag attr="...">...</tag>, with optional CDATA.
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`);
  const match = block.match(re);
  return match ? match[1].trim() : '';
}

// Parse the FAX RSS feed into a list of style-reference posts.
// Pure function — no network — so it's unit-testable with a fixture string.
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

// Fetch + parse. Returns [] on failure so a FAX outage doesn't abort the run —
// it's a style reference, not a structural input.
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
