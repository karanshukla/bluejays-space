// Mastodon — recent Blue Jays hashtag posts as generator candidate material.
// Public hashtag-timeline API, no auth needed. Federated, so a tag timeline only
// reflects what the queried instance has federated — mastodon.social by default
// gives decent breadth, not completeness (MASTODON_INSTANCE to change it).

const DEFAULT_INSTANCE = 'mastodon.social';
const HASHTAGS = ['BlueJays', 'TorontoBluejays', 'GoJaysGo'];

function stripHtml(html) {
  return html.replace(/<[^>]*>/g, '').trim();
}

// external_id for dedup is the status's global `uri` — its `id` is only unique
// within the queried instance.
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
      images: images.map((m) => ({ fullsize: m.url, alt: m.description ?? '' })),
      createdMs: s.created_at ? Date.parse(s.created_at) : null,
    };
  });
}

async function fetchHashtag(instance, tag, limit) {
  const url = `https://${instance}/api/v1/timelines/tag/${encodeURIComponent(tag)}?limit=${limit}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`[mastodon] #${tag} returned ${res.status}`);
  return res.json();
}

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
