# Frontend follow-up — sharing, scale, and the polish `docs/archive/ui-plan.md` left open

The admin island, self-hosted display font, and real alt text all shipped (see `docs/archive/ui-plan.md`). This doc covers what's next: the site currently has no way to be *shared* as individual headlines (no permalinks, no social preview cards, no feed syndication), which matters a lot for a parody headline site — that's the whole distribution mechanism for something in the FAX Sports/Onion mold. It also covers what's left of the original visual/a11y punch list, and the handles site's UI, which nothing has touched yet.

## 1. Sharing & discovery — the biggest gap

Right now `web/` has no `public/` directory at all — no favicon, no `robots.txt`, no sitemap, no Open Graph tags, and `/` is the only page (no per-headline permalink). Every decision below is final — see `SPEC.md` → "Sharing & Discovery" and the Parody Labeling section for the product-level calls (permalinks/OG/RSS/sitemap in scope; the generated OG image carries the parody label; handles stays JSON+GitHub-PR, unrelated but resolved the same pass). This section is the technical spec an implementing agent should be able to build straight from.

### 1.0 Prerequisite: canonical site URL

None of the below can produce correct absolute URLs (`og:image`, RSS `<link>`, sitemap `<loc>`) without knowing the production origin. Add:
- `SITE_URL=https://bluejays.space` to `.env.example` and Railway's `bluejays-web` service (local dev can default it to `http://localhost:4321` if unset).
- `site: process.env.SITE_URL` in `web/astro.config.mjs`'s `defineConfig({...})` — this is what lets `new URL(path, Astro.site)` (or Astro's own `Astro.url`/`astro:content` helpers) build absolute URLs instead of every call site hand-concatenating a base.

### 1.1 Per-headline permalink page

- Route: `web/src/pages/h/[id].astro`.
- New query in `web/src/lib/db.ts`: `getHeadlineById(id: number): Promise<Headline | null>`, `WHERE id = $1 AND status = 'published'` — a draft's id must return `null`, never the row.
- Page behavior: `null` → `return new Response('Not Found', { status: 404 })` (or `Astro.rewrite('/404')` if a 404 page exists — none does yet; a plain 404 response is sufficient, a styled 404 page is optional polish, not a blocker).
- Found → render the same card markup as the feed. **Extract the per-card JSX currently inline in `web/src/pages/index.astro`'s `.map()` (the `<div class="clipping ...">` block, roughly lines 40-76) into a shared `web/src/components/HeadlineCard.astro` taking a `headline` + `tapeVariant` prop** — both `index.astro` and `h/[id].astro` render it, so the markup doesn't fork in two places. Card gets a tape variant on the permalink page too (`TAPE_VARIANTS[h.id % TAPE_VARIANTS.length]`, same formula, for visual consistency with how it looks in the feed).
- Add a small "← Back to the feed" link to `/` above or below the card — the permalink is a landing point from an external share, not a dead end.

### 1.2 Open Graph / Twitter Card meta tags

- Extend `web/src/layouts/Base.astro`'s `Props` interface: `title: string` (existing, required) plus new optional fields `description?: string`, `ogImage?: string` (absolute or root-relative path), `ogType?: 'website' | 'article'` (default `'website'`), `canonicalPath?: string` (defaults to the current request path if omitted).
- In `<head>`, add: `<link rel="canonical" href={new URL(canonicalPath ?? Astro.url.pathname, Astro.site)} />`, `<meta property="og:title" content={title} />`, `<meta property="og:description" content={description ?? defaultDescription} />` (site-wide default description: something like "Parody Blue Jays headlines. Not affiliated with MLB."), `<meta property="og:image" content={new URL(ogImage ?? '/og-default.png', Astro.site)} />`, `<meta property="og:url" content={...canonical...} />`, `<meta property="og:type" content={ogType} />`, `<meta name="twitter:card" content="summary_large_image" />`, plus `twitter:title`/`twitter:description`/`twitter:image` mirroring the `og:*` values.
- `web/src/pages/index.astro` passes no OG overrides (site-wide defaults apply, `ogType="website"`). `web/src/pages/h/[id].astro` passes `title={h.headline}`, `description={h.stat_block ?? undefined}`, `ogImage={ogImageUrlFor(h)}` (see 1.3), `ogType="article"`.
- Add a static fallback image at `web/public/og-default.png` (1200×630, site wordmark on the blue/red palette) for the index page and any permalink whose per-headline render fails or is still in flight — never leave `og:image` pointing at nothing.

### 1.3 Dynamically-generated OG images — decided approach: in-process Satori render, cached in MinIO

A static `og:image` (just the stored `photo_ref`) previews as a bare photo with no headline text — the thing actually read at a glance in an unfurl. Build a real per-headline card instead: headline text + stat block composited over the photo, parody label in the corner (per `SPEC.md`'s Parody Labeling section — this is the one case where the generated image, unlike the live-page card, carries the label). `karanshukla/navyfragen-app`'s `opengraph-service` is a useful reference for the *pattern*, not to be ported wholesale — its scale-specific parts don't apply here (see below).

**Render step, decided**: `satori` (renders a JSX/HTML-like tree to SVG, flexbox/grid-subset CSS only) + `@resvg/resvg-js` (SVG → PNG), both called **in-process inside `web`**, no separate Railway service, no headless browser. This is a smaller footprint than navyfragen's sibling `html-to-image` microservice, which exists there because its render backend is shared across multiple services/features at a different scale — bluejays.space has one Astro/Node service and one caller. Revisit only if Satori's flexbox/grid-only layout engine turns out too limited for the actual card design once someone tries it against the real Fraunces/Space Mono typography — check that before committing further, but start here.

**Trigger, decided — crawler-gated, not always-on**: don't render on every permalink hit; only when the request's User-Agent matches a known link-preview bot (`Bluesky Cardyb`, `Discordbot`, `Twitterbot`, `Slackbot`, `facebookexternalhit`). Check this in `h/[id].astro` itself (no middleware change needed — it's one route) before deciding whether to serve the cached/generated image URL or just the static fallback inline in the initial HTML; the actual PNG is served from a separate `web/src/pages/api/og/[id].png.ts` route that crawlers' `og:image` fetch hits directly (that route renders unconditionally when called, since by the time it's hit the crawler check already happened at the referring permalink — or, simpler and just as correct, skip the UA check on the image route entirely and let it be publicly fetchable like `/api/images/*` already is; the UA gate's only real job is avoiding rendering it inline for a normal browser visit that doesn't need it).

**Caching, decided**: store generated PNGs in the existing MinIO bucket (already wired for photos, already has `web`'s `/api/images/*` proxy pattern to reuse) under key `og/{id}-{hash}.png`, where `hash` is a short SHA-256 (first 12 hex chars is plenty) of `` `${headline}|${stat_block}|${photo_ref}` ``. A content hash — not a bare TTL — makes invalidation exact: an admin edit changes the hash, so the old cached PNG is simply never looked up again (a stale orphan, cleaned up the same pass as `docs/backend-api-plan.md` item 3's general orphaned-image sweep — no separate cache-eviction mechanism needed). This sidesteps needing a new `updated_at` column on `headlines` purely for cache-busting.
- `api/og/[id].png.ts` logic: compute the hash, check MinIO for `og/{id}-{hash}.png`, serve it if present; otherwise render via Satori/resvg, upload to that key, serve the bytes. Add a process-local in-flight `Map<string, Promise<Buffer>>` keyed on the same `{id}-{hash}` so two near-simultaneous crawler hits for a newly-published headline share one render instead of racing two.

### 1.4 RSS feed

- Use the official `@astrojs/rss` package (`npm install @astrojs/rss` in `web/`) rather than hand-rolling XML.
- `web/src/pages/feed.xml.ts`: `GET` handler returns `rss({ title: 'bluejays.space', description: <same default description as OG>, site: context.site, items: headlines.map(h => ({ title: h.headline, pubDate: h.published_at, link: \`/h/${h.id}\`, description: h.stat_block ?? undefined })) })`. Source the list from `getPublishedHeadlines`, capped to the most recent 50 (`ORDER BY published_at DESC LIMIT 50` — add this cap to the query or a new `getRecentPublishedHeadlines`-style variant; don't ship the whole table into every feed fetch).

### 1.5 Sitemap

`@astrojs/sitemap`'s static integration only knows about file-based routes discovered at build time — it can't enumerate dynamic `/h/{id}` permalinks, whose set changes on every publish. **Decided: hand-write `web/src/pages/sitemap.xml.ts`** as an SSR `GET` route instead of using the integration: query `getPublishedHeadlines`, emit a `<urlset>` with one `<url>` for `/` and one per `/h/{id}`, using `SITE_URL` for every `<loc>`. `/admin` and its `/admin/api/*` routes are never included (they're not public content, separate from the `robots.txt` disallow below being defense-in-depth on top of Cloudflare Access).

### 1.6 `robots.txt`

Static file, `web/public/robots.txt`:
```
User-agent: *
Disallow: /admin
Sitemap: https://bluejays.space/sitemap.xml
```
(Cloudflare Access already blocks crawlers from reading `/admin`'s content — this is a non-security second layer, purely about not advertising the path.)

### 1.7 Favicon

`web/src/layouts/Base.astro`'s `<head>` has no `<link rel="icon">` — add `web/public/favicon.svg` (a simple mark in the site's existing palette, `--color-blue: #134a8e` / `--color-red: #c8102e` from `global.css` — doesn't need to be elaborate, just not a broken/default browser icon) plus a `favicon.ico` fallback for older clients, and `<link rel="icon" href="/favicon.svg" type="image/svg+xml" />` in `Base.astro`.

## 2. Public feed pagination

`getPublishedHeadlines()` has no `LIMIT`/offset and `index.astro` renders every published row in one page load. Fine today; not fine once the feed has months of headlines.

**Decided: classic `?page=N` query-param pagination**, not infinite scroll — infinite scroll needs a client-side island and a "load more" API route, breaking the "public pages ship zero/minimal JS" mandate in `SPEC.md` for no strong offsetting benefit at this content volume.

- Page size: **30** headlines per page.
- `getPublishedHeadlines(limit: number, offset: number)` — change the existing signature (no separate paginated variant; every caller passes explicit values, `index.astro` computes `offset = (page - 1) * 30` from `Astro.url.searchParams.get('page')`, defaulting to `page = 1` when absent, invalid, or `< 1`).
- Out-of-range `page` (past the last page) renders the existing empty-feed state ("No headlines published yet" copy, or a small "No more headlines" variant) rather than 404ing — simpler edge-case handling for a low-traffic site, and consistent with treating pagination as a display concern, not a routing one.
- Prev/next links: plain `<a href="/?page=N">` at the top and bottom of the card grid, omitted on whichever end has no adjacent page (no page 0 link, no next-page link past the last page).
- Land this alongside `docs/backend-api-plan.md` item 7 — the query and the page render together, not as two separate changes.

## 3. Handles site UI

`handles/templates/index.html` + `handles/static/` (Go service, server-rendered HTML + a small JS spinner for async PR-creation polling) hasn't had any design pass — it predates the Fraunces/Tailwind work done on `web`. Since it's a separate Go binary with its own template, it can't just inherit `web`'s Tailwind build; either hand-write matching CSS or accept it'll look visually distinct from the main site (it already lives on a different subdomain, `handles.bluejays.space`, so some visual distinction is less jarring than it would be on the same domain). Low priority relative to items 1-2, but worth a pass before treating the handles feature as "done" rather than "functional."

## 4. Remaining items from the archived UI plan, not yet re-verified

`docs/archive/ui-plan.md` flagged three things as still-open when the island/font/alt-text work landed; none of them were touched since, so they carry forward as-is:
- The Pudding-style visual/spacing pass, done against real photographed content (not stub text) — hasn't happened, since ingest was still stub-only when that doc was written and real drafts are only just starting to flow now that generation is real.
- A full WCAG contrast audit specifically on the register/fact-anchored badges (`bg-amber-100`/`text-amber-800`, `bg-red-100`/`text-red-800` in `DraftCard.svelte`) — never actually run against a contrast checker, just asserted as "worth checking."
- A deliberate mobile walkthrough with real (non-stub) content, since register-2 copy and real photos stress-test wrapping/truncation differently than placeholder text.

## 5. Dark mode / theming

Not in `SPEC.md` at all — not recommending it, just noting it's untouched (`global.css` has no `prefers-color-scheme` handling) in case it comes up as a request later. Don't build speculatively.

## Out of scope here

- A component library / design system — still true per the archived doc's call, page count hasn't grown enough to justify one (feed, admin, one new permalink page).
- Native mobile app, user accounts — out of scope per `SPEC.md` → Out of Scope (v1), unchanged.
