// Draft classifier — one Anthropic call per unclassified draft. Assigns a
// topic category and a safety verdict, examining the draft's TEXT and, when a
// photo is attached, the IMAGE too (Claude vision).
//
// Structured output via output_config.format (GA), no streaming (short call).
// Haiku accepts `temperature`; Opus 4.7+ rejects it. CLASSIFIER_MODEL is
// env-swappable, so the call retries without it on a matching 400 — same
// gotcha the old generator hit.
//
// The verdict drives the job's only hard rule: `blocked` (illegal/doxxing)
// drafts are auto-discarded; `review` and `safe` just get flagged for the
// admin. The moderation decision lives here so it's unit-testable in one place.

import Anthropic from '@anthropic-ai/sdk';

// Topic tags. Plain string, no enum CHECK in the DB — adding a tag needs no
// migration, same philosophy as seen_posts.source. The model is told to fall
// back to 'other' when nothing fits.
export const CATEGORIES = [
  'game-recap', // result/highlight from a specific game
  'trade-rumor', // trade/signing/free-agent speculation
  'stat-line', // a stat or record is the punchline
  'injury', // IL/injury/recovery angle
  'roster-move', // call-up/option/DFA/lineup change
  'fabrication', // invented scenario, no real event (register 2 main)
  'off-field', // personality/lifestyle/drama
  'other',
];

export const SAFETY_STATUSES = ['safe', 'review', 'blocked'];

// Structured-output shape returned by the model.
export const classificationSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    category: { type: 'string', enum: CATEGORIES },
    safety_status: { type: 'string', enum: SAFETY_STATUSES },
    safety_reason: { type: 'string' },
  },
  required: ['category', 'safety_status', 'safety_reason'],
};

export function buildSystemPrompt() {
  return `You are the content classifier for bluejays.space, a parody site for Toronto Blue Jays fans in the style of FAX Sports. You review draft headlines — both their TEXT and, when attached, their IMAGE — and return two judgments as JSON: a topic category and a safety verdict.

# Context that matters for safety
This is a PARODY site. Deadpan, absurd, exaggerated headlines about PUBLIC baseball figures (players, managers, front office) are the entire point and are NOT violations. "Fabricated scenario" headlines (fake trades, impossible stat lines, invented events presented as real news) are expected and safe. Being rude about a player's on-field performance is fine. A claim being false does not make it a violation — that is the genre.

# Category
Pick exactly one from: ${CATEGORIES.join(', ')}.
- game-recap: riffing on a specific game result or highlight.
- trade-rumor: trade/signing/free-agent speculation.
- stat-line: a stat or record is the core of the joke.
- injury: IL/injury/recovery angle.
- roster-move: call-up/option/DFA/lineup change.
- fabrication: invented scenario with no real event (the deadpan "fake news" style).
- off-field: personality/lifestyle/drama.
- other: nothing else fits.

# Safety verdict
Pick exactly one of: safe, review, blocked.

- safe: fine to publish. Includes all parody/absurdity about public baseball figures, rough-on-the-field commentary, and normal sports talk.

- review: over the site's tone but NOT illegal — flag for a human. Use for:
  * hate speech, slurs, or harassment targeting a real person's identity (race, religion, sexuality, gender, disability);
  * NSFW, explicit sexual content, or graphic violence that doesn't fit the site;
  * heavy profanity beyond the site's voice;
  * defamation-style accusations of real-world misconduct or crimes about a real person, or content that could cause real reputational harm beyond parody;
  * anything that attacks a private individual (non-public figure) rather than a public baseball figure.

- blocked: illegal or clearly must never be published. Use for:
  * doxxing or exposing private personal information (home address, phone, ID, private contact details) of ANY person;
  * sexualization of minors;
  * true threats of violence;
  * content that could expose the site to legal liability in a way parody does not protect.

When in doubt between review and blocked, prefer review and explain in safety_reason. When in doubt between safe and review, remember this is a parody site and prefer safe.

# safety_reason
One short sentence (max ~200 chars) explaining the verdict. For 'safe', a brief phrase like "parody about a public player" is enough. For review/blocked, name the specific concern. This is shown to the admin.

Return ONLY the JSON object matching the schema.`;
}

export function buildUserMessage({ headline, statBlock, sourceNote }) {
  const parts = [`HEADLINE: ${headline}`];
  if (statBlock) parts.push(`STAT BLOCK: ${statBlock}`);
  if (sourceNote) parts.push(`SOURCE NOTE: ${sourceNote}`);
  parts.push(
    'Classify this draft. If an image is attached, consider it alongside the text for both category and safety.'
  );
  return parts.join('\n');
}

// Builds a Claude vision image content block. mediaType defaults to image/webp
// because the storage pipeline re-encodes to webp; caller passes the stored
// content-type when known. base64 is the raw base64 string (no data: prefix).
export function buildImageBlock(base64, mediaType = 'image/webp') {
  return { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } };
}

export function parseClassification(content) {
  const blocks = Array.isArray(content) ? content : [];
  const textBlock = blocks.find((b) => b.type === 'text');
  if (!textBlock || !textBlock.text) {
    throw new Error('[classify] response had no text block');
  }
  let parsed;
  try {
    parsed = JSON.parse(textBlock.text);
  } catch {
    throw new Error(
      `[classify] could not parse JSON from text block: ${textBlock.text.slice(0, 120)}`
    );
  }
  const category = String(parsed.category);
  const safetyStatus = String(parsed.safety_status);
  if (!CATEGORIES.includes(category)) {
    throw new Error(`[classify] unknown category: ${category}`);
  }
  if (!SAFETY_STATUSES.includes(safetyStatus)) {
    throw new Error(`[classify] unknown safety_status: ${safetyStatus}`);
  }
  return {
    category,
    safety_status: safetyStatus,
    safety_reason: parsed.safety_reason == null ? null : String(parsed.safety_reason),
  };
}

const REQUEST_TIMEOUT_MS = 60_000;

function client() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: REQUEST_TIMEOUT_MS });
}

function baseRequest(model, systemPrompt, content) {
  return {
    model,
    max_tokens: 1024,
    output_config: {
      format: {
        type: 'json_schema',
        schema: classificationSchema,
      },
    },
    system: systemPrompt,
    messages: [{ role: 'user', content }],
  };
}

function isTemperatureError(err) {
  return err?.status === 400 && /temperature/i.test(err?.message ?? '');
}

/**
 * Classify one draft.
 * @param {{headline: string, statBlock?: string|null, sourceNote?: string|null,
 *          image?: {base64: string, mediaType?: string}|null}} input
 * @returns {Promise<{category: string, safety_status: string, safety_reason: string|null}>}
 */
export async function classify({ headline, statBlock, sourceNote, image }) {
  const model = process.env.CLASSIFIER_MODEL || 'claude-haiku-4-5';
  const systemPrompt = buildSystemPrompt();
  const userMessage = buildUserMessage({ headline, statBlock, sourceNote });

  const content = image
    ? [buildImageBlock(image.base64, image.mediaType), { type: 'text', text: userMessage }]
    : userMessage;

  const anthropic = client();
  const temperature = 0;
  const startedAt = Date.now();
  console.log(`[classify] classifying draft (${image ? 'text+image' : 'text only'}) via ${model}`);

  const call = (body) => anthropic.messages.create({ ...body, temperature });

  let response;
  try {
    response = await call(baseRequest(model, systemPrompt, content));
  } catch (err) {
    if (isTemperatureError(err)) {
      console.warn('[classify] temperature rejected, retrying without');
      response = await call(baseRequest(model, systemPrompt, content));
    } else {
      console.error(`[classify] call failed after ${Date.now() - startedAt}ms`);
      throw err;
    }
  }

  const result = parseClassification(response.content);
  console.log(
    `[classify] ${result.category} / ${result.safety_status} in ${Date.now() - startedAt}ms` +
      (result.safety_reason ? ` — ${result.safety_reason}` : '')
  );
  return result;
}
