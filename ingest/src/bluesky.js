// Bluesky — recent Blue Jays-related posts as generator candidate material.
// One searchPosts call per query (the `tag` param is broken and boolean OR in
// the query string is unreliable, so each hashtag/phrase gets its own request)
// then dedupe by uri.

import { AtpAgent } from '@atproto/api';

// Hashtags plus a couple of plain-phrase searches to catch untagged mentions.
const SEARCH_QUERIES = [
  '#BlueJays',
  '#TorontoBluejays',
  '#GoJaysGo',
  '#BlueJaysBaseball',
  '"Toronto Blue Jays"',
];
const IMAGE_EMBED_TYPE = 'app.bsky.embed.images#view';

// external_id for dedup is the post uri.
export function extractBlueskyPosts(data) {
  const posts = data?.posts ?? [];
  return posts.map((p) => {
    const embed = p.embed?.$type === IMAGE_EMBED_TYPE ? p.embed : { images: [] };
    return {
      source: 'bluesky',
      external_id: p.uri,
      cid: p.cid ?? null,
      text: p.record?.text ?? '',
      authorHandle: p.author?.handle ?? '',
      images: (embed.images ?? []).map((img) => ({ fullsize: img.fullsize, alt: img.alt ?? '' })),
      createdMs: p.record?.createdAt ? Date.parse(p.record.createdAt) : null,
    };
  });
}

let cachedAgent = null;

async function getAgent() {
  if (cachedAgent) return cachedAgent;
  const identifier = process.env.BLUESKY_IDENTIFIER;
  const password = process.env.BLUESKY_APP_PASSWORD;
  if (!identifier || !password) {
    throw new Error('[bluesky] BLUESKY_IDENTIFIER / BLUESKY_APP_PASSWORD not set');
  }
  const agent = new AtpAgent({ service: 'https://bsky.social' });
  await agent.login({ identifier, password });
  cachedAgent = agent;
  return agent;
}

async function searchQuery(agent, query, sinceIso, limit) {
  const { data } = await agent.app.bsky.feed.searchPosts({ q: query, since: sinceIso, limit });
  return data;
}

export async function fetchBlueskyPosts(limit = 25) {
  if (!process.env.BLUESKY_IDENTIFIER || !process.env.BLUESKY_APP_PASSWORD) {
    console.log('[bluesky] credentials not set, skipping');
    return [];
  }
  try {
    const agent = await getAgent();
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const results = await Promise.all(
      SEARCH_QUERIES.map((query) => searchQuery(agent, query, since, limit))
    );
    const seen = new Set();
    const posts = [];
    for (const data of results) {
      for (const post of extractBlueskyPosts(data)) {
        if (post.external_id && !seen.has(post.external_id)) {
          seen.add(post.external_id);
          posts.push(post);
        }
      }
    }
    console.log(`[bluesky] fetched ${posts.length} deduped post(s)`);
    return posts;
  } catch (err) {
    console.warn(`[bluesky] fetch failed: ${err.message}`);
    return [];
  }
}
