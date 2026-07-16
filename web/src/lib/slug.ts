// Slug derived from the headline text, appended to the id in the URL path:
// /h/7-vladimir-guerrero-jr-hits-ball-into-orbit. The id is the actual
// lookup key; the slug is SEO frosting and human-readable. A bare /h/7 still
// works (redirects to the canonical slugged URL) so old links don't break.
const MAX_SLUG_WORDS = 10;

export function headlineSlug(headline: string): string {
  return headline
    .toLowerCase()
    .replace(/['']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .split('-')
    .slice(0, MAX_SLUG_WORDS)
    .join('-');
}

export function permalinkPath(id: number, headline: string): string {
  return `/h/${id}-${headlineSlug(headline)}`;
}
