# Ingestion pipeline — real generation flow

Everything in `ingest/src/index.js` today is a stub: it inserts two hardcoded placeholder rows and uploads a demo image to prove the DB/storage write paths work. This doc specs the real flow described in the project spec's Architecture/Data Flow section — what actually needs to get built, and the concrete gotchas found while checking current API shapes.

## Data sources, and how each one actually gets called

| Source | How | Library / call |
|---|---|---|
| MLB Stats | **Claude's MCP connector**, not a hand-written client | `client.beta.messages.create` with `mcp_servers` + `mcp_toolset` (see below) |
| Reddit | Plain HTTP, OAuth2 client-credentials grant | native `fetch` — no PRAW (Python-only), see below |
| Bluesky | AT Protocol client | `@atproto/api` |
| FAX Sports | Plain HTTP, RSS-first | native `fetch`, no auth |
| Claude (headline generation) | Anthropic Messages API | `@anthropic-ai/sdk` |

### MLB Stats — via the MCP connector, not a REST wrapper

`mlb-api-mcp` (the [karanshukla fork](https://github.com/karanshukla/mlb-api-mcp) of guillochon/mlb-api-mcp) is a FastMCP server — **all its functionality is exposed as MCP tools over a `/mcp/` Streamable-HTTP endpoint, there are no REST endpoints to call directly.** Writing a Node client that re-implements each tool as a REST call isn't an option; the server doesn't have that surface.

The right integration point is the Claude API's **MCP connector** (beta), used directly inside the headline-generation call — this also happens to be exactly what the spec's Register 2 fact-checking requirement needs ("the generator needs a way to actually verify the connecting fact... give the generation step search/lookup access"). Instead of ingest fetching stats itself and stuffing them into the prompt, Claude gets the MCP server as a live tool and decides what to look up while drafting:

```js
const response = await anthropic.beta.messages.create({
  model: process.env.GENERATION_MODEL,
  max_tokens: 2048,
  betas: ['mcp-client-2025-11-20'],
  mcp_servers: [
    { type: 'url', url: process.env.MLB_MCP_URL, name: 'mlb-stats' },
  ],
  tools: [
    { type: 'mcp_toolset', mcp_server_name: 'mlb-stats' },
  ],
  messages: [...],
});
```

- `MLB_MCP_URL` should point at wherever the fork is deployed (the spec notes it's "already deployed separately" — reuse that deployment, don't stand up a second one). No `authorization_token` needed unless that deployment requires it.
- **This one has to be public, not Railway-private.** Unlike Postgres/MinIO, the MCP connector call is made *by Anthropic's own API infrastructure*, not by `ingest` — `mcp_servers.url` is fetched server-side from Anthropic's cloud, outside Railway's network entirely. A `*.railway.internal` address (private networking, same pattern used to keep MinIO off the public internet) is unreachable from there. So `mlb-api-mcp` needs its own public Railway domain, same as `handles`/`web` — confirmed as the intended approach; it's a read-only public-stats lookup with no secrets or write access to expose, so the risk of that is low. (The alternative — `ingest` running its own MCP client over the private network and pre-fetching stats as plain text instead of giving Claude a live tool — was considered and rejected, since it loses the model's ability to decide what to look up while drafting, which is the whole point of using it for the register-2 fact-checking requirement.)
- The `mcp_toolset` entry is what actually grants tool access — declaring `mcp_servers` alone without a matching toolset is a validation error.
- **Response parsing:** the reply will contain `mcp_tool_use` / `mcp_tool_result` content blocks alongside the final text. Verify the exact field names against current Anthropic docs or the installed SDK's types when writing this — don't hand-guess the shape.
- Only the Claude API (first-party) and Claude Platform on AWS support the MCP connector; it's not available on Bedrock or Vertex. Not relevant here since this project calls the first-party API, but worth knowing if that ever changes.

**Correction to the spec worth knowing:** the spec says Statcast-level metrics (exit velo, barrels, expected stats) are out of scope because "alex-rimerman/statcast-mcp is dropped — established as non-functional" and would be "a separate integration to revisit." That's not quite right — checking the actual tool surface of the currently-deployed `mlb-api-mcp` server, it already exposes `get_statcast_batter`, `get_statcast_pitcher`, and `get_statcast_team` as part of the same server (same namespace as `get_mlb_roster`, `get_mlb_standings`, etc.) — not a separate `alex-rimerman/statcast-mcp` server at all. So Statcast metrics are already available for free through the one MCP connection, no new integration needed. Worth using for punchlines (e.g. "exit velocity of 68 mph" as the tell-tale absurd-but-plausible number the spec's labeling philosophy leans on).

**Full tool list actually available** (for writing prompts that reference what Claude can look up): `get_mlb_standings`, `get_mlb_schedule`, `get_mlb_team_info`, `get_mlb_teams`, `get_mlb_player_info`, `get_mlb_players`, `get_mlb_roster`, `get_mlb_search_players`, `get_mlb_search_teams`, `get_mlb_boxscore`, `get_mlb_linescore`, `get_mlb_game_highlights`, `get_mlb_game_scoring_plays`, `get_mlb_game_pace`, `get_mlb_game_lineup`, `get_multiple_mlb_player_stats`, `get_mlb_sabermetrics`, `get_mlb_draft`, `get_mlb_awards`, `get_statcast_batter`, `get_statcast_pitcher`, `get_statcast_team`, `get_current_date`, `get_current_time`. `get_mlb_roster` supports roster-type filtering, which is what the spec's "injury/IL status" chained-fact requirement needs (Register 2 real-fact-anchored subtype) — pull the 40-man or active roster and check status rather than assuming.

### Reddit — no PRAW (it's Python-only); plain OAuth2 + fetch

The spec's Data Sources table says "Reddit — Free tier via PRAW," but PRAW is a Python library and `ingest` is Node. There's no equivalent decision to make here — just use Reddit's REST API directly, which is plain JSON over HTTPS and doesn't need a client library:

1. One-time: register a "script" app at reddit.com/prefs/apps, get a client ID + secret.
2. Each run: `POST https://www.reddit.com/api/v1/access_token` with `grant_type=client_credentials` (Basic auth: client ID/secret) → short-lived bearer token.
3. `GET https://oauth.reddit.com/r/Torontobluejays/new` with that bearer token + a descriptive `User-Agent` header (Reddit blocks generic/missing UAs) → recent posts (title, selftext, permalink, any image URL).
4. Filter against a `seen_ids` set (persist in Postgres — a small `seen_reddit_ids` table, or a JSON column on a state row) so re-runs don't re-surface the same posts.

`REDDIT_CLIENT_ID` / `REDDIT_CLIENT_SECRET` are already wired into the compose file and `.env.example` from the earlier scaffolding — no new env vars needed, just the fetch logic.

### Bluesky — `@atproto/api`

Standard app-password auth (`BLUESKY_APP_PASSWORD`, already wired). Search or list recent posts tagged `#BlueJays` / `#TorontoBluejays` via `agent.app.bsky.feed.searchPosts` (or the equivalent current method — check the installed `@atproto/api` version's docs, the API has moved around across versions). Same `seen_ids` filtering as Reddit.

### FAX Sports — RSS first, HTML fallback

`mlbonfax.com` is a Wix blog. Wix blogs commonly expose an RSS feed at `/blog-feed.xml` — check for that before writing an HTML scraper; RSS is far less brittle than parsing Wix's generated markup. If no feed exists, fall back to fetching the blog index page and extracting post links/excerpts with a lightweight parser (`cheerio` is the standard choice if this becomes necessary — don't add it speculatively). Either way: reasonable poll interval (this runs once per ingest cycle, every few hours, not more), and this content is a **style reference only** — it goes into the generation prompt to calibrate register-2 tone, never surfaced or linked on the live site (per the spec's explicit rule).

## The generation call

One call per register per drafted headline, using `@anthropic-ai/sdk`. Model comes from `GENERATION_MODEL` (default `claude-haiku-4-5`), read at call time — already a pattern the codebase should follow given the spec's explicit "swap without a redeploy" requirement.

**Gotcha: temperature isn't universally supported.** The spec's register logic calls for explicit temperature control (register 1 low/default, register 2 maxed at `1.0`). That works fine on the default model (Haiku 4.5 still accepts `temperature`) and on Sonnet 4.6 or older. But if `GENERATION_MODEL` ever gets swapped to Opus 4.7+, Sonnet 5, or Claude Fable 5, `temperature` is a **removed parameter that returns a 400** — those model tiers dropped sampling controls entirely in favor of `output_config.effort`. Since the model is meant to be swappable via env var without a code change, the generation call needs to branch: only send `temperature` when the configured model supports it (or catch the 400 and retry without it). This is exactly the kind of thing that'll silently break ingest the day someone bumps `GENERATION_MODEL` to try a better model — worth a comment in the code pointing here.

**Structured output.** Rather than parsing free text out of the response, use `output_config.format` with a `json_schema` matching the target shape:

```json
{
  "headline": "string",
  "register": "1 | 2",
  "player_ids": ["string"],
  "suggested_stat": "string",
  "source_note": "string | null"
}
```

This is a clean fit since the spec already defines exactly this output shape (`{ headline, register, player_ids[], suggested_stat, source_note }`).

**Prompt inputs per register:**
- Register 1: MLB Stats (via MCP, above) + a specific fetched Reddit/Bluesky post (text + image ref) as the thing being riffed on.
- Register 2: MLB Stats only — no real source, per spec ("no real source to credit for a fabricated premise"). FAX Sports posts go into the system prompt as style reference for both, not per-register content.

## Image handling (register 1, when a fetched post has an image)

The storage plumbing already exists (`ingest/src/storage.js` — `ensureBucket()` / `uploadImage()`). What's missing is the download step: when a register-1 draft reuses an image from the source Reddit/Bluesky post, fetch that image once, upload it to MinIO under a real key (not the stub's `stub/demo.jpg`), and set `photo_ref` to that key before inserting the draft row. Curated MLB/Wikimedia photos for register-2 drafts go through the same upload path, just sourced differently (manual curation, not scraped from the fetched posts — there's no real post to riff on for register 2).

## Open follow-ups (not blockers)

- **Runtime speed**: `ingest` is a good candidate to move to Bun (fast cold start matters for a job that runs fresh every cron tick) — see the top-level `docs/README.md` cross-cutting note. Not done; low risk if picked up later since `web`'s Astro/Node stack is unaffected either way.
- **`seen_ids` persistence**: needs a small schema addition (a `seen_posts` table or similar) — not in `db/schema.sql` yet.
- **Rate limits**: Reddit's free tier caps at 10k requests/month — the lightweight single-fetch-per-run pattern here stays well under that, but don't add per-comment fetching later without re-checking the budget.
