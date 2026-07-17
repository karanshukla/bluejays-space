import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  classificationSchema,
  buildSystemPrompt,
  buildUserMessage,
  buildImageBlock,
  parseClassification,
  CATEGORIES,
  SAFETY_STATUSES,
} from './classify.js';

test('classificationSchema has the expected shape', () => {
  assert.equal(classificationSchema.type, 'object');
  assert.equal(classificationSchema.additionalProperties, false);
  assert.deepEqual(Object.keys(classificationSchema.properties).sort(), [
    'category',
    'safety_reason',
    'safety_status',
  ]);
  assert.deepEqual(classificationSchema.properties.category.enum, CATEGORIES);
  assert.deepEqual(classificationSchema.properties.safety_status.enum, SAFETY_STATUSES);
});

test('buildSystemPrompt covers the taxonomy, the verdict tiers, and the parody carve-out', () => {
  const prompt = buildSystemPrompt();
  // Every category is named.
  for (const c of CATEGORIES) assert.ok(prompt.includes(c), `prompt names category ${c}`);
  // Every verdict tier is named.
  for (const s of SAFETY_STATUSES) assert.ok(prompt.includes(s), `prompt names status ${s}`);
  // The parody-is-expected carve-out (so edgy parody isn't over-flagged): the
  // prompt must say absurd/parody headlines about public baseball figures are
  // the point and are not violations.
  assert.ok(/parody/i.test(prompt));
  assert.ok(/are the entire point and are NOT violations/i.test(prompt));
  // The illegal/doxxing tier that drives auto-discard.
  assert.ok(/doxxing/i.test(prompt));
  assert.ok(/blocked/i.test(prompt));
});

test('buildUserMessage includes headline, stat block, and source note when present', () => {
  const msg = buildUserMessage({
    headline: 'Vlad hits the moon',
    statBlock: 'HR: 40',
    sourceNote: 'walk-off riff',
  });
  assert.ok(msg.includes('Vlad hits the moon'));
  assert.ok(msg.includes('HR: 40'));
  assert.ok(msg.includes('walk-off riff'));
});

test('buildUserMessage omits empty optional fields', () => {
  const msg = buildUserMessage({ headline: 'Solo headline', statBlock: null, sourceNote: null });
  assert.ok(msg.includes('Solo headline'));
  assert.ok(!msg.includes('STAT BLOCK'));
  assert.ok(!msg.includes('SOURCE NOTE'));
});

test('buildImageBlock builds a base64 image content block with the given media type', () => {
  const block = buildImageBlock('Zm9vYmFy', 'image/webp');
  assert.equal(block.type, 'image');
  assert.equal(block.source.type, 'base64');
  assert.equal(block.source.media_type, 'image/webp');
  assert.equal(block.source.data, 'Zm9vYmFy');
});

test('buildImageBlock defaults media type to image/webp', () => {
  const block = buildImageBlock('Zm9vYmFy');
  assert.equal(block.source.media_type, 'image/webp');
});

test('parseClassification parses a valid text block into a result', () => {
  const result = parseClassification([
    {
      type: 'text',
      text: JSON.stringify({
        category: 'fabrication',
        safety_status: 'safe',
        safety_reason: 'parody about a public player',
      }),
    },
  ]);
  assert.equal(result.category, 'fabrication');
  assert.equal(result.safety_status, 'safe');
  assert.equal(result.safety_reason, 'parody about a public player');
});

test('parseClassification coerces a null safety_reason to null', () => {
  const result = parseClassification([
    {
      type: 'text',
      text: JSON.stringify({
        category: 'game-recap',
        safety_status: 'review',
        safety_reason: null,
      }),
    },
  ]);
  assert.equal(result.safety_reason, null);
});

test('parseClassification rejects an out-of-enum category', () => {
  assert.throws(
    () =>
      parseClassification([
        {
          type: 'text',
          text: JSON.stringify({
            category: 'banana',
            safety_status: 'safe',
            safety_reason: 'x',
          }),
        },
      ]),
    /unknown category: banana/
  );
});

test('parseClassification rejects an out-of-enum safety_status', () => {
  assert.throws(
    () =>
      parseClassification([
        {
          type: 'text',
          text: JSON.stringify({
            category: 'other',
            safety_status: 'maybe',
            safety_reason: 'x',
          }),
        },
      ]),
    /unknown safety_status: maybe/
  );
});

test('parseClassification throws when no text block is present', () => {
  assert.throws(() => parseClassification([{ type: 'tool_use', id: 'x' }]), /no text block/);
  assert.throws(() => parseClassification([]), /no text block/);
});

test('parseClassification throws on unparseable JSON', () => {
  assert.throws(
    () => parseClassification([{ type: 'text', text: 'not json' }]),
    /could not parse JSON/
  );
});
