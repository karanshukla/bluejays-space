// Same-site check for admin mutations, standing in for Astro's built-in
// checkOrigin (disabled in astro.config.mjs — Railway's proxy makes every
// request look like http:// while the browser's Origin is https://, so a
// scheme-inclusive comparison always fails there). This compares hosts only
// and falls back to Sec-Fetch-Site, so it isn't tripped by the scheme
// mismatch but still blocks cross-site form/fetch submissions.
export function isSameSite(request: Request, url: URL): boolean {
  const secFetchSite = request.headers.get('Sec-Fetch-Site');
  if (secFetchSite) return secFetchSite === 'same-origin' || secFetchSite === 'none';

  const origin = request.headers.get('Origin');
  if (!origin) return true; // no browser-supplied Origin (e.g. curl) — nothing to compare
  try {
    return new URL(origin).host === url.host;
  } catch {
    return false;
  }
}
