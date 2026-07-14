// Claude headline generation — the real generation step.
//
// One call per register per run, via @anthropic-ai/sdk. Structured output is
// requested via `output_config.format.json_schema` (GA — no beta header) so the
// response parses straight into a draft row shape. Temperature is split by
// register (1 = low, 2 = maxed). The mlb-api-mcp server is conditionally
// attached via the MCP connector (beta) when MLB_MCP_URL is set — giving the
// generator live stat/roster lookup, which the spec's register-2 real-fact-
// anchored subtype needs to verify connecting facts rather than recall them.
//
// See docs/ingestion-pipeline.md for the concrete gotchas this encodes:
//   - MCP connector: betas:['mcp-client-2025-11-20'], tools uses `server_name`
//     (NOT `mcp_server_name` — the planning doc is stale; verified against
//     platform.claude.com/docs/en/agents-and-tools/mcp-connector).
//   - Temperature: Haiku 4.5 (default) accepts it; Opus 4.7+ rejects it with a
//     400. Since GENERATION_MODEL is swappable via env var without a code
//     change, the call retries without temperature on a 400 mentioning it.
//   - Structured output JSON is returned in a `text` content block — parse it.

import Anthropic from '@anthropic-ai/sdk';

const MCP_BETA = 'mcp-client-2025-11-20';
const MCP_SERVER_NAME = 'mlb-stats';

// JSON schema for structured output. Maps 1:1 onto the headlines row shape
// (suggested_stat -> stat_block column at insert time). Register 2 leaves
// source_post_url + source_note null — no real source for a fabricated premise.
export const headlineSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    headline: { type: 'string' },
    register: { type: 'integer', enum: [1, 2] },
    player_ids: { type: 'array', items: { type: 'string' } },
    suggested_stat: { type: ['string', 'null'] },
    source_post_url: { type: ['string', 'null'] },
    source_note: { type: ['string', 'null'] },
  },
  required: [
    'headline',
    'register',
    'player_ids',
    'suggested_stat',
    'source_post_url',
    'source_note',
  ],
};

// System prompt carries the site's voice + the FAX Sports style reference.
// FAX content is style-only: never credited or surfaced on the live site.
export function buildSystemPrompt(register, faxPosts) {
  const styleSamples = faxPosts
    .slice(0, 8)
    .map((p) => `- ${p.title}${p.excerpt ? ` (${p.excerpt.slice(0, 120)})` : ''}`)
    .join('\n');

  const registerGuidance =
    register === 1
      ? `Register 1 — real-event riff. Ground the headline in an actual game, stat, or moment drawn from the candidate posts. Low risk, straightforward fan commentary. If a candidate post has an image worth reusing, set source_post_url to that post's URL and describe the spark in source_note. Temperature is low — reflect the real context accurately.`
      : `Register 2 — fabricated scenario. Invent a premise about a real Blue Jays player, written deadpan as if real news (FAX Sports style: fake trades, absurd stat lines, impossible claims). No real source to credit — leave source_post_url and source_note null.${
          process.env.MLB_MCP_URL
            ? ' You have an mlb-stats MCP toolset for live roster/injury/standings lookup. For real-fact-anchored jokes, verify every anchoring fact (IL status, team affiliation) via lookup, never from memory.'
            : ' MLB lookup is not available this run, so avoid the real-fact-anchored subtype (fabricated premise + a real connecting fact) — pure fabrication only, since unverified facts undermine the joke.'
        }`;

  return `You are the headline writer for bluejays.space, a parody site for Toronto Blue Jays fans in the style of FAX Sports. Headlines are delivered completely straight; the absurdity of the specific number or claim is what tips off a careful reader (the km/h-as-mph trick), not a warning label.

Voice reference (style only — never credit, link, or affiliate with these on the live site):
${styleSamples || '(no style reference available this run)'}

${registerGuidance}

Return one headline. Keep it short and punchy — one line. If you reference a stat, put a compact version in suggested_stat. List any real player ids/names you riffed on in player_ids.`;
}

// Format candidate posts (Reddit + Bluesky) for the user message. Register 2
// gets an empty list (no real source to riff on) — the prompt says so above.
export function buildUserMessage(register, candidatePosts) {
  if (register === 2 || candidatePosts.length === 0) {
    return 'Draft a register-2 fabricated-scenario headline about a current Blue Jays player. No candidate posts this run — rely on the voice reference and your own baseball knowledge.';
  }
  const formatted = candidatePosts
    .slice(0, 12)
    .map((p, i) => {
      const img = p.imageUrl || p.images?.[0]?.fullsize;
      return `[${i + 1}] (${p.source}) ${p.title || p.text || ''}${
        p.selftext ? `\n    ${p.selftext.slice(0, 280)}` : ''
      }${img ? `\n    [has image: ${img}]` : ''}`;
    })
    .join('\n');
  return `Candidate posts from r/Torontobluejays and #BlueJays Bluesky:\n\n${formatted}\n\nDraft one register-1 headline riffing on one of these. Set source_post_url to the post that sparked it.`;
}

// Parse the structured-output response content blocks into a draft object.
// The JSON arrives in a `text` block per the structured-outputs API.
export function parseHeadlineResponse(content) {
  const blocks = Array.isArray(content) ? content : [];
  const textBlock = blocks.find((b) => b.type === 'text');
  if (!textBlock || !textBlock.text) {
    throw new Error('[claude] response had no text block');
  }
  let parsed;
  try {
    parsed = JSON.parse(textBlock.text);
  } catch {
    throw new Error(
      `[claude] could not parse JSON from text block: ${textBlock.text.slice(0, 120)}`
    );
  }
  // Coerce to the DB row shape (suggested_stat -> stat_block).
  return {
    headline: String(parsed.headline),
    register: Number(parsed.register),
    player_ids: Array.isArray(parsed.player_ids) ? parsed.player_ids.map(String) : [],
    stat_block: parsed.suggested_stat ?? null,
    photo_ref: null, // filled by the orchestrator if a source image is stored
    source_post_url: parsed.source_post_url ?? null,
    source_note: parsed.source_note ?? null,
  };
}

function client() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

// Build the base request body (model, max tokens, structured output, messages).
function baseRequest(model, systemPrompt, userMessage) {
  return {
    model,
    max_tokens: 1024,
    output_config: {
      format: {
        type: 'json_schema',
        json_schema: { name: 'headline', strict: true, schema: headlineSchema },
      },
    },
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  };
}

// Detect a 400 specifically about the temperature param — the documented
// failure mode when GENERATION_MODEL is swapped to a tier that dropped sampling
// controls (Opus 4.7+). Lets the call retry without temperature.
function isTemperatureError(err) {
  return err?.status === 400 && /temperature/i.test(err?.message ?? '');
}

// Generate one headline draft for the given register. Returns the draft object.
export async function generateHeadline({ register, candidatePosts, faxPosts }) {
  const model = process.env.GENERATION_MODEL || 'claude-haiku-4-5';
  const systemPrompt = buildSystemPrompt(register, faxPosts);
  const userMessage = buildUserMessage(register, candidatePosts);
  const anthropic = client();

  // Register 1 = low temperature (grounded); register 2 = maxed (inventive).
  const temperature = register === 1 ? 0.7 : 1.0;

  const call = (body) =>
    process.env.MLB_MCP_URL
      ? anthropic.beta.messages.create({
          ...body,
          betas: [MCP_BETA],
          mcp_servers: [{ type: 'url', url: process.env.MLB_MCP_URL, name: MCP_SERVER_NAME }],
          tools: [{ type: 'mcp_toolset', server_name: MCP_SERVER_NAME }],
        })
      : anthropic.messages.create(body);

  const body = { ...baseRequest(model, systemPrompt, userMessage), temperature };

  let response;
  try {
    response = await call(body);
  } catch (err) {
    if (isTemperatureError(err)) {
      // Model tier dropped the temperature param (Opus 4.7+). Retry without it.
      console.warn(
        '[claude] temperature rejected, retrying without (see docs/ingestion-pipeline.md)'
      );
      response = await call(baseRequest(model, systemPrompt, userMessage));
    } else {
      throw err;
    }
  }

  const draft = parseHeadlineResponse(response.content);
  // The model should echo the register, but trust the requested one if it drifts.
  draft.register = register;
  return draft;
}
