import { test } from 'node:test';
import assert from 'node:assert/strict';

import { filterUnseen } from './dedup.js';

const POSTS = [
  { source: 'reddit', external_id: 't3_1', title: 'one' },
  { source: 'reddit', external_id: 't3_2', title: 'two' },
  { source: 'bluesky', external_id: 'at://x/3', title: 'three' },
  { source: 'bluesky', external_id: null, title: 'no-id' },
];

test('filterUnseen drops posts whose external_id is in the seen set', () => {
  const seen = new Set(['t3_1', 'at://x/3']);
  const result = filterUnseen(POSTS, seen);
  assert.equal(result.length, 2);
  assert.deepEqual(
    result.map((p) => p.external_id),
    ['t3_2', null]
  );
});

test('filterUnseen keeps all posts when seen set is empty', () => {
  const result = filterUnseen(POSTS, new Set());
  assert.equal(result.length, POSTS.length);
});

test('filterUnseen accepts an array (coerced to Set)', () => {
  const result = filterUnseen(POSTS, ['t3_1']);
  assert.equal(result.length, 3);
  assert.ok(!result.some((p) => p.external_id === 't3_1'));
});

test('filterUnseen keeps posts with null external_id', () => {
  const seen = new Set(['t3_1', 't3_2', 'at://x/3']);
  const result = filterUnseen(POSTS, seen);
  assert.equal(result.length, 1);
  assert.equal(result[0].title, 'no-id');
});

test('filterUnseen returns empty for empty input', () => {
  assert.deepEqual(filterUnseen([], new Set(['x'])), []);
});
