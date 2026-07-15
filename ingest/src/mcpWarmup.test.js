import { test } from 'node:test';
import assert from 'node:assert/strict';

import { warmUpMlbMcp } from './mcpWarmup.js';

test('warmUpMlbMcp is a no-op when no url is configured', async () => {
  let called = false;
  await warmUpMlbMcp({
    url: undefined,
    fetchImpl: async () => {
      called = true;
    },
  });
  assert.equal(called, false);
});

test('warmUpMlbMcp resolves as soon as fetch succeeds', async () => {
  let calls = 0;
  await warmUpMlbMcp({
    url: 'https://example.test/mcp',
    fetchImpl: async () => {
      calls += 1;
      return {};
    },
    retryDelayMs: 1,
    maxWaitMs: 1000,
  });
  assert.equal(calls, 1);
});

test('warmUpMlbMcp retries after failed attempts until one succeeds', async () => {
  let calls = 0;
  await warmUpMlbMcp({
    url: 'https://example.test/mcp',
    fetchImpl: async () => {
      calls += 1;
      if (calls < 3) throw new Error('connection refused');
      return {};
    },
    retryDelayMs: 1,
    maxWaitMs: 1000,
  });
  assert.equal(calls, 3);
});

test('warmUpMlbMcp gives up after maxWaitMs without throwing', async () => {
  let calls = 0;
  await assert.doesNotReject(
    warmUpMlbMcp({
      url: 'https://example.test/mcp',
      fetchImpl: async () => {
        calls += 1;
        throw new Error('connection refused');
      },
      retryDelayMs: 5,
      maxWaitMs: 20,
    })
  );
  assert.ok(calls >= 1);
});
