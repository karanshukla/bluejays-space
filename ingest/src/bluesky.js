// Bluesky — recent Blue Jays-related posts as generator candidate material.
// Uses @atproto/api (AtpAgent — BskyAgent is deprecated).
//
// One searchPosts call per query (hashtags + a couple of plain-phrase
// searches to catch untagged mentions) + dedupe by uri: the `tag` param is
// non-functional (bluesky-social/indigo#890) and boolean OR in the query string
// is unreliable (bluesky-social/atproto#3751), so neither is used — each query
// gets its own request instead.

import { AtpAgent } from '@atproto/api';

// Hashtags plus a couple of plain-phrase searches — widened from the original
// two hashtags to catch posts that mention the team without tagging it.
// Lucene-style `q`, so a bare phrase needs its own quoting (see searchQuery).
const SEARCH_QUERIES = [
  '#BlueJays',
  '#TorontoBluejays',
  '#GoJaysGo',
  '#BlueJaysBaseball',
  '"Toronto Blue Jays"',
];
const IMAGE_EMBED_TYPE = 'app.bsky.embed.images#view';

// Map a searchPosts response to a normalized post list. Pure function.
// `external_id` for dedup is the post uri.
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
      images: (embed.images ?? []).map((img) => ({
        fullsize: img.fullsize,
        alt: img.alt ?? '',
      })),
      createdMs: p.record?.createdAt ? Date.parse(p.record.createdAt) : null,
    };
  });
}

let cachedAgent = null;

// Login once per process; the app password authenticates read access.
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

// Run a single query (Lucene-style `q` — a hashtag or a quoted phrase),
// returning raw posts.
async function searchQuery(agent, query, sinceIso, limit) {
  const { data } = await agent.app.bsky.feed.searchPosts({
    q: query,
    since: sinceIso,
    limit,
  });
  return data;
}

// Fetch recent posts across all configured queries, deduped by uri. Returns
// [] on failure so a Bluesky outage doesn't abort the generation run.
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
    // Concatenate, then dedupe by uri (a post may match more than one query).
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
