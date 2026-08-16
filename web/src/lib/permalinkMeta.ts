import type { Headline } from './db';

export function permalinkDescription(
  headline: Pick<Headline, 'submitter_name' | 'stat_block'>,
  defaultDescription: string
): string | undefined {
  const parts = [
    headline.submitter_name ? `Submitted by ${headline.submitter_name}.` : null,
    headline.stat_block ? `${headline.stat_block} -` : null,
  ].filter((part): part is string => part !== null);

  return parts.length ? `${parts.join(' ')} ${defaultDescription}` : undefined;
}
