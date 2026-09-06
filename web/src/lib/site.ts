// Resolves the canonical site origin at request time, not build time.
// astro.config.mjs reads process.env.SITE_URL at build time — but Railway sets
// SITE_URL as a runtime variable on the deployed service, not during the Docker
// build step, so Astro.site ends up undefined in production. Reading it here (per
// request) picks up the runtime env var instead. Falls back to localhost for dev.
const LOCAL = new URL('http://localhost:4321');

export function getSiteUrl(): URL {
  return process.env.SITE_URL ? new URL(process.env.SITE_URL) : LOCAL;
}

// The Bluesky handle directory is a separate Go service on its own subdomain
// (see handles/README.md for the wildcard DNS). Normally derived from the site
// origin rather than hardcoded, so a staging deploy points at its own handles
// host instead of production's.
//
// HANDLES_URL overrides that derivation for deployments where the service isn't
// reachable at handles.<site host>. Local dev is the case that forced it: the
// derived host is handles.localhost:4321, which nothing serves and no resolver
// answers for, so the header link 404'd for anyone running the stack. The
// compose `handles` service publishes it on localhost:8080 instead.
export function getHandlesUrl(): URL {
  if (process.env.HANDLES_URL) return new URL(process.env.HANDLES_URL);
  const site = getSiteUrl();
  const handles = new URL(site.href);
  handles.hostname = `handles.${site.hostname}`;
  handles.pathname = '/';
  return handles;
}
