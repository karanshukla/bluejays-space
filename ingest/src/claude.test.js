import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  headlineSchema,
  buildSystemPrompt,
  buildUserMessage,
  parseHeadlineResponse,
} from './claude.js';

test('headlineSchema has the required draft-row shape', () => {
  assert.equal(headlineSchema.type, 'object');
  assert.equal(headlineSchema.additionalProperties, false);
  const props = Object.keys(headlineSchema.properties).sort();
  assert.deepEqual(props, [
    'headline',
    'player_ids',
    'register',
    'source_note',
    'source_post_url',
    'suggested_stat',
  ]);
  assert.ok(headlineSchema.required.includes('suggested_stat'));
});

test('buildSystemPrompt includes FAX style reference titles', () => {
  const prompt = buildSystemPrompt(1, [
    { title: 'Mets Acquire Soccer', excerpt: 'Queens NY' },
    { title: 'Second Bit', excerpt: '' },
  ]);
  assert.ok(prompt.includes('Mets Acquire Soccer'));
  assert.ok(prompt.includes('Second Bit'));
  assert.ok(prompt.includes('Register 1'));
  assert.ok(/style only/i.test(prompt));
});

test('buildSystemPrompt register 2 notes MLB lookup availability', () => {
  const original = process.env.MLB_MCP_URL;
  try {
    delete process.env.MLB_MCP_URL;
    const noMcp = buildSystemPrompt(2, []);
    assert.ok(/not available this run/.test(noMcp));
    assert.ok(/avoid the real-fact-anchored subtype/.test(noMcp));

    process.env.MLB_MCP_URL = 'https://example.com/mcp';
    const withMcp = buildSystemPrompt(2, []);
    assert.ok(/mlb-stats MCP toolset/.test(withMcp));
    assert.ok(/verify every anchoring fact/.test(withMcp));
  } finally {
    if (original === undefined) delete process.env.MLB_MCP_URL;
    else process.env.MLB_MCP_URL = original;
  }
});

test('buildUserMessage formats candidate posts for register 1', () => {
  const msg = buildUserMessage(1, [
    {
      source: 'reddit',
      title: 'Vlad walk-off',
      selftext: 'body',
      imageUrl: 'https://i.redd.it/x.jpg',
    },
    { source: 'bluesky', text: 'Blsy post', images: [{ fullsize: 'https://cdn.bsky.app/y.jpg' }] },
  ]);
  assert.ok(msg.includes('Vlad walk-off'));
  assert.ok(msg.includes('[has image: https://i.redd.it/x.jpg]'));
  assert.ok(msg.includes('Blsy post'));
});

test('buildUserMessage register 2 needs no candidate posts', () => {
  const msg = buildUserMessage(2, [{ source: 'reddit', title: 'ignored' }]);
  assert.ok(/register-2 fabricated-scenario/.test(msg));
  assert.ok(!msg.includes('ignored'));
});

test('parseHeadlineResponse parses a valid text block into a draft row', () => {
  const draft = parseHeadlineResponse([
    {
      type: 'text',
      text: JSON.stringify({
        headline: 'Vlad hits moon',
        register: 1,
        player_ids: ['vladimir-guerrero-jr-671096'],
        suggested_stat: 'HR: 40',
        source_post_url: 'https://reddit.com/x',
        source_note: 'walk-off post',
      }),
    },
  ]);
  assert.equal(draft.headline, 'Vlad hits moon');
  assert.equal(draft.register, 1);
  assert.deepEqual(draft.player_ids, ['vladimir-guerrero-jr-671096']);
  assert.equal(draft.stat_block, 'HR: 40'); // suggested_stat -> stat_block
  assert.equal(draft.photo_ref, null);
  assert.equal(draft.source_post_url, 'https://reddit.com/x');
  assert.equal(draft.source_note, 'walk-off post');
});

test('parseHeadlineResponse coerces null register-2 source fields', () => {
  const draft = parseHeadlineResponse([
    {
      type: 'text',
      text: JSON.stringify({
        headline: 'Fake trade',
        register: 2,
        player_ids: [],
        suggested_stat: null,
        source_post_url: null,
        source_note: null,
      }),
    },
  ]);
  assert.equal(draft.stat_block, null);
  assert.equal(draft.source_post_url, null);
  assert.equal(draft.source_note, null);
  assert.deepEqual(draft.player_ids, []);
});

test('parseHeadlineResponse throws when no text block is present', () => {
  assert.throws(() => parseHeadlineResponse([{ type: 'tool_use', id: 'x' }]), /no text block/);
  assert.throws(() => parseHeadlineResponse([]), /no text block/);
});

test('parseHeadlineResponse throws on unparseable JSON', () => {
  assert.throws(
    () => parseHeadlineResponse([{ type: 'text', text: 'not json' }]),
    /could not parse JSON/
  );
});
