import { defineMiddleware } from 'astro:middleware';
import { isAuthEnforced, verifyCfAccessJwt } from './lib/cfAccess';

const PROTECTED = /^\/admin(?:\/|$)/;

export const onRequest = defineMiddleware(async (context, next) => {
  if (!PROTECTED.test(context.url.pathname)) return next();

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
