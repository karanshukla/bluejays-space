import type { Headline } from './db';

export function permalinkDescription(
  headline: Pick<Headline, 'submitter_name' | 'subtitle'>,
  defaultDescription: string
): string | undefined {
  const parts = [
    headline.submitter_name ? `Submitted by ${headline.submitter_name}.` : null,
    headline.subtitle ? `${headline.subtitle} -` : null,
  ].filter((part): part is string => part !== null);

  return parts.length ? `${parts.join(' ')} ${defaultDescription}` : undefined;
}
