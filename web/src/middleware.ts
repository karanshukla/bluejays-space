// Astro middleware — gates admin paths behind Cloudflare Access JWT verification.
//
// This is the actual auth boundary for /admin and its API routes. Cloudflare
// Access path-scoping alone is insufficient because Railway's own
// *.up.railway.app fallback domain reaches the Node process directly (not
// proxied through Cloudflare), bypassing any Access challenge. The app verifies
// the JWT itself so the protection holds regardless of ingress path.
//
// See docs/admin-security.md for the full rationale.

import { defineMiddleware } from 'astro:middleware';
import { isAuthEnforced, verifyCfAccessJwt } from './lib/cfAccess';

// Protect /admin, /admin/*, /api/headlines/*, /api/headlines/<id>/{update,publish}.
// Deliberately NOT matched: / (public feed) and /api/images/* (public image proxy).
const PROTECTED = /^\/(admin|api\/headlines)(?:\/|$)/;

export const onRequest = defineMiddleware(async (context, next) => {
  if (!PROTECTED.test(context.url.pathname)) {
    return next();
  }

  // Dev bypass: no Cloudflare in front during local docker compose, and the
  // runtime Dockerfile sets NODE_ENV=production only in the prod image.
  if (!isAuthEnforced()) {
    return next();
  }

  const token = context.request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token) {
    return new Response('Forbidden', { status: 403 });
  }

  try {
    context.locals.cfUser = await verifyCfAccessJwt(token);
  } catch {
    return new Response('Forbidden', { status: 403 });
  }

  return next();
});
