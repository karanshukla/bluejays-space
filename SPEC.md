# bluejays.space — Project Spec

This is the canonical product/design spec — the source of truth for *what* to build and *why*. It's referenced throughout `README.md` and `docs/*.md` as "the spec." Read this first; `docs/README.md` is the implementation roadmap derived from it, with the concrete technical decisions (env vars, request shapes, library choices) for what's left to build.

## Concept

An Onion-style parody headline site for Blue Jays fans, in the vein of FAX Sports. A human (Karan) drafts each headline directly in the admin UI; an LLM screens every draft for topic and safety before it's eligible to publish. (Originally specced as LLM-generated, human-reviewed — see the "Superseded by decision" note under Architecture for why drafting moved to the admin. The two-register concept below is still the target voice either way.) Headlines come in two registers:

**Real-event riffs** — grounded in an actual game/stat/moment (e.g. "Home Run Dragon found as lifeless as Trey Yesavage's pitching"). Low risk, straightforward fan commentary. Includes a lowest-risk subtype: reporting a true, independently checkable absurd fact (e.g. Googling "Jesus Sanchez" surfaces a Reddit meme photo of Jesús Sánchez as Jesus) — nothing fabricated or attributed, the joke is just that the true thing is funny. These should stay checkable, not just plausible.

**Fabricated-scenario jokes** — invented premises about real players, written deadpan as if real news (FAX Sports style: trade demands, fake suspensions, absurd stat lines). Higher risk, requires the parody label to do real work. Includes a real-fact-anchored variant: take a source post/meme (e.g. the Jesus Sánchez photo) and assert its premise as flat, deadpan fact — no meta-hedge like "Reddit joked that..." — then chain in one or more additional independently true facts to land the punchline. This isn't limited to a single connecting fact — the strongest versions chain several (e.g. Jesús Sánchez's real name + his real, currently-active injury status pulled fresh from the roster, not recalled + Pope Leo XIV's real identity as "Leo" repurposed as a fictional player name → "Jesus Sánchez, sidelined by ankle injury, rises after three days and hits a three-run homer off White Sox's Pitcher Leo"). This is the actual FAX Sports mechanic: they report fabricated premises as news, never as "someone joked that." The premise is fabricated even though every anchoring fact is real — that combination is what makes it land sharper than either a pure riff or a fully invented bit. Guardrails: (1) every anchoring fact must be verified via lookup, not recalled from memory — a plausible-sounding but wrong detail (e.g. assuming the Pope's team instead of checking it — he's White Sox, not Cubs) undermines the joke's credibility even though the premise itself is already understood to be fake; (2) when a fabricated character/name is introduced (e.g. "Pitcher Leo"), check it doesn't collide with a real active player of that name on the relevant team's actual roster — otherwise the joke accidentally makes a false claim about a real person instead of an obviously fictional stand-in. This means the generator needs roster/injury-status lookup access, not just standings — a player's current IL status is exactly the kind of live fact worth chaining in, and it changes daily.

**Escalation** — cranked absurdity, biblical-parody style: once a real-fact-anchored premise exists (Sánchez as Jesus), push it further into deliberately impossible territory rather than staying plausible-adjacent — miracles, resurrection framing, biblical language layered onto in-game events. Same mechanism as the km/h-as-mph trick from the labeling section: take a real detail and warp it (e.g. Sánchez's real IL stint, shortened to a biblically-loaded "three days"). The more impossible the specific claim, the less anyone could mistake it for real — absurdity itself does the disclosing, same as the site's core labeling philosophy. A further extension worth naming separately: this can put a real public figure from outside baseball (e.g. the Pope) into an outright impossible role (opposing pitcher, in-game commentator on a "miracle") rather than just fabricating a scenario about a real player in a plausible player-shaped role (trade, suspension). That's a bigger reach than the base pattern — the impossibility is what keeps it unambiguous satire, but it's a distinct move, not an automatic extension of the trade-rumor examples.

FAX Sports' own style — and its actual site content — can feed the generation prompt as a live reference, not just static tone notes. mlbonfax.com is a plain Wix-hosted blog, no auth wall, fetchable via normal HTTP — verified, it's not X-only. It should never be referenced on the live site itself as an affiliation or inspiration credit; their own bio explicitly disclaims affiliation with real outlets, and bluejays.space should carry the same clarity about itself, not about them.

**Hard rule: no AI-generated images of players.** Only real, sourced photos (MLB/team editorial-use photos, Wikimedia Commons public domain/CC, or screenshots of actual posts being riffed on). This is the single biggest risk-reduction decision in the whole project — it keeps the site out of deepfake-adjacent territory entirely.

A secondary feature: free Bluesky custom domain handles at `@username.bluejays.space`.

## Parody Labeling — Present, Not Prominent

The core joke is the FAX Sports mechanic: headlines get taken as real precisely because they're delivered completely straight, right up until the absurdity of the specific number/claim gives it away (their "150mph" pitch that's actually km/h is the model — the tell is baked into the content itself, not a warning label). That only works if the site never actually goes out of its way to prevent the misread.

So the label exists, but it's small — same tier as FAX Sports' own bio line ("PARODY account. Not affiliated with...") that sits there on every post and gets skipped past by anyone scrolling fast. Concretely:

- A small, standard parody/satire label somewhere on the page (footer or an About page is enough) — present so the site is never actually claiming to be real, but not sized, positioned, or watermarked to survive or interrupt a screenshot
- No card-graphic watermark, no per-post disclaimer, no friction before a headline can be shared — the label lives at the site level, not the content level. This is about the on-page scrapbook card itself (what a visitor would screenshot) — it stays exactly as clean as any other card.
- **Exception, decided**: the auto-generated Open Graph/social-preview image (what renders when a permalink is shared and unfurls on Bluesky/Discord/iMessage — see Sharing & Discovery below) *does* carry the small parody label baked into the image. Rationale: an OG card is site-level metadata about the page, not the content-level card graphic the bullet above protects, and it's the one artifact that can travel furthest from the site's own footer disclosure — a link that unfurls with zero label anywhere is the actual risk case this section exists to avoid. Keep it the same small, easy-to-skip-past size as the footer label — this isn't a reversal of "present, not prominent," just extending it to a second surface.
- The joke does the disclosing, not the UI: absurd-but-plausible numbers (km/h read as mph, a stat that's one digit too clean, an age that's technically true but framed misleadingly) are what tips off a careful reader, same as FAX Sports' actual mechanic

## Features

### 1. Handle Directory

Fans can claim a Bluesky handle at `@username.bluejays.space`.

- User submits desired username + their Bluesky handle via a simple form
- Backend resolves their handle to a DID via the Bluesky API
- App serves the DID at `https://username.bluejays.space/.well-known/atproto-did`
- Wildcard subdomain (`*.bluejays.space`) routes all subdomains to a single app
- Basic username validation: alphanumeric + hyphens, no squatting (must verify Bluesky ownership via DID match)
- **Storage, decided**: DID mappings live in a JSON file (`handles/handles.json`) committed to this repo, not Postgres. A submission opens a GitHub PR against that file (with rate limiting and a dupe-DID check); merging the PR *is* the human review gate — same "no autonomous publishing" philosophy as the headlines flow, implemented as git review instead of an admin-UI approve button. This supersedes the Postgres design implied by an earlier draft of this spec. See `handles/README.md` and `docs/backend-api-plan.md` item 6 for the full rationale (free git audit trail + rollback; accepted tradeoff: a submission needs `GITHUB_TOKEN` write access to this repo, and a merge needs a redeploy — or Railway's git-auto-redeploy on merge to `main` — before a newly approved handle resolves).

### 2. Headline Feed ("The Scrapbook")

A mobile-first card feed of parody headlines, enriched with real player stats and paired with real photos.

Each card shows:
- The headline (AI-drafted, human-tweaked)
- Real stat context pulled from MLB Stats API (grounds the joke, and for register-1 riffs, is often the punchline setup)
- A real, sourced photo of the relevant player (never AI-generated)
- Parody label baked into the card graphic
- Optional "inspired by" note if a specific real post/moment sparked it (register 1 only — register 2 has no real source to credit)

#### Data Sources (original generation pipeline — superseded, see Architecture)

These were the fetch inputs for the original LLM-generation step (MLB Stats context + candidate posts + style reference, drafted into a headline unattended). That step is retired — headlines are now admin-authored, so nothing in the current app fetches from these sources. Kept for why the register concepts (real-fact grounding, "inspired by" sourcing) look the way they do; an admin doing the same real-fact-anchoring by hand can still use these as reference sources manually.

| Source | Access | Notes |
|---|---|---|
| MLB Stats | `guillochon/mlb-api-mcp` (tested working) | Team record, standings, recent games, boxscores, player info, roster/injury status — sole stats source for both registers. Injury/IL status specifically matters for chained-fact register-2 jokes and changes daily, so it needs a fresh lookup each generation run, not a cached value |
| Bluesky | Free, open API | Recent posts/comments pulled as candidate source material for register 1 — specific posts (text + image), not just aggregate tone/flavor. Searches a widened set of hashtags/phrases (`#BlueJays`, `#TorontoBluejays`, `#GoJaysGo`, `#BlueJaysBaseball`, `"Toronto Blue Jays"`), not just the original two tags |
| Reddit | Free tier via PRAW | Recent posts/comments from r/Torontobluejays pulled the same way — lightweight fetch only, no classifier/vision/dedup pipeline like the old design |
| Mastodon | Free, open public hashtag-timeline API, no auth needed | Recent hashtag posts (`#BlueJays`, `#TorontoBluejays`, `#GoJaysGo`) from a configurable instance (default `mastodon.social`), pulled the same way as Bluesky — text + image, candidate source material for register 1. Federated, so one instance's hashtag timeline is best-effort breadth, not a global index |
| FAX Sports | mlbonfax.com — plain Wix blog, no auth wall, fetchable via HTTP | Recent posts pulled as a live tone/style reference for register 2 (their "Cancun," "Statfax," "Hot Stove" categories are useful signal for current voice). Content and style only — never credited or linked on the live site |
| Player photos | MLB/team editorial-use photos, Wikimedia Commons (public domain/CC), reused fan-created images from a sourced Reddit/Bluesky/Mastodon post (e.g. an existing meme edit), or screenshots of actual posts being riffed on | Must be rights-cleared for the use case; never AI-generated. Reused fan images keep a "Source: Reddit/Bluesky/Mastodon" credit, same as the platforms' own convention — **this row still applies**, admin photo import isn't limited to MLB/Wikimedia |

`alex-rimerman/statcast-mcp` was dropped as non-functional before the pipeline itself was retired; Statcast data was in fact already available through `mlb-api-mcp` — see `docs/archive/ingestion-pipeline.md` for that correction as historical detail.

#### Content Management — Admin UI

Headlines are DB-backed, not git-file-based (Astro Content Collections don't fit a login-and-publish workflow — those are for git-committed content, not live editing). A `headlines` table holds draft and published rows; the admin page is CRUD against it.

- **Auth**: gate `/admin` behind Cloudflare Access, same pattern already in use for the Asher Remote MCP server — no custom auth to build
- **Flow**: admin creates a draft (`status: draft`) directly in the admin UI → the classifier job assigns a topic category + safety verdict (auto-discarding `blocked` drafts) → admin page lists remaining drafts → edit text inline → publish flips `status: published` and sets a timestamp → public feed only queries published rows. Register-2 real-fact-anchored drafts (fabricated premise + a real connecting fact) should be visually flagged in the admin list for extra scrutiny — the connecting fact is the one part of an otherwise-fictional headline that's a genuine factual claim, and needs to actually be checked before publish, not just skimmed.
- **Fields per row**: `headline`, `register` (1 or 2), `player_ids[]`, `stat_block`, `photo_ref`, `source_post_url` + `source_note` (register 1 only), `status`, `created_at`, `published_at`

### 3. Sharing & Discovery

The whole point of a FAX-Sports-style site is that individual headlines get shared — a feed with no way to link, unfurl, or subscribe to a single entry undercuts the concept. This feature has a full, ready-to-implement technical spec in `docs/frontend-roadmap.md` § 1 — this section states the product requirement and the decisions already made; that doc carries the route paths, exact meta tags, and library choices.

- **Permalinks**: every published headline gets its own stable, shareable URL (`/h/{id}`) showing that one card — headline, stat block, photo, source note — standalone. A draft's URL 404s rather than leaking unreviewed content.
- **Open Graph / Twitter Card previews**: sharing a permalink on Bluesky/Discord/iMessage/Slack renders a real preview card (title, image, description), not a bare link. The preview image is generated per headline (headline text + stat block composited over the photo), not just the raw stored photo — see the Parody Labeling section above for the one content decision this feature required: the generated preview image carries the same small parody label as the site footer.
- **RSS feed** (`/feed.xml`) of published headlines — lets people follow the site without an account (accounts are out of scope, see below).
- **Sitemap** (`/sitemap.xml`) and **`robots.txt`** — the public feed and every permalink are indexable; `/admin` is explicitly excluded from both (Cloudflare Access already blocks crawlers from reading it, but there's no reason to advertise the path either).
- **Favicon** — a real mark, not a placeholder/broken-icon default. **Shipped** as a 32/256px PNG + apple-touch-icon + `.ico` fallback, sourced from a public-domain U.S. Fish & Wildlife Service Blue Jay photo (Dave Menke, DeSoto NWR) — see `docs/frontend-roadmap.md` § 1.7 for the deviation from the original palette-mark idea and the source link.

## Architecture

Three Railway services + managed Postgres + Cloudflare in front. Everything automated except the admin review step.

| Service | Type | What it does |
|---|---|---|
| `bluejays-classify` | Railway cron job (scheduled, not always-on) | Classifies existing draft headlines: assigns each a topic category + safety verdict via Claude (text + attached photo, vision), auto-discarding illegal/doxxing content and flagging the rest for admin review. Does not fetch content or write headlines itself — see note below. |
| `bluejays-web` | Railway always-on service (Astro SSR, Node adapter) | Serves the public feed (published rows only), the `/admin` authoring/review UI (create, edit, publish draft rows), and photo import/proxy |
| `bluejays-db` | Railway managed Postgres | `headlines` table (draft/published) + handle directory DIDs |

Two services, not one, because the classifier job is bursty and scheduled (runs periodically, does its work, exits) while the web app needs to be always-on to serve traffic — different Railway deployment types, no reason to force them into one process.

> **Superseded by decision:** `bluejays-classify` was originally specced as an autonomous fetch-and-generate pipeline (Reddit/Bluesky candidate posts + MLB Stats context → Claude headline drafting, the "Data Flow" and "Register Logic" design below). That pipeline was built, then retooled: headlines are now authored directly by the admin in `/admin` (see `web/src/pages/admin/api/headlines/create.ts`), and `classify` only classifies them for topic + safety before human review. The original design is kept as historical context in `docs/archive/ingestion-pipeline.md`; see `docs/README.md` → "MVP status" for why it changed. The rest of this section describes the original design and is retained for that context — it does not describe what's currently deployed.

### Data Flow (original design — superseded, see note above)

```
Railway cron trigger (e.g. every 4-6h)
  ↓
bluejays-classify run:
  1. fetch_reddit() — PRAW, r/Torontobluejays, filtered against seen_ids
  2. fetch_bluesky() — atproto, #BlueJays / #TorontoBluejays, filtered against seen_ids
  3. fetch_faxsports() — plain HTTP fetch of recent mlbonfax.com posts, used as live style reference (not a joke source, no player/team overlap needed)
  4. fetch_mlb_context() — MLB Stats MCP only: record, standings, recent games (Statcast MCP dropped — non-functional)
  5. for each register:
       generate_headline(context, candidate_posts, style_reference, register, temperature)
       → { headline, register, player_ids[], stat_block, source_post_url, source_note }
  6. if register 1 headline reuses a fetched image → download + store to object storage,
     save the storage ref (not a hotlink to Reddit/Bluesky's CDN)
  7. insert draft row(s) into headlines table
  8. mark fetched IDs as seen
  ↓
bluejays-web (always-on):
  /admin  → lists draft rows, inline edit, photo swap if needed, publish button
          → publish sets status=published, published_at=now()
  /        → queries published rows only, renders public feed
```

**Current data flow:** an admin authors a draft directly in `/admin` (headline, register, stat block, source note, photo — the photo either uploaded, pasted, or imported from a URL); `bluejays-classify` periodically classifies any draft with `classified_at IS NULL`, writing back `category`/`safety_status`/`safety_reason` and auto-discarding `blocked` verdicts; the admin reviews (safety flag included) and publishes.

### Image Storage

Don't hotlink externally-hosted images directly on the live site — a source CDN URL isn't guaranteed stable and a dead image on a published card looks broken, not funny. On admin photo import (upload, clipboard paste, or URL fetch), the source image is downloaded/re-encoded once and stored in object storage. The `photo_ref` field in the headlines table points at the stored object, not the original URL. Curated MLB/Wikimedia photos go through the same storage path so the admin UI and public site only ever deal with one kind of image reference.

(Original spec called for Cloudflare R2 here. **Superseded by decision**: self-hosted MinIO instead — see `README.md` → Production (Railway) and `docs/README.md` for why.)

### Auth & Networking

- Cloudflare sits in front of `bluejays-web`'s Railway domain, same as the Asher Remote MCP setup
- `/admin` path gated by Cloudflare Access; public feed paths are open
- No auth needed on `bluejays-classify` — it's a scheduled job with no public HTTP surface, just DB write access

### Secrets (Railway env vars)

- `ANTHROPIC_API_KEY` — Claude classification calls (`classify`); required, the job exits non-zero without it
- `CLASSIFIER_MODEL` — model string for the classifier (e.g. `claude-haiku-4-5`), read at call time, not hardcoded — swap without a code change or redeploy of logic
- `DATABASE_URL` — Postgres connection, shared by both services
- Object storage credentials (bucket, access key, secret) — see `docs/README.md` for the current MinIO-based env vars
- `SITE_URL` — the canonical production origin (`https://bluejays.space`), used to build absolute URLs for Open Graph/Twitter meta tags, the RSS feed, and the sitemap — none of those can be correct with only a relative path, and Astro/Railway don't infer it automatically at request time
- `CF_ACCESS_TEAM` / `CF_ACCESS_AUD` — Cloudflare Access JWT verification for `/admin` (`web`)

(The original design also used `GENERATION_MODEL`, `REDDIT_CLIENT_ID`/`REDDIT_CLIENT_SECRET`, `BLUESKY_APP_PASSWORD`, and an MLB Stats MCP server URL — all retired along with the fetch/generate pipeline, see the note under Architecture above.)

## Register Logic (Generation Detail — original design, superseded)

This section describes the original two-register generation design, retained as historical context (see the "Superseded by decision" note under Architecture). It does not describe the current classifier — see "LLM Usage" below for that.

```
[MLB Stats context] + [recent Reddit/Bluesky posts, text+image] + [recent FAX Sports posts, live style reference]
                            ↓
              [LLM headline generation]
              - Register 1: real-event riff — may draw directly on a specific fetched post (text/pun/image) as source material
              - Register 2: fabricated-scenario, deadpan real-news framing — no real source, MLB Stats context only
              - Output: draft headline + suggested stat block + suggested player tag + source post/image ref (register 1 only)
                            ↓
              [Store as draft row in headlines table]
                            ↓
              [Admin UI — Karan reviews/edits, selects photo, hits publish]
                            ↓
              [status: published — visible on public feed]
```

No autonomous posting. Every headline sits as a draft until it's published through the admin UI — this replaces a confidence-threshold/staging-table gate with something simpler and more reliable, since the person who has to stand behind the joke is reviewing every one of them anyway. **This constraint still holds** in the current design — see [`docs/archive/admin-security.md`](./docs/archive/admin-security.md) and `CLAUDE.md` → Non-negotiable.

The register 1/register 2 headline styles themselves are still the target voice for what an admin writes by hand in `/admin`; only the *generation* step (an LLM drafting the headline unattended) was retired, not the two-register concept.

## LLM Usage

The LLM classifies; it does not draft or publish. Headlines are authored directly by the admin in `/admin`. One classification step per draft, replacing the original single generation step described above.

**Draft Classifier** (`classify/src/classify.js`)
- Inputs: the draft's headline text, stat block, and source note, plus its attached photo when present (Claude vision)
- Task: assign a topic category (`game-recap`, `trade-rumor`, `stat-line`, `injury`, `roster-move`, `fabrication`, `off-field`, `other`) and a safety verdict (`safe`, `review`, `blocked`) — see `classify/src/classify.js` → `buildSystemPrompt()` for the full rubric, which is written to account for this being a parody site (fabricated scenarios and rough-on-the-field commentary about public figures are expected and safe; doxxing, threats, and sexualization of minors are always `blocked`)
- Output: `{ category, safety_status, safety_reason }`, written back onto the draft row (`category`, `safety_status`, `safety_reason`, `classified_at`)
- `blocked` verdicts are auto-discarded (`status = 'discarded'`) without admin action; `safe` and `review` just get flagged for the admin, who is the actual publish gate either way

**Model**: configurable via `CLASSIFIER_MODEL` env var, not hardcoded — default `claude-haiku-4-5`, swappable without touching code. Structured output via `output_config.format` (JSON schema), no streaming — a short call per draft. Some Claude model tiers reject the `temperature` parameter entirely; the call retries once without it on a matching 400 if `CLASSIFIER_MODEL` is swapped to one of them (see `classify/src/classify.js` → `isTemperatureError`).

## Frontend

- Astro + Tailwind, SSR mode with the Node adapter (needed for the DB-backed feed and admin API routes, not just static content)
- Public feed pages ship zero/minimal JS by default (Astro's islands model) — the admin page is the one place that needs an interactive island (a Svelte or React form component) for inline editing
- Mobile-first, WCAG compliant
- Card-based feed — no exotic layouts
- Typography: expressive font for the headline, clean sans-serif for stat context
- Small, standard parody/satire label at the site level (footer/About), per the labeling section above — not rendered onto individual card graphics
- Aesthetic reference: The Pudding — data-forward, readable, a bit of character
- Per-headline permalink pages ship the same zero/minimal-JS posture as the feed — a permalink is a public read page, not an interactive one, same rule as the feed itself

## Tech Stack

| Layer | Choice | Notes |
|---|---|---|
| Hosting | Railway | All three services — see Architecture |
| Runtime | Astro (SSR, Node adapter) | Public feed + handle directory + admin API routes in one app; islands keep public pages light, admin page is the one interactive part |
| Styling | Tailwind CSS | Utility classes for the card feed, handle directory, and admin UI |
| DB | Postgres (Railway managed) | Headlines table (draft/published) + handle directory DIDs |
| Image storage | Self-hosted MinIO (superseded from Cloudflare R2 — see above) | Downloaded copies of reused Reddit/Bluesky images + curated player photos — never hotlinked |
| Auth (admin) | Cloudflare Access | Same pattern as the Asher Remote MCP server — gates `/admin`, no custom auth code |
| DNS | Cloudflare | Wildcard subdomain for handle directory |
| LLM (draft classification) | Claude, model configurable via `CLASSIFIER_MODEL` env var (default Haiku 4.5) | Assigns topic category + safety verdict per draft (text + image); admin authors every headline directly, model swappable without code changes |
| Photo sourcing | Curated library (MLB/Wikimedia) + reused fan images, both stored in object storage | No AI image generation |

(`guillochon/mlb-api-mcp`, the Reddit and Bluesky fetch clients, and the FAX Sports scrape were part of the original generation pipeline and are retired — see the "Superseded by decision" note under Architecture.)

## Constraints & Risks

| Risk | Mitigation |
|---|---|
| Hotlinking externally-hosted images | Images are downloaded once on admin photo import and stored in object storage; `photo_ref` always points at the stored object, never at a source CDN |
| Fabricated statements about real, named players read as real news | Intentional, to a point — this is the core joke. Mitigated by keeping a genuine parody label at the site level (never zero disclosure) — including on the generated Open Graph preview image a shared permalink unfurls as, so the label travels with a link even off the live page — and by leaning on absurd-but-plausible details (the km/h-as-mph trick) as the actual tell, rather than escalating headline plausibility indefinitely |
| Photo rights | Only editorial-use/public-domain/CC-sourced photos, never AI-generated; verify license per source before use |
| A headline in poor taste or off-brand | Every headline is admin-authored and passes classification (topic + safety verdict) before it's even eligible to publish — no autonomous publish |
| "Funny" is subjective | Human authorship and review is the actual quality gate, not a classifier threshold — the classifier only screens for illegal/unsafe content, not for being funny |
| LLM cost at scale | Default classifier model (Haiku) is cheap and only runs once per draft, not per generation attempt |

## Out of Scope (v1)

- Vision-model meme/image classification
- AI-generated player images — hard rule, not just v1 scope
- Autonomous/unreviewed publishing — every headline is human-edited before it's stored
- Instagram (API access not worth the effort)
- User accounts / voting / curation by fans
- Native mobile app
