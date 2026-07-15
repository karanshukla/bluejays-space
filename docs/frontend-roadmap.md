# Frontend follow-up — sharing, scale, and the polish `docs/archive/ui-plan.md` left open

The admin island, self-hosted display font, and real alt text all shipped (see `docs/archive/ui-plan.md`). This doc covers what's next: the site currently has no way to be *shared* as individual headlines (no permalinks, no social preview cards, no feed syndication), which matters a lot for a parody headline site — that's the whole distribution mechanism for something in the FAX Sports/Onion mold. It also covers what's left of the original visual/a11y punch list, and the handles site's UI, which nothing has touched yet.

## 1. Sharing & discovery — the biggest gap

Right now `web/` has no `public/` directory at all — no favicon, no `robots.txt`, no sitemap, no Open Graph tags, and `/` is the only page (no per-headline permalink). Concretely:

- **Per-headline permalink page** (`web/src/pages/h/[id].astro` or similar): a single published headline, its stat block, photo, and source-note, on its own URL — what actually gets shared/screenshotted, rather than a link to the whole feed. Query via a new `getHeadlineById` in `web/src/lib/db.ts` (guard on `status = 'published'` — a draft's URL must 404, not leak an unreviewed headline).
- **Open Graph / Twitter Card meta tags** on that permalink page (`og:title`, `og:image` pointing at the stored `photo_ref` via `/api/images/*`, `og:description` from `stat_block`) — this is what makes a shared link render as a card on Bluesky/Twitter/iMessage instead of a bare URL. `web/src/layouts/Base.astro` currently sets none of this; extend its `Props` to accept optional OG fields per-page rather than hardcoding site-wide values.
- **The parody label on the OG image itself is worth a second look against `SPEC.md`'s labeling philosophy.** The spec explicitly rules out "a card-graphic watermark" as content-level friction — but an OG card is arguably site-level (it's metadata about the page, not baked into the shareable headline text itself, and doesn't survive a screenshot of the headline card the way a watermark would). This is a judgment call, not an obvious yes/no — flag it for a decision rather than assuming either way when this gets built.
- **`robots.txt` + `sitemap.xml`**: trivial, and `/admin` specifically should be disallowed in `robots.txt` as one more (non-security) layer — Cloudflare Access already blocks crawlers from *reading* it, but there's no reason to even advertise the path.
- **RSS/Atom feed** of published headlines (`/feed.xml`): cheap to add given `getPublishedHeadlines` already exists, and fits a headline site better than most — lets people subscribe without needing an account (which is explicitly out of scope per `SPEC.md`).
- **Favicon**: currently none; `Base.astro`'s `<head>` has no `<link rel="icon">` at all, so browsers show a broken/default icon.

## 2. Public feed pagination

`getPublishedHeadlines()` has no `LIMIT`/offset and `index.astro` renders every published row in one page load. Fine today; not fine once the feed has months of headlines. Two reasonable shapes:
- Classic `?page=N` with a `LIMIT`/`OFFSET` query and prev/next links — simplest, works with zero JS, fits the "public pages ship zero/minimal JS" mandate in `SPEC.md`.
- Infinite scroll — better UX for a scrollable card feed, but needs a client-side island (breaking the zero-JS-on-public-pages posture) and a "load more" API route. Given the spec's explicit preference for minimal JS on public pages, **prefer classic pagination** unless there's a specific reason to reconsider.

Pick a page size (25-50 cards is reasonable for a card-per-headline feed) and land it alongside `docs/backend-api-plan.md` item 7 — the query and the page need to change together.

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
