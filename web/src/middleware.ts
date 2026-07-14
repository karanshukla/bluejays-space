// Astro middleware — gates admin paths behind Cloudflare Access JWT verification.
//
// This is the actual auth boundary for /admin and everything under it. The admin
// page (/admin) and its mutating API routes (/admin/api/headlines/*) both live
// under the /admin prefix so a single Cloudflare Access app scoped to /admin*
// covers them at the edge, and a single matcher here covers them in-app.
//
// Cloudflare Access path-scoping alone is insufficient because Railway's own
// *.up.railway.app fallback domain reaches the Node process directly (not
// proxied through Cloudflare), bypassing any Access challenge. The app verifies
// the JWT itself so the protection holds regardless of ingress path.
//
// See docs/admin-security.md for the full rationale.

import { defineMiddleware } from 'astro:middleware';
import { isAuthEnforced, verifyCfAccessJwt } from './lib/cfAccess';

// Protect /admin and everything nested under it (page + /admin/api/headlines/*).
// Deliberately NOT matched: / (public feed) and /api/images/* (public image proxy).
const PROTECTED = /^\/admin(?:\/|$)/;

export const onRequest = defineMiddleware(async (context, next) => {
  if (!PROTECTED.test(context.url.pathname)) {
    return next();
  }

  // Dev bypass: isAuthEnforced() keys off the CF_ACCESS_* env vars being
  // configured, not NODE_ENV (the local dev flow runs `astro build`, which sets
  // NODE_ENV=production, so NODE_ENV is an unreliable dev signal). When the CF
  // vars are unset (local dev) there's no team JWKS to verify against, so we skip.
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
