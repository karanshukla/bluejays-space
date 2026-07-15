// bluejays-ingest — headline generation job.
//
// Runs once and exits, matching Railway cron semantics. In dev it's triggered
// manually:  docker compose run --rm ingest
//
// Two paths:
//  * Stub path (ANTHROPIC_API_KEY unset): inserts two placeholder drafts so the
//    admin review UI has rows to work with. Preserved for credential-free dev.
//  * Real path (ANTHROPIC_API_KEY set): fetches Reddit/Bluesky/Mastodon candidate
//    posts + FAX Sports style reference, generates one headline per register via
//    Claude, downloads any reused source image into MinIO, inserts draft rows,
//    and marks the fetched posts as seen so re-runs don't resurface them.
//
// See docs/archive/ingestion-pipeline.md for the concrete decisions this encodes.

import pg from 'pg';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ensureBucket, uploadImage, downloadAndStoreImage } from './storage.js';
import { fetchFaxPosts } from './fax.js';
import { fetchRedditPosts } from './reddit.js';
import { fetchBlueskyPosts } from './bluesky.js';
import { fetchMastodonPosts } from './mastodon.js';
import { generateHeadline } from './claude.js';
import { ensureSeenPostsTable, getSeenIds, markSeen, filterUnseen } from './dedup.js';

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function configSummary() {
  const present = (name) => (process.env[name] ? 'set' : 'NOT SET');
  return {
    DATABASE_URL: present('DATABASE_URL'),
    ANTHROPIC_API_KEY: present('ANTHROPIC_API_KEY'),
    GENERATION_MODEL: process.env.GENERATION_MODEL || 'claude-haiku-4-5',
    REDDIT_CLIENT_ID: present('REDDIT_CLIENT_ID'),
    BLUESKY_IDENTIFIER: present('BLUESKY_IDENTIFIER'),
    MLB_MCP_URL: present('MLB_MCP_URL'),
    MLB_MCP_AUTH_TOKEN: present('MLB_MCP_AUTH_TOKEN'),
  };
}

// Placeholder drafts standing in for the real generation step. Used by the stub
// path (no ANTHROPIC_API_KEY). Register 1 stays low-temperature/grounded,
// register 2 is the fabricated-scenario bit — see the project spec for the full
// register definitions. photo_ref for the first draft is filled in at runtime
// once the demo image upload completes (see uploadDemoImage below) — it's not a
// real player photo, just proof the object-storage path works end to end.
export function stubDrafts(demoPhotoRef) {
  return [
    {
      headline: 'Home Run Dragon found as lifeless as Trey Yesavage’s pitching',
      register: 1,
      player_ids: [],
      stat_block: '(stub) placeholder stat line',
      photo_ref: demoPhotoRef,
      source_post_url: null,
      source_note: '(stub) placeholder — real fetch/generation pending',
    },
    {
      headline: '(stub) fabricated-scenario placeholder headline',
      register: 2,
      player_ids: [],
      stat_block: '(stub) placeholder stat line',
      photo_ref: null,
      source_post_url: null,
      source_note: null,
    },
  ];
}

async function insertDrafts(pool, drafts) {
  for (const draft of drafts) {
    await pool.query(
      `INSERT INTO headlines (headline, register, player_ids, stat_block, photo_ref, source_post_url, source_note)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        draft.headline,
        draft.register,
        draft.player_ids,
        draft.stat_block,
        draft.photo_ref,
        draft.source_post_url,
        draft.source_note,
      ]
    );
  }
}

// Uploads the repo's placeholder image as a stand-in for real sourced player
// photos, proving the storage write path works. Returns the object key, or
// null if S3 isn't configured (e.g. running without MinIO).
async function uploadDemoImage() {
  if (!process.env.S3_ENDPOINT) {
    console.log('[ingest] S3_ENDPOINT not set, skipping demo image upload');
    return null;
  }
  await ensureBucket();
  const bytes = await readFile(path.join(__dirname, '..', 'assets', 'demo.jpg'));
  const key = 'stub/demo.jpg';
  await uploadImage(key, bytes, 'image/jpeg');
  return key;
}

// --- Real generation path ---

// If a register-1 draft credits a source post that had an image, download that
// image into MinIO and set photo_ref to the stored key (never hotlink the
// source CDN — see SPEC.md Image Storage). Reddit image URLs are on the post;
// Bluesky image URLs are nested under images[].
function sourceImageUrl(post) {
  if (!post) return null;
  if (post.imageUrl) return post.imageUrl;
  if (Array.isArray(post.images) && post.images[0]?.fullsize) {
    return post.images[0].fullsize;
  }
  return null;
}

// Build a short, unique-ish storage key for a downloaded source image.
function imageKeyFor(post, ext = 'jpg') {
  const stamp = Date.now();
  const slug = (post.external_id || 'post').replace(/[^a-z0-9_-]/gi, '').slice(0, 40);
  return `${post.source}/${slug || 'post'}-${stamp}.${ext}`;
}

async function runRealGeneration(pool) {
  // Style reference — FAX Sports posts. Never surfaced on the live site.
  const faxPosts = await fetchFaxPosts();

  // Candidate material — Reddit + Bluesky + Mastodon, filtered against seen_posts.
  const [redditPosts, blueskyPosts, mastodonPosts] = await Promise.all([
    fetchRedditPosts(),
    fetchBlueskyPosts(),
    fetchMastodonPosts(),
  ]);
  const redditSeen = await getSeenIds(pool, 'reddit');
  const blueskySeen = await getSeenIds(pool, 'bluesky');
  const mastodonSeen = await getSeenIds(pool, 'mastodon');
  const newReddit = filterUnseen(redditPosts, redditSeen);
  const newBluesky = filterUnseen(blueskyPosts, blueskySeen);
  const newMastodon = filterUnseen(mastodonPosts, mastodonSeen);
  const candidatePosts = [...newReddit, ...newBluesky, ...newMastodon];
  console.log(
    `[ingest] candidates: ${newReddit.length} reddit, ${newBluesky.length} bluesky, ${newMastodon.length} mastodon ` +
      `(${redditPosts.length - newReddit.length}/${blueskyPosts.length - newBluesky.length}/${mastodonPosts.length - newMastodon.length} already seen)`
  );

  if (candidatePosts.length === 0) {
    console.log('[ingest] no new candidate posts; generating register-2 only');
  }

  const drafts = [];
  // Register 1: riff on a real post. Skip if no candidates this run.
  if (candidatePosts.length > 0) {
    const draft = await generateHeadline({
      register: 1,
      candidatePosts,
      faxPosts,
    });
    // Attach a stored copy of the source image if the draft credited one.
    const credited = candidatePosts.find((p) => p.permalink === draft.source_post_url);
    const imgUrl = sourceImageUrl(credited) || sourceImageUrl(candidatePosts[0]);
    if (imgUrl) {
      const key = await downloadAndStoreImage(imgUrl, imageKeyFor(credited || candidatePosts[0]));
      if (key) draft.photo_ref = key;
    }
    drafts.push(draft);
  }

  // Register 2: fabricated scenario — no candidate posts needed.
  drafts.push(
    await generateHeadline({
      register: 2,
      candidatePosts: [],
      faxPosts,
    })
  );

  await insertDrafts(pool, drafts);
  console.log(`[ingest] inserted ${drafts.length} draft row(s)`);

  // Mark everything we surfaced this run as seen — even if generation skipped
  // some — so they don't come back next run.
  await markSeen(pool, 'reddit', newReddit.map((p) => p.external_id).filter(Boolean));
  await markSeen(pool, 'bluesky', newBluesky.map((p) => p.external_id).filter(Boolean));
  await markSeen(pool, 'mastodon', newMastodon.map((p) => p.external_id).filter(Boolean));
}

// --- Entrypoint ---

async function main() {
  console.log('[ingest] starting generation run');
  console.log('[ingest] config:', configSummary());

  if (!process.env.DATABASE_URL) {
    console.log('[ingest] DATABASE_URL not set, skipping DB write');
    console.log('[ingest] done');
    return;
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await ensureSeenPostsTable(pool);

    if (!process.env.ANTHROPIC_API_KEY) {
      console.log('[ingest] ANTHROPIC_API_KEY not set — running stub path');
      const demoPhotoRef = await uploadDemoImage();
      const drafts = stubDrafts(demoPhotoRef);
      await insertDrafts(pool, drafts);
      console.log(`[ingest] inserted ${drafts.length} stub draft row(s)`);
      return;
    }

    await runRealGeneration(pool);
  } finally {
    await pool.end();
  }

  console.log('[ingest] done');
}

// Only run when executed directly (`node src/index.js`), not when imported
// by tests (`import { stubDrafts } from './index.js'`).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('[ingest] failed:', err);
    process.exitCode = 1;
  });
}
