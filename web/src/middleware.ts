import { defineMiddleware } from 'astro:middleware';
import { isAuthEnforced, isDevBypassEnabled, verifyCfAccessJwt } from './lib/cfAccess';
import { isSameSite } from './lib/sameSite';

const PROTECTED = /^\/admin(?:\/|$)/;
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Runs once at module load (server startup) so a missing CF_ACCESS_* config
// is visible in the logs, not just as /admin returning 403.
if (!isAuthEnforced() && !isDevBypassEnabled()) {
  console.error(
    '[middleware] CF_ACCESS_TEAM and CF_ACCESS_AUD are not both set, so /admin refuses every request. ' +
      'Set both, or set CF_ACCESS_DEV_BYPASS=true for local dev.'
  );
}

export const onRequest = defineMiddleware(async (context, next) => {
  if (!PROTECTED.test(context.url.pathname)) return next();

  if (MUTATING_METHODS.has(context.request.method) && !isSameSite(context.request, context.url)) {
    return new Response('Forbidden', { status: 403 });
  }

  // Keys off CF_ACCESS_* env vars, not NODE_ENV: the local dev flow runs
  // `astro build` (which sets NODE_ENV=production), so NODE_ENV can't be trusted.
  if (!isAuthEnforced()) {
    if (isDevBypassEnabled()) return next();
    return new Response('Forbidden', { status: 403 });
  }

  const token = context.request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token) return new Response('Forbidden', { status: 403 });

  try {
    context.locals.cfUser = await verifyCfAccessJwt(token);
  } catch {
    return new Response('Forbidden', { status: 403 });
  }

  return next();
});
