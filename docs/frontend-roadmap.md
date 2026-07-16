# Frontend follow-up — sharing, scale, and the polish `docs/archive/ui-plan.md` left open

The admin island, self-hosted display font, and real alt text all shipped (see `docs/archive/ui-plan.md`). The entire sharing/discovery section (§ 1 — permalinks, OG/Twitter tags, RSS, sitemap, robots.txt, and the dynamic per-headline OG image) has now shipped. Below also covers what's left of the original visual/a11y punch list, feed pagination, and the handles site's UI, which nothing has touched yet.

## 1. Sharing & discovery — shipped

All of § 1 has shipped: SITE_URL config (§ 1.0), permalinks (§ 1.1), OG/Twitter meta tags (§ 1.2), the dynamic per-headline OG image (§ 1.3), RSS (§ 1.4), sitemap (§ 1.5), robots.txt (§ 1.6), and favicon (§ 1.7). Individual headlines are now shareable with real preview cards. See `SPEC.md` → "Sharing & Discovery" and the Parody Labeling section for the product-level calls. What's below is the original spec, annotated with what shipped.

### 1.0 Prerequisite: canonical site URL — shipped

`SITE_URL` is in `.env.example` (default `http://localhost:4321`), the `web` service's docker-compose `environment:` block, and `site: process.env.SITE_URL` is in `web/astro.config.mjs`'s `defineConfig`. Production sets `SITE_URL=https://bluejays.space` in the Railway dashboard. Every absolute-URL call site (`og:image`, RSS `<link>`, sitemap `<loc>`) now goes through `new URL(path, Astro.site)` with a localhost fallback when `Astro.site` is unset.

### 1.1 Per-headline permalink page — shipped

- Route: `web/src/pages/h/[id].astro` (SSR, `prerender = false`).
- `getHeadlineById(id: number): Promise<Headline | null>` in `web/src/lib/db.ts`, `WHERE id = $1 AND status = 'published'` — a draft/discarded id returns `null`, never the row. Covered by a unit test (`db.test.ts`) asserting the 404-on-draft invariant.
- Page behavior: `null` or a non-positive/non-numeric id → `new Response('Not Found', { status: 404 })`. Verified: draft id, id=0, negative id, non-numeric id, and non-existent id all return 404.
- Found → renders `HeadlineCard.astro` (the shared component extracted from `index.astro`'s inline `.map()` block — both pages now render it, markup doesn't fork). Card gets the same tape variant the feed would (`TAPE_VARIANTS[h.id % TAPE_VARIANTS.length]`, exported from the component). A "← Back to the feed" link sits above the card.

### 1.2 Open Graph / Twitter Card meta tags — shipped

`Base.astro`'s `Props` extended with `description?`, `ogImage?`, `ogType?` (default `'website'`), `canonicalPath?`. The `<head>` now emits `<link rel="canonical">`, `og:site_name`, `og:title`, `og:description`, `og:image`, `og:url`, `og:type`, `twitter:card` (`summary_large_image`), the mirrored `twitter:*` fields, and an RSS autodiscovery `<link rel="alternate" type="application/rss+xml">`. All absolute URLs go through `new URL(path, Astro.site)` with a localhost fallback. Default description: "Parody Blue Jays headlines. Not affiliated with MLB or the Toronto Blue Jays."

- `index.astro` passes no overrides (site-wide defaults, `ogType="website"`).
- `h/[id].astro` passes `title={headline.headline}`, `description={headline.stat_block}`, `ogType="article"`, `canonicalPath={/h/${id}}`. `ogImage` is not overridden yet (points at the static `/og-default.png`) — § 1.3 will wire the per-headline card here once it lands.
- Static fallback `web/public/og-default.png` shipped (1200×630, blue palette background, white "bluejays.space" wordmark) so `og:image` is never empty.

### 1.3 Dynamically-generated OG images — shipped

**Implemented exactly as the decided spec below.** `satori` + `@resvg/resvg-js` render in-process inside `web`, cached in the existing MinIO bucket under `og/{id}-{hash}.png` (content hash of `headline|stat_block|photo_ref`). The Satori typography risk the spec flagged ("check that Satori's flexbox-only engine turns out too limited against the real Fraunces/Space Mono typography") was validated before committing — the prototype rendered cleanly with both fonts at the intended sizes, no missing glyphs. Key implementation details:
- **Render module** `web/src/lib/ogImage.ts`: lazy-loads the Fraunces 600 + Space Mono 400 `.woff` files (Satori takes TTF/OTF/WOFF, not woff2) from `@fontsource`, resolved from `process.cwd()` (not `import.meta.url`, which points into `dist/` in the built image). Renders in the **scrapbook aesthetic**: cream-blue paper background, white card stock with paper-edge border + dual shadow, washi tape strip (diagonal blue/white stripe) across the top, headline in Fraunces navy ink, stat block in Space Mono with dashed blue divider, parody label in the footer.
- **Route** `web/src/pages/api/og/[id].png.ts`: cache check → render → upload → serve, with a process-local in-flight `Map` deduplicating near-simultaneous renders for the same key. On render failure, 302s to `/og-default.png` so a crawler never sees a broken image. No UA gate on this route (publicly fetchable like `/api/images/*`).
- **Crawler gate** in `h/[id].astro`: only crawlers (Discordbot, Bluesky Cardyb, Twitterbot, Slackbot, facebookexternalhit) get `og:image` pointed at the dynamic route; normal browser visits use the static fallback (no render needed for a human already reading the page).
- **Still open — photo compositing**: the current OG card does not embed the headline's `photo_ref` image. The card looks like a scrapbook clipping (tape, paper, fonts) but without the polaroid-mounted photo the live feed card has. Compositing the photo requires fetching it from MinIO → base64 data URL → passing to Satori as an `<img>` in the tree. Not hard, but deferred — the card reads correctly without it, and the original spec didn't require it. Worth doing before treating § 1.3 as fully "done" rather than just "shipped."

A static `og:image` (just the stored `photo_ref`) previews as a bare photo with no headline text — the thing actually read at a glance in an unfurl. Build a real per-headline card instead: headline text + stat block composited over the photo, parody label in the corner (per `SPEC.md`'s Parody Labeling section — this is the one case where the generated image, unlike the live-page card, carries the label). `karanshukla/navyfragen-app`'s `opengraph-service` is a useful reference for the *pattern*, not to be ported wholesale — its scale-specific parts don't apply here (see below).

**Render step, decided**: `satori` (renders a JSX/HTML-like tree to SVG, flexbox/grid-subset CSS only) + `@resvg/resvg-js` (SVG → PNG), both called **in-process inside `web`**, no separate Railway service, no headless browser. This is a smaller footprint than navyfragen's sibling `html-to-image` microservice, which exists there because its render backend is shared across multiple services/features at a different scale — bluejays.space has one Astro/Node service and one caller. Revisit only if Satori's flexbox/grid-only layout engine turns out too limited for the actual card design once someone tries it against the real Fraunces/Space Mono typography — check that before committing further, but start here.

**Trigger, decided — crawler-gated, not always-on**: don't render on every permalink hit; only when the request's User-Agent matches a known link-preview bot (`Bluesky Cardyb`, `Discordbot`, `Twitterbot`, `Slackbot`, `facebookexternalhit`). Check this in `h/[id].astro` itself (no middleware change needed — it's one route) before deciding whether to serve the cached/generated image URL or just the static fallback inline in the initial HTML; the actual PNG is served from a separate `web/src/pages/api/og/[id].png.ts` route that crawlers' `og:image` fetch hits directly (that route renders unconditionally when called, since by the time it's hit the crawler check already happened at the referring permalink — or, simpler and just as correct, skip the UA check on the image route entirely and let it be publicly fetchable like `/api/images/*` already is; the UA gate's only real job is avoiding rendering it inline for a normal browser visit that doesn't need it).

**Caching, decided**: store generated PNGs in the existing MinIO bucket (already wired for photos, already has `web`'s `/api/images/*` proxy pattern to reuse) under key `og/{id}-{hash}.png`, where `hash` is a short SHA-256 (first 12 hex chars is plenty) of `` `${headline}|${stat_block}|${photo_ref}` ``. A content hash — not a bare TTL — makes invalidation exact: an admin edit changes the hash, so the old cached PNG is simply never looked up again (a stale orphan, cleaned up the same pass as `docs/backend-api-plan.md` item 3's general orphaned-image sweep — no separate cache-eviction mechanism needed). This sidesteps needing a new `updated_at` column on `headlines` purely for cache-busting.
- `api/og/[id].png.ts` logic: compute the hash, check MinIO for `og/{id}-{hash}.png`, serve it if present; otherwise render via Satori/resvg, upload to that key, serve the bytes. Add a process-local in-flight `Map<string, Promise<Buffer>>` keyed on the same `{id}-{hash}` so two near-simultaneous crawler hits for a newly-published headline share one render instead of racing two.

### 1.4 RSS feed — shipped

Uses `@astrojs/rss`. `web/src/pages/feed.xml.ts` is an SSR `GET` handler returning `rss({ title, description, site: context.site ?? localhost, items })`. Items sourced from `getRecentPublishedHeadlines(50)` — reuses the existing query (just a larger limit) rather than adding a new variant. Each item maps `title` → headline, `pubDate` → `published_at`, `link` → `/h/${id}`, `description` → `stat_block`. An RSS autodiscovery `<link rel="alternate">` is in `Base.astro`'s `<head>`.

### 1.5 Sitemap — shipped

Hand-written SSR route (`web/src/pages/sitemap.xml.ts`, not the `@astrojs/sitemap` integration — that can't enumerate dynamic `/h/{id}` permalinks). Queries `getPublishedHeadlines`, emits a `<urlset>` with one `<url>` for `/` and one per `/h/{id}`, every `<loc>` built from `Astro.site` (SITE_URL). `/admin` and `/admin/api/*` are never included. Returns `Content-Type: application/xml`.

### 1.6 `robots.txt` — shipped

Static file at `web/public/robots.txt`:
```
User-agent: *
Disallow: /admin
Sitemap: https://bluejays.space/sitemap.xml
```
(Cloudflare Access already blocks crawlers from reading `/admin`'s content — this is a non-security second layer, purely about not advertising the path.)

### 1.7 Favicon — shipped

`web/public/` now exists with `favicon-32.png`, `favicon-256.png`, `apple-touch-icon.png`, and `favicon.ico`, all wired into `Base.astro`'s `<head>` (`<link rel="icon" ...>`, `<link rel="apple-touch-icon" ...>`, `<link rel="shortcut icon" ...>`).

**Deviation from the original plan, decided in flight:** the plan above called for a palette mark (`favicon.svg` in `#134a8e`/`#c8102e`). What shipped is a real Blue Jay photo cropped to icon sizes — a 32/256px PNG + 180px apple-touch-icon + `.ico`, sourced from a public-domain U.S. Fish & Wildlife Service photo (Dave Menke, DeSoto National Wildlife Refuge; [Wikimedia Commons source](https://commons.wikimedia.org/wiki/File:Cyanocitta_cristata_FWS.jpg)). Rationale: a recognizable bird reads better at 32px than an abstract two-color mark, and a public-domain government photo keeps the rights story as clean as the MLB/Wikimedia photo path the feed already uses. An SVG palette mark is still a reasonable future polish (crisper at all DPRs, smaller), but the "not a broken/default browser icon" bar is met.

## 2. Public feed pagination

`getPublishedHeadlines()` has no `LIMIT`/offset and `index.astro` renders every published row in one page load. Fine today; not fine once the feed has months of headlines.

**Decided: classic `?page=N` query-param pagination**, not infinite scroll — infinite scroll needs a client-side island and a "load more" API route, breaking the "public pages ship zero/minimal JS" mandate in `SPEC.md` for no strong offsetting benefit at this content volume.

- Page size: **30** headlines per page.
- `getPublishedHeadlines(limit: number, offset: number)` — change the existing signature (no separate paginated variant; every caller passes explicit values, `index.astro` computes `offset = (page - 1) * 30` from `Astro.url.searchParams.get('page')`, defaulting to `page = 1` when absent, invalid, or `< 1`).
- Out-of-range `page` (past the last page) renders the existing empty-feed state ("No headlines published yet" copy, or a small "No more headlines" variant) rather than 404ing — simpler edge-case handling for a low-traffic site, and consistent with treating pagination as a display concern, not a routing one.
- Prev/next links: plain `<a href="/?page=N">` at the top and bottom of the card grid, omitted on whichever end has no adjacent page (no page 0 link, no next-page link past the last page).
- Land this alongside `docs/backend-api-plan.md` item 7 — the query and the page render together, not as two separate changes.

### 2a. Wide-screen scrapbook stretch — shipped

The scrapbook used to cap at 3 columns at the `lg` (1024px) breakpoint and sit in a `max-w-6xl` (1152px) container, so on a 1440px+ or 1920px+ display the feed left a lot of horizontal dead space and stacked more cards vertically than it needed to. **Shipped** in PR #70: the container is now `max-w-[1600px]` (`index.astro`) and the `.scrapbook-grid` media ladder in `global.css` adds two tiers — `column-count: 4` at ≥1440px, `column-count: 5` at ≥1920px. Mobile/tablet (<640px) stays single-column as before; the tilt, tape pseudo-elements, and `break-inside: avoid` all key off `.scrapbook-grid > li` and carry over to the new columns with no JS. Less vertical scrolling on widescreen, no change to the mobile feed.

## 3. Admin redesign — shipped

The admin page (`admin.astro` + `DraftCard.svelte`) shipped originally as functional scaffolding (neutral grays, single-column, plain form controls). **Shipped in PR #70** as a redesign in the scrapbook brand palette (navy ink on cream card stock, blue accents, paper-edge borders, tape-style status badges) with a two-column desktop layout: the draft queue is the wider left column, and a right rail holds the create-from-scratch `<details>` form and the "Recently published" list (sticky at `top: 2rem`). Below the `lg` (1024px) breakpoint it stacks to one column. All field names, field types, the create-form's `POST` action, and the DraftCard API contract (`fetch` to `/admin/api/headlines/[id]/{update,publish,unpublish,discard}`) are unchanged — pure markup/class restructure. The 8 user-facing em dashes in admin copy were also removed (`→` middot or sentence break); code-comment dashes were left alone.

## 4. Handles site UI

`handles/templates/index.html` + `handles/static/` (Go service, server-rendered HTML + a small JS spinner for async PR-creation polling) hasn't had any design pass — it predates the Fraunces/Tailwind work done on `web`. Since it's a separate Go binary with its own template, it can't just inherit `web`'s Tailwind build; either hand-write matching CSS or accept it'll look visually distinct from the main site (it already lives on a different subdomain, `handles.bluejays.space`, so some visual distinction is less jarring than it would be on the same domain). Low priority relative to items 1-2, but worth a pass before treating the handles feature as "done" rather than "functional."

## 5. Remaining items from the archived UI plan, not yet re-verified

`docs/archive/ui-plan.md` flagged three things as still-open when the island/font/alt-text work landed; none of them were touched since, so they carry forward as-is:
- The Pudding-style visual/spacing pass, done against real photographed content (not stub text) — hasn't happened, since ingest was still stub-only when that doc was written and real drafts are only just starting to flow now that generation is real.
- A full WCAG contrast audit specifically on the register/fact-anchored badges in `DraftCard.svelte` (currently `bg-amber-100`/`text-amber-800` for the register-2 badge, `bg-red/10`/`text-red` for the fact-anchored badge — the redesign kept these utility classes rather than moving to palette tokens, so the audit is against the same Tailwind colors as before) — never actually run against a contrast checker, just asserted as "worth checking."
- A deliberate mobile walkthrough with real (non-stub) content, since register-2 copy and real photos stress-test wrapping/truncation differently than placeholder text.

## 6. Dark mode / theming

Not in `SPEC.md` at all — not recommending it, just noting it's untouched (`global.css` has no `prefers-color-scheme` handling) in case it comes up as a request later. Don't build speculatively.

## Out of scope here

- A component library / design system — still true per the archived doc's call, page count hasn't grown enough to justify one (feed, admin, one new permalink page).
- Native mobile app, user accounts — out of scope per `SPEC.md` → Out of Scope (v1), unchanged.
