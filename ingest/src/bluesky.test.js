import { test } from 'node:test';
import assert from 'node:assert/strict';

import { extractBlueskyPosts } from './bluesky.js';

const SEARCH_RESPONSE = {
  posts: [
    {
      uri: 'at://did:plc:abc/app.bsky.feed.post/123',
      cid: 'bafyrei_xyz',
      author: { did: 'did:plc:abc', handle: 'fan.bsky.social' },
      record: {
        text: 'Vlad walk-off!',
        createdAt: '2026-07-14T10:00:00.000Z',
      },
      embed: {
        $type: 'app.bsky.embed.images#view',
        images: [{ fullsize: 'https://cdn.bsky.app/img/full/1.jpg', alt: 'Vlad at bat' }],
      },
    },
    {
      uri: 'at://did:plc:def/app.bsky.feed.post/456',
      cid: 'bafyrei_uvw',
      author: { did: 'did:plc:def', handle: 'other.bsky.social' },
      record: { text: 'No image here', createdAt: '2026-07-14T11:00:00.000Z' },
      // no embed
    },
  ],
};

test('extractBlueskyPosts maps posts with image embeds', () => {
  const posts = extractBlueskyPosts(SEARCH_RESPONSE);
  assert.equal(posts.length, 2);

  const [img] = posts;
  assert.equal(img.source, 'bluesky');
  assert.equal(img.external_id, 'at://did:plc:abc/app.bsky.feed.post/123');
  assert.equal(img.cid, 'bafyrei_xyz');
  assert.equal(img.text, 'Vlad walk-off!');
  assert.equal(img.authorHandle, 'fan.bsky.social');
  assert.equal(img.images.length, 1);
  assert.equal(img.images[0].fullsize, 'https://cdn.bsky.app/img/full/1.jpg');
  assert.equal(img.images[0].alt, 'Vlad at bat');
  assert.equal(img.createdMs, Date.parse('2026-07-14T10:00:00.000Z'));
});

test('extractBlueskyPosts handles posts without an image embed', () => {
  const [, plain] = extractBlueskyPosts(SEARCH_RESPONSE);
  assert.deepEqual(plain.images, []);
  assert.equal(plain.text, 'No image here');
});

test('extractBlueskyPosts ignores non-image embed types', () => {
  const data = {
    posts: [
      {
        uri: 'at://x/1',
        author: { handle: 'h' },
        record: { text: 'video post' },
        embed: { $type: 'app.bsky.embed.video#view', video: 'url' },
      },
    ],
  };
  const [post] = extractBlueskyPosts(data);
  assert.deepEqual(post.images, []);
});

test('extractBlueskyPosts returns [] for empty or malformed input', () => {
  assert.deepEqual(extractBlueskyPosts({ posts: [] }), []);
  assert.deepEqual(extractBlueskyPosts({}), []);
  assert.deepEqual(extractBlueskyPosts(null), []);
});

test('extractBlueskyPosts defaults missing alt to empty string', () => {
  const data = {
    posts: [
      {
        uri: 'at://x/1',
        author: { handle: 'h' },
        record: { text: 't' },
        embed: {
          $type: 'app.bsky.embed.images#view',
          images: [{ fullsize: 'https://x/y.jpg' }], // no alt
        },
      },
    ],
  };
  const [post] = extractBlueskyPosts(data);
  assert.equal(post.images[0].alt, '');
});
