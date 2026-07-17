import { test } from 'node:test';
import assert from 'node:assert/strict';
import { configSummary, applyVerdict } from './index.js';

test('configSummary defaults CLASSIFIER_MODEL to claude-haiku-4-5 when unset', () => {
  const previous = process.env.CLASSIFIER_MODEL;
  delete process.env.CLASSIFIER_MODEL;
  try {
    assert.equal(configSummary().CLASSIFIER_MODEL, 'claude-haiku-4-5');
  } finally {
    if (previous === undefined) delete process.env.CLASSIFIER_MODEL;
    else process.env.CLASSIFIER_MODEL = previous;
  }
});

test('configSummary reports the new keys and drops the old generation ones', () => {
  const summary = configSummary();
  assert.ok('CLASSIFIER_MODEL' in summary);
  assert.ok('ANTHROPIC_API_KEY' in summary);
  // Legacy generation/social/MCP config must not survive the refactor.
  assert.ok(!('GENERATION_MODEL' in summary));
  assert.ok(!('REDDIT_CLIENT_ID' in summary));
  assert.ok(!('BLUESKY_IDENTIFIER' in summary));
  assert.ok(!('MLB_MCP_URL' in summary));
});

test('applyVerdict auto-discards a blocked (illegal/doxxing) result', () => {
  const cols = applyVerdict({
    category: 'other',
    safety_status: 'blocked',
    safety_reason: 'exposes a private home address',
  });
  assert.equal(cols.status, "'discarded'");
  assert.equal(cols.category, 'other');
  assert.equal(cols.safety_status, 'blocked');
  assert.equal(cols.classified_at, 'now()');
});

test('applyVerdict keeps a review result as-is for admin review', () => {
  const cols = applyVerdict({
    category: 'trade-rumor',
    safety_status: 'review',
    safety_reason: 'heavy profanity',
  });
  assert.equal(cols.status, undefined);
  assert.equal(cols.safety_status, 'review');
});

test('applyVerdict keeps a safe result as-is', () => {
  const cols = applyVerdict({
    category: 'fabrication',
    safety_status: 'safe',
    safety_reason: 'parody about a public player',
  });
  assert.equal(cols.status, undefined);
  assert.equal(cols.category, 'fabrication');
});
