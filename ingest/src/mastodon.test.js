import { test } from 'node:test';
import assert from 'node:assert/strict';

import { extractMastodonPosts } from './mastodon.js';

const TIMELINE_RESPONSE = [
  {
    id: '123456789',
    uri: 'https://mastodon.social/users/fan/statuses/123456789',
    url: 'https://mastodon.social/@fan/123456789',
    content: '<p>Vlad walk-off! <a href="https://mastodon.social/tags/bluejays">#BlueJays</a></p>',
    account: { acct: 'fan@mastodon.social' },
    created_at: '2026-07-14T10:00:00.000Z',
    media_attachments: [
      {
        type: 'image',
        url: 'https://files.mastodon.social/full/1.jpg',
        description: 'Vlad at bat',
      },
    ],
  },
  {
    id: '987654321',
    uri: 'https://mastodon.social/users/other/statuses/987654321',
    url: 'https://mastodon.social/@other/987654321',
    content: '<p>No image here</p>',
    account: { acct: 'other@mastodon.social' },
    created_at: '2026-07-14T11:00:00.000Z',
    media_attachments: [],
  },
];

test('extractMastodonPosts maps statuses with image attachments', () => {
  const posts = extractMastodonPosts(TIMELINE_RESPONSE);
  assert.equal(posts.length, 2);

  const [img] = posts;
  assert.equal(img.source, 'mastodon');
  assert.equal(img.external_id, 'https://mastodon.social/users/fan/statuses/123456789');
  assert.equal(img.text, 'Vlad walk-off! #BlueJays');
  assert.equal(img.authorHandle, 'fan@mastodon.social');
  assert.equal(img.permalink, 'https://mastodon.social/@fan/123456789');
  assert.equal(img.images.length, 1);
  assert.equal(img.images[0].fullsize, 'https://files.mastodon.social/full/1.jpg');
  assert.equal(img.images[0].alt, 'Vlad at bat');
  assert.equal(img.createdMs, Date.parse('2026-07-14T10:00:00.000Z'));
});

test('extractMastodonPosts handles statuses without media', () => {
  const [, plain] = extractMastodonPosts(TIMELINE_RESPONSE);
  assert.deepEqual(plain.images, []);
  assert.equal(plain.text, 'No image here');
});

test('extractMastodonPosts ignores non-image media (e.g. video)', () => {
  const statuses = [
    {
      id: '1',
      uri: 'https://x/1',
      account: { acct: 'h' },
      content: '<p>video post</p>',
      media_attachments: [{ type: 'video', url: 'https://x/video.mp4' }],
    },
  ];
  const [post] = extractMastodonPosts(statuses);
  assert.deepEqual(post.images, []);
});

test('extractMastodonPosts falls back from uri to url to id for external_id', () => {
  const statuses = [
    { id: '1', url: 'https://x/1', account: {}, content: '' },
    { id: '2', account: {}, content: '' },
  ];
  const posts = extractMastodonPosts(statuses);
  assert.equal(posts[0].external_id, 'https://x/1');
  assert.equal(posts[1].external_id, '2');
});

test('extractMastodonPosts returns [] for empty or malformed input', () => {
  assert.deepEqual(extractMastodonPosts([]), []);
  assert.deepEqual(extractMastodonPosts(null), []);
  assert.deepEqual(extractMastodonPosts(undefined), []);
});

test('extractMastodonPosts strips HTML tags from content', () => {
  const statuses = [
    {
      id: '1',
      uri: 'https://x/1',
      account: { acct: 'h' },
      content: '<p>Line one</p><p>Line two</p>',
    },
  ];
  const [post] = extractMastodonPosts(statuses);
  assert.equal(post.text, 'Line oneLine two');
});
