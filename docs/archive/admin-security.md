# Securing /admin

> **Archived — shipped (app side).** The mutating routes moved to `/admin/api/headlines/[id]/{update,publish}` and `web/src/middleware.ts` + `web/src/lib/cfAccess.ts` now verify the Cloudflare Access JWT in-app (via `jose`, against the team's JWKS), exactly as the "worth adding in the app anyway" section below proposed — see those files for the current implementation and `CF_ACCESS_TEAM`/`CF_ACCESS_AUD` in `.env.example`. The site is live on Railway with a production domain, so the Cloudflare Zero Trust Access application (step 1-4 below) should already be created — see `docs/production-verification.md` for the reference config to check it against if something seems off. Register-2 review flagging (section below) is also shipped, in `web/src/components/DraftCard.svelte` (a red "fact-anchored · verify before publish" badge on the register-2 subtype, kept through the PR #70 admin redesign).

Right now `/admin` (`web/src/pages/admin.astro` + its API routes under `web/src/pages/api/headlines/`) is wide open — anyone who finds the URL can edit and publish drafts. The spec's answer is Cloudflare Access, the same pattern already used for the Asher Remote MCP server, and explicitly "no custom auth code here." This doc is the checklist for wiring that up, plus the one piece of defense-in-depth worth adding in the app itself.

## Cloudflare Access setup (no app code)

1. **DNS/proxy**: `bluejays-web`'s Railway domain must already be proxied through Cloudflare (orange-cloud) for the apex `bluejays.space` — this should already be true from the domain setup in the top-level README.
2. **Zero Trust → Access → Applications**: create an application scoped to the path `bluejays.space/admin*` (path-scoped, not the whole domain — the public feed at `/` must stay open).
3. **Policy**: an email-based policy (e.g. "allow if email == karan's address") is enough for a single-operator site. Add a second identity later if anyone else needs review access.
4. **Session duration**: short-lived (Cloudflare default is fine) since this gates a low-traffic admin surface, not something used constantly.

Once this is live, requests to `/admin*` get Cloudflare's login challenge before they ever reach the Railway service — the Astro app doesn't need to know Access exists.

## What's worth adding in the app anyway

Cloudflare Access is the actual gate, but two things are cheap insurance and worth doing regardless:

1. **The mutating API routes now live under `/admin/api/*`.** The publish/update routes used to live at `/api/headlines/[id]/{publish,update}` — outside the `/admin*` path prefix, so a Cloudflare Access app scoped to `/admin*` left them reachable unauthenticated. They've been moved to `/admin/api/headlines/[id]/{publish,update}` so a single Access app scoped to `/admin*` covers the page AND the mutating routes, and the in-app JWT middleware's single `/admin*` matcher covers both too. Scope your Cloudflare Access application to `bluejays.space/admin*` — that's all that's needed.
2. **Verify the Access JWT server-side, don't rely on the edge alone.** Cloudflare Access sets a `Cf-Access-Jwt-Assertion` header (or `CF_Authorization` cookie) on requests that passed the challenge. Astro middleware can verify that JWT against Cloudflare's public keys (`https://<team-name>.cloudflareaccess.com/cdn-cgi/access/certs`) and reject anything without a valid one. This is defense-in-depth against Railway's public domain being hit directly (bypassing Cloudflare) if that domain is ever discovered — Railway services get a `*.up.railway.app` fallback domain regardless of the custom-domain Cloudflare setup, and that fallback domain isn't proxied through Cloudflare at all. **This is the actual gap**: if Railway's own domain for `bluejays-web` is left enabled, `/admin` is reachable through it with zero Access protection. Two fixes, pick one: disable/don't expose the Railway-generated domain once the custom domain is live, or add the JWT-verification middleware so even the Railway fallback domain enforces auth.

## Register-2 review flagging (already built)

The admin list already visually flags register-2 drafts that carry a `source_note` (the fact-anchored subtype) with a red "fact-anchored · verify before publish" badge — see `web/src/components/DraftCard.svelte` (moved out of `admin.astro` into the island when inline edit landed, and kept there through the PR #70 redesign). That's the in-app nudge the spec calls for ("needs to actually be checked before publish, not just skimmed"); nothing further needed there.

## Out of scope here

- Per-user roles/permissions — single operator, not needed.
- Rate limiting on the admin routes — Cloudflare Access already gates access before any request reaches the app; a second rate limiter would be redundant for a single-operator surface.
