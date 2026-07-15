# UI follow-up work

> **Archived — mostly shipped.** The admin island landed (`web/src/components/DraftCard.svelte`, mounted with `client:load` per draft in `admin.astro`) — optimistic save/publish, no full-page reload, native form controls preserved for keyboard access. Public feed got a self-hosted display font (`@fontsource/fraunces`, no Google Fonts CDN call) and real alt text keyed off `player_ids[0]` in `index.astro`. **Still open:** the deliberate Pudding-style visual pass (spacing/rhythm once real photographed content is flowing), a full WCAG contrast audit of the register/fact-anchored badges, and a real mobile walkthrough with non-stub content — none of those were re-verified as done. Also newly in scope since this was written: the public feed has no pagination, permalinks, or share/SEO metadata at all — see `docs/frontend-roadmap.md`, which supersedes this doc's remaining open items.

What's built today (`web/src/pages/index.astro`, `admin.astro`, `layouts/Base.astro`) is functional scaffolding, not the finished design. This tracks the gap between "works" and what the spec actually asks for.

## Admin: plain forms → interactive island

The spec calls for a Svelte or React island specifically for the admin inline-edit UI — public pages stay islands-free (zero/minimal JS), admin is "the one place that needs" one. Today it's plain `<form>` POSTs with full-page reloads on every save/publish, which works but round-trips the whole page for a one-field edit.

**When picking this up:**
- Pick Svelte or React based on nothing more than which one is less new dependency weight for this project — either fits Astro's islands model equivalently well. No functional reason to prefer one.
- Scope the island narrowly: it should replace the per-draft edit form (optimistic save, no full reload) and the publish button (optimistic remove-from-list). It should *not* try to take over the whole `/admin` page — the list/layout can stay server-rendered Astro, with the island mounted per-card.
- The existing API routes (`/api/headlines/[id]/update`, `/api/headlines/[id]/publish`) don't need to change shape — they already accept form-POST bodies; the island just calls them via `fetch` instead of a native form submit, so this is additive, not a rewrite.

## Public feed: visual polish

Current state is functional but bare (system fonts, minimal spacing, no real typographic hierarchy). Spec asks for:
- **Aesthetic reference: The Pudding** — data-forward, readable, "a bit of character." Worth actually looking at a Pudding piece before starting rather than working from the one-line description.
- **Expressive font for headlines, clean sans-serif for stat context** — currently both are just the Tailwind default stack. Needs an actual typeface decision (a display/serif face for headlines, system sans for stat blocks) and loading it (self-hosted webfont, not a Google Fonts CDN call, to keep the "zero/minimal JS, no external calls" posture on public pages).
- **Card-based feed, no exotic layouts** — already true structurally; this is really about spacing/rhythm once real content (with photos) is flowing through it, not a layout change.

## Accessibility (WCAG)

Not audited yet. At minimum before calling this done:
- Color contrast check on the register badges (`bg-amber-100`/`text-amber-800` etc. in `admin.astro`) and any new typographic choices.
- Alt text on player photos — currently `alt=""` on both feed and admin thumbnails (fine for admin, since those are decorative previews of a value already shown in the `Photo ref` input; **not fine for the public feed**, where a real photo needs real alt text, e.g. the player's name if `player_ids` is populated).
- Keyboard navigation through the admin edit/publish flow once it's interactive (island work above) — forms currently work by default since they're native HTML, but a custom island must not regress this.

## Mobile testing

Spec is mobile-first. Layout was spot-checked at 375px and 1280px during the initial build (renders correctly, no overflow) but hasn't been walked through as a deliberate pass — do that once real content (headlines with photos, longer register-2 copy) is flowing, since placeholder stub text doesn't stress-test wrapping/truncation the way real drafts will.

## Not planned here

- A design system / component library — three pages (feed, admin, one layout) don't justify one yet. Revisit if the page count grows.
