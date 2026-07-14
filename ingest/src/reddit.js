// Reddit — fetch recent r/Torontobluejays posts as generator candidate material.
//
// Plain OAuth2 client-credentials grant over native fetch — no PRAW (that's
// Python-only; ingest is Node). Reddit blocks generic/missing User-Agents, so
// a descriptive one is mandatory. Free-tier budget is ~100 req/min — the single
// fetch-per-run pattern here stays well under it, but the rate-limit headers
// are logged so a future per-comment fetch won't silently get throttled.

const REDDIT_TOKEN_URL = 'https://www.reddit.com/api/v1/access_token';
const REDDIT_API_BASE = 'https://oauth.reddit.com';
const SUBREDDIT = 'Torontobluejays';

function userAgent() {
  // Reddit requires a descriptive UA; generic ones get 403'd.
  const id = process.env.REDDIT_CLIENT_ID || 'bluejays-ingest';
  return `node:${id}:1.0.0 (by /u/bluejays-ingest)`;
}

// Map a Reddit listing JSON response to a normalized post list. Pure function
// — call with a mocked `data.children` payload in tests.
// `external_id` for dedup is the fullname (data.name, e.g. "t3_abc123").
export function extractRedditPosts(listing) {
  const children = listing?.data?.children ?? [];
  return children
    .filter((c) => c?.kind === 't3' && c?.data)
    .map(({ data: d }) => ({
      source: 'reddit',
      external_id: d.name, // fullname — canonical dedup key
      id: d.id,
      title: d.title ?? '',
      selftext: d.selftext ?? '',
      permalink: d.permalink ? `https://www.reddit.com${d.permalink}` : null,
      imageUrl: d.post_hint === 'image' ? d.url : null,
      createdMs: typeof d.created_utc === 'number' ? d.created_utc * 1000 : null,
    }));
}

// Exchange client credentials for a bearer token via HTTP Basic auth.
async function getAccessToken() {
  const creds = `${process.env.REDDIT_CLIENT_ID}:${process.env.REDDIT_CLIENT_SECRET}`;
  const res = await fetch(REDDIT_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(creds).toString('base64')}`,
      'User-Agent': userAgent(),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ grant_type: 'client_credentials' }),
  });
  if (!res.ok) {
    throw new Error(`[reddit] token endpoint returned ${res.status}`);
  }
  const body = await res.json();
  if (!body.access_token) {
    throw new Error('[reddit] token response missing access_token');
  }
  return body.access_token;
}

// Fetch recent posts from r/Torontobluejays. Returns [] on failure so a Reddit
// outage doesn't abort the whole generation run.
export async function fetchRedditPosts(limit = 25) {
  if (!process.env.REDDIT_CLIENT_ID || !process.env.REDDIT_CLIENT_SECRET) {
    console.log('[reddit] credentials not set, skipping');
    return [];
  }
  try {
    const token = await getAccessToken();
    const url = `${REDDIT_API_BASE}/r/${SUBREDDIT}/new?limit=${limit}&raw_json=1`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, 'User-Agent': userAgent() },
    });
    const remaining = res.headers.get('x-ratelimit-remaining');
    if (remaining !== null) {
      console.log(`[reddit] rate-limit remaining: ${remaining}`);
    }
    if (!res.ok) {
      console.warn(`[reddit] listing returned ${res.status}`);
      return [];
    }
    const listing = await res.json();
    const posts = extractRedditPosts(listing);
    console.log(`[reddit] fetched ${posts.length} post(s) from r/${SUBREDDIT}`);
    return posts;
  } catch (err) {
    console.warn(`[reddit] fetch failed: ${err.message}`);
    return [];
  }
}
