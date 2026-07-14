import { test } from 'node:test';
import assert from 'node:assert/strict';

import { extractRedditPosts } from './reddit.js';

// Minimal Reddit listing payload matching the documented shape.
const LISTING = {
  kind: 'Listing',
  data: {
    after: 't3_after1',
    children: [
      {
        kind: 't3',
        data: {
          id: '1abc',
          name: 't3_1abc',
          title: 'Vlad goes deep',
          selftext: 'Game thread body',
          permalink: '/r/Torontobluejays/comments/1abc/vlad/',
          url: 'https://i.redd.it/abc.jpg',
          post_hint: 'image',
          created_utc: 1700000000.0,
        },
      },
      {
        kind: 't3',
        data: {
          id: '2def',
          name: 't3_2def',
          title: 'Text post thought',
          selftext: '',
          permalink: '/r/Torontobluejays/comments/2def/text/',
          url: 'https://example.com/article',
          post_hint: 'self',
          created_utc: 1700000100.0,
        },
      },
    ],
  },
};

test('extractRedditPosts maps image posts with imageUrl', () => {
  const posts = extractRedditPosts(LISTING);
  assert.equal(posts.length, 2);
  const img = posts[0];
  assert.equal(img.source, 'reddit');
  assert.equal(img.external_id, 't3_1abc'); // fullname, not bare id
  assert.equal(img.id, '1abc');
  assert.equal(img.title, 'Vlad goes deep');
  assert.equal(img.imageUrl, 'https://i.redd.it/abc.jpg');
  assert.equal(img.permalink, 'https://www.reddit.com/r/Torontobluejays/comments/1abc/vlad/');
  assert.equal(img.createdMs, 1700000000000);
});

test('extractRedditPosts nulls imageUrl for non-image posts', () => {
  const [, text] = extractRedditPosts(LISTING);
  assert.equal(text.imageUrl, null);
  assert.equal(text.selftext, '');
});

test('extractRedditPosts ignores non-t3 children', () => {
  const listing = {
    data: {
      children: [
        { kind: 't1', data: { id: 'x', name: 't1_x', title: 'comment' } }, // comment, not a post
        { kind: 't3', data: { id: 'y', name: 't3_y', title: 'post' } },
      ],
    },
  };
  const posts = extractRedditPosts(listing);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].external_id, 't3_y');
});

test('extractRedditPosts returns [] for empty or malformed input', () => {
  assert.deepEqual(extractRedditPosts({ data: { children: [] } }), []);
  assert.deepEqual(extractRedditPosts({}), []);
  assert.deepEqual(extractRedditPosts(null), []);
});

test('extractRedditPosts tolerates missing optional fields', () => {
  const listing = {
    data: {
      children: [{ kind: 't3', data: { id: 'z', name: 't3_z' } }],
    },
  };
  const [post] = extractRedditPosts(listing);
  assert.equal(post.title, '');
  assert.equal(post.selftext, '');
  assert.equal(post.permalink, null);
  assert.equal(post.imageUrl, null);
  assert.equal(post.createdMs, null);
});
