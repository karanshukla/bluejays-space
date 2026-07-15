// Mastodon — recent Blue Jays-related hashtag posts as generator candidate
// material. Public hashtag-timeline API, no auth/credentials needed —
// Mastodon's API is deliberately open for this kind of read.
//
// One important limitation, unlike Reddit/Bluesky (single authoritative
// index): Mastodon is federated, so a hashtag timeline only reflects what
// the *queried instance* has already seen/federated for that tag — it's not
// a global index of the fediverse. Querying a large, well-federated instance
// (mastodon.social by default) gives decent best-effort breadth, not
// completeness. Configurable via MASTODON_INSTANCE for a different instance.

const DEFAULT_INSTANCE = 'mastodon.social';
const HASHTAGS = ['BlueJays', 'TorontoBluejays', 'GoJaysGo'];

// Mastodon status `content` is HTML (e.g. "<p>Vlad walk-off!</p>"). Strip
// tags for a plain-text candidate excerpt — this is prompt input, not
// rendered markup, so a regex strip is enough.
function stripHtml(html) {
  return html.replace(/<[^>]*>/g, '').trim();
}

// Map a hashtag-timeline response (array of statuses) to a normalized post
// list. Pure function. `external_id` for dedup is the status's global `uri`
// (federation-unique) — its `id` is only unique within the queried instance.
export function extractMastodonPosts(statuses) {
  const list = Array.isArray(statuses) ? statuses : [];
  return list.map((s) => {
    const images = (s.media_attachments ?? []).filter((m) => m.type === 'image');
    return {
      source: 'mastodon',
      external_id: s.uri || s.url || (s.id != null ? String(s.id) : null),
      text: stripHtml(s.content ?? ''),
      authorHandle: s.account?.acct ?? '',
      permalink: s.url ?? null,
      images: images.map((m) => ({
        fullsize: m.url,
        alt: m.description ?? '',
      })),
      createdMs: s.created_at ? Date.parse(s.created_at) : null,
    };
  });
}

async function fetchHashtag(instance, tag, limit) {
  const url = `https://${instance}/api/v1/timelines/tag/${encodeURIComponent(tag)}?limit=${limit}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    throw new Error(`[mastodon] #${tag} returned ${res.status}`);
  }
  return res.json();
}

// Fetch recent posts across all configured hashtags from one instance,
// deduped by uri. Returns [] on failure so a Mastodon outage/instance hiccup
// doesn't abort the generation run.
export async function fetchMastodonPosts(limit = 25) {
  const instance = process.env.MASTODON_INSTANCE || DEFAULT_INSTANCE;
  try {
    const results = await Promise.all(HASHTAGS.map((tag) => fetchHashtag(instance, tag, limit)));
    const seen = new Set();
    const posts = [];
    for (const statuses of results) {
      for (const post of extractMastodonPosts(statuses)) {
        if (post.external_id && !seen.has(post.external_id)) {
          seen.add(post.external_id);
          posts.push(post);
        }
      }
    }
    console.log(`[mastodon] fetched ${posts.length} deduped post(s) from ${instance}`);
    return posts;
  } catch (err) {
    console.warn(`[mastodon] fetch failed: ${err.message}`);
    return [];
  }
}
