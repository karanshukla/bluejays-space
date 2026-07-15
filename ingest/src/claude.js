// Claude headline generation — one call per register per run.
// Structured output via output_config.format (GA), temperature split by
// register. The mlb-api-mcp server attaches via the MCP connector (beta) when
// MLB_MCP_URL is set, giving live stat/roster lookup.
//
// Gotchas confirmed against live API 400s (don't reintroduce):
//   - MCP connector needs betas:['mcp-client-2025-11-20'] and tools use
//     `mcp_server_name` (not `server_name`).
//   - output_config.format is flat: { type:'json_schema', schema } — not nested.
//   - Structured-output JSON arrives in a `text` content block.
//   - Haiku accepts `temperature`; Opus 4.7+ rejects it. GENERATION_MODEL is
//     env-swappable, so the call retries without it on a matching 400.
//   - MLB_MCP_AUTH_TOKEN is a plain bearer token only — the connector supports
//     neither OAuth nor Cloudflare's two-header Service Token scheme.
//   - Streaming (.messages.stream), not .create(): a non-streaming request sits
//     silent for the whole MCP round-trip and hit an idle-network cutoff in
//     production well under the client timeout. Streaming keeps it alive.

import Anthropic from '@anthropic-ai/sdk';

const MCP_BETA = 'mcp-client-2025-11-20';
const MCP_SERVER_NAME = 'mlb-stats';

// Maps 1:1 onto the headlines row shape (suggested_stat -> stat_block).
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
  return {
    headline: String(parsed.headline),
    register: Number(parsed.register),
    player_ids: Array.isArray(parsed.player_ids) ? parsed.player_ids.map(String) : [],
    stat_block: parsed.suggested_stat ?? null,
    photo_ref: null,
    source_post_url: parsed.source_post_url ?? null,
    source_note: parsed.source_note ?? null,
  };
}

const REQUEST_TIMEOUT_MS = 20 * 60 * 1000;

function client() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: REQUEST_TIMEOUT_MS });
}

function baseRequest(model, systemPrompt, userMessage) {
  return {
    model,
    max_tokens: 1024,
    output_config: {
      format: {
        type: 'json_schema',
        schema: headlineSchema,
      },
    },
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  };
}

function isTemperatureError(err) {
  return err?.status === 400 && /temperature/i.test(err?.message ?? '');
}

function blockLabel(block) {
  return block?.type === 'mcp_tool_use' ? `mcp_tool_use:${block.name}` : (block?.type ?? 'unknown');
}

function streamWithProgress(anthropic, useBeta, params, register, startedAt) {
  const stream = useBeta
    ? anthropic.beta.messages.stream(params)
    : anthropic.messages.stream(params);

  const elapsed = () => Date.now() - startedAt;
  stream.on('streamEvent', (event) => {
    if (event.type === 'message_start') {
      console.log(`[claude] register ${register}: stream connected (+${elapsed()}ms)`);
    } else if (event.type === 'content_block_start') {
      console.log(
        `[claude] register ${register}: content_block_start ${blockLabel(event.content_block)} (+${elapsed()}ms)`
      );
    }
  });
  stream.on('error', (err) => {
    console.warn(`[claude] register ${register}: stream error at +${elapsed()}ms: ${err.message}`);
  });

  const heartbeat = setInterval(() => {
    console.log(`[claude] register ${register}: still waiting (+${elapsed()}ms)`);
  }, 60_000);

  return stream.finalMessage().finally(() => clearInterval(heartbeat));
}

export async function generateHeadline({ register, candidatePosts, faxPosts }) {
  const model = process.env.GENERATION_MODEL || 'claude-haiku-4-5';
  const systemPrompt = buildSystemPrompt(register, faxPosts);
  const userMessage = buildUserMessage(register, candidatePosts);
  const anthropic = client();
  const useBeta = Boolean(process.env.MLB_MCP_URL);

  const temperature = register === 1 ? 0.7 : 1.0;

  console.log(
    `[claude] register ${register}: calling ${model} (mlb-mcp: ${useBeta ? 'enabled' : 'disabled'})`
  );
  const startedAt = Date.now();

  const call = (body) => {
    const params = useBeta
      ? {
          ...body,
          betas: [MCP_BETA],
          mcp_servers: [
            {
              type: 'url',
              url: process.env.MLB_MCP_URL,
              name: MCP_SERVER_NAME,
              ...(process.env.MLB_MCP_AUTH_TOKEN
                ? { authorization_token: process.env.MLB_MCP_AUTH_TOKEN }
                : {}),
            },
          ],
          tools: [{ type: 'mcp_toolset', mcp_server_name: MCP_SERVER_NAME }],
        }
      : body;
    return streamWithProgress(anthropic, useBeta, params, register, startedAt);
  };

  const body = { ...baseRequest(model, systemPrompt, userMessage), temperature };

  let response;
  try {
    response = await call(body);
  } catch (err) {
    if (isTemperatureError(err)) {
      console.warn('[claude] temperature rejected, retrying without');
      response = await call(baseRequest(model, systemPrompt, userMessage));
    } else {
      console.error(`[claude] register ${register}: call failed after ${Date.now() - startedAt}ms`);
      throw err;
    }
  }

  const elapsedMs = Date.now() - startedAt;
  const toolUseBlocks = response.content.filter((b) => b.type === 'mcp_tool_use');
  const toolResultBlocks = response.content.filter((b) => b.type === 'mcp_tool_result');
  const toolErrors = toolResultBlocks.filter((b) => b.is_error);
  console.log(
    `[claude] register ${register}: responded in ${elapsedMs}ms, stop_reason=${response.stop_reason}, ` +
      `mcp tool calls: ${toolUseBlocks.map((b) => b.name).join(', ') || '(none)'}` +
      (toolErrors.length ? `, ${toolErrors.length} tool error(s)` : '')
  );
  for (const errBlock of toolErrors) {
    const toolName = toolUseBlocks.find((b) => b.id === errBlock.tool_use_id)?.name ?? 'unknown';
    const text = (errBlock.content ?? [])
      .filter((c) => c.type === 'text')
      .map((c) => c.text)
      .join(' ');
    console.warn(`[claude] register ${register}: tool error from ${toolName}: ${text}`);
  }

  const draft = parseHeadlineResponse(response.content);
  draft.register = register;
  return draft;
}
