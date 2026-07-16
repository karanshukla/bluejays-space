import { defineMiddleware } from 'astro:middleware';
import { isAuthEnforced, verifyCfAccessJwt } from './lib/cfAccess';
import { isSameSite } from './lib/sameSite';

const PROTECTED = /^\/admin(?:\/|$)/;
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Runs once at module load (server startup) so a partial CF_ACCESS_* config
// fails loud instead of silently leaving /admin unauthenticated.
const cfTeam = process.env.CF_ACCESS_TEAM;
const cfAud = process.env.CF_ACCESS_AUD;
if (Boolean(cfTeam) !== Boolean(cfAud)) {
  console.error(
    '[middleware] CF_ACCESS_TEAM and CF_ACCESS_AUD must both be set or both unset — ' +
      'only one is set, so Cloudflare Access verification is DISABLED and /admin is unauthenticated.'
  );
}

export const onRequest = defineMiddleware(async (context, next) => {
  if (!PROTECTED.test(context.url.pathname)) return next();

  if (MUTATING_METHODS.has(context.request.method) && !isSameSite(context.request, context.url)) {
    return new Response('Forbidden', { status: 403 });
  }

  // Keys off CF_ACCESS_* env vars, not NODE_ENV: the local dev flow runs
  // `astro build` (which sets NODE_ENV=production), so NODE_ENV can't be trusted.
  if (!isAuthEnforced()) return next();

  const token = context.request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token) return new Response('Forbidden', { status: 403 });

  try {
    context.locals.cfUser = await verifyCfAccessJwt(token);
  } catch {
    return new Response('Forbidden', { status: 403 });
  }

  return next();
});
