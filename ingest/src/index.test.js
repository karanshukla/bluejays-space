import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stubDrafts, configSummary } from './index.js';

test('stubDrafts assigns the demo photo ref only to the register-1 draft', () => {
  const [register1, register2] = stubDrafts('stub/demo.jpg');

  assert.equal(register1.register, 1);
  assert.equal(register1.photo_ref, 'stub/demo.jpg');

  assert.equal(register2.register, 2);
  assert.equal(register2.photo_ref, null);
});

test('stubDrafts passes through a null photo ref (e.g. when S3 is not configured)', () => {
  const [register1] = stubDrafts(null);
  assert.equal(register1.photo_ref, null);
});

test('stubDrafts always returns exactly one draft per register', () => {
  const drafts = stubDrafts(null);
  assert.equal(drafts.length, 2);
  assert.deepEqual(drafts.map((d) => d.register).sort(), [1, 2]);
});

test('configSummary defaults GENERATION_MODEL to claude-haiku-4-5 when unset', () => {
  const previous = process.env.GENERATION_MODEL;
  delete process.env.GENERATION_MODEL;
  try {
    assert.equal(configSummary().GENERATION_MODEL, 'claude-haiku-4-5');
  } finally {
    if (previous === undefined) delete process.env.GENERATION_MODEL;
    else process.env.GENERATION_MODEL = previous;
  }
});
