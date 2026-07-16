// Resolves the canonical site origin at request time, not build time.
// astro.config.mjs reads process.env.SITE_URL at build time — but Railway sets
// SITE_URL as a runtime variable on the deployed service, not during the Docker
// build step, so Astro.site ends up undefined in production. Reading it here (per
// request) picks up the runtime env var instead. Falls back to localhost for dev.
const LOCAL = new URL('http://localhost:4321');

export function getSiteUrl(): URL {
  return process.env.SITE_URL ? new URL(process.env.SITE_URL) : LOCAL;
}
