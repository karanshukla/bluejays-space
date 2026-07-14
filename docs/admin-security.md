# Securing /admin

Right now `/admin` (`web/src/pages/admin.astro` + its API routes under `web/src/pages/api/headlines/`) is wide open — anyone who finds the URL can edit and publish drafts. The spec's answer is Cloudflare Access, the same pattern already used for the Asher Remote MCP server, and explicitly "no custom auth code here." This doc is the checklist for wiring that up, plus the one piece of defense-in-depth worth adding in the app itself.

## Cloudflare Access setup (no app code)

1. **DNS/proxy**: `bluejays-web`'s Railway domain must already be proxied through Cloudflare (orange-cloud) for the apex `bluejays.space` — this should already be true from the domain setup in the top-level README.
2. **Zero Trust → Access → Applications**: create an application scoped to the path `bluejays.space/admin*` (path-scoped, not the whole domain — the public feed at `/` must stay open).
3. **Policy**: an email-based policy (e.g. "allow if email == karan's address") is enough for a single-operator site. Add a second identity later if anyone else needs review access.
4. **Session duration**: short-lived (Cloudflare default is fine) since this gates a low-traffic admin surface, not something used constantly.

Once this is live, requests to `/admin*` get Cloudflare's login challenge before they ever reach the Railway service — the Astro app doesn't need to know Access exists.

## What's worth adding in the app anyway

Cloudflare Access is the actual gate, but two things are cheap insurance and worth doing regardless:

1. **Don't trust `/admin*` path-scoping alone for the API routes.** The publish/update routes live at `/api/headlines/[id]/publish` and `/api/headlines/[id]/update` — outside the literal `/admin*` path prefix. **Confirm the Cloudflare Access application's path pattern actually covers these routes too**, not just the page. If Access is scoped to `/admin*` only, the API routes are reachable unauthenticated even with Access "on" for the admin page — this is the most likely way this setup silently fails. Either scope Access to cover both (`/admin*` and `/api/headlines/*`), or move the API routes under `/admin/api/*` so one path prefix covers everything.
2. **Verify the Access JWT server-side, don't rely on the edge alone.** Cloudflare Access sets a `Cf-Access-Jwt-Assertion` header (or `CF_Authorization` cookie) on requests that passed the challenge. Astro middleware can verify that JWT against Cloudflare's public keys (`https://<team-name>.cloudflareaccess.com/cdn-cgi/access/certs`) and reject anything without a valid one. This is defense-in-depth against Railway's public domain being hit directly (bypassing Cloudflare) if that domain is ever discovered — Railway services get a `*.up.railway.app` fallback domain regardless of the custom-domain Cloudflare setup, and that fallback domain isn't proxied through Cloudflare at all. **This is the actual gap**: if Railway's own domain for `bluejays-web` is left enabled, `/admin` is reachable through it with zero Access protection. Two fixes, pick one: disable/don't expose the Railway-generated domain once the custom domain is live, or add the JWT-verification middleware so even the Railway fallback domain enforces auth.

## Register-2 review flagging (already built)

The admin list already visually flags register-2 drafts that carry a `source_note` (the fact-anchored subtype) with a red "verify before publish" badge — see `web/src/pages/admin.astro`. That's the in-app nudge the spec calls for ("needs to actually be checked before publish, not just skimmed"); nothing further needed there.

## Out of scope here

- Per-user roles/permissions — single operator, not needed.
- Rate limiting on the admin routes — Cloudflare Access already gates access before any request reaches the app; a second rate limiter would be redundant for a single-operator surface.
