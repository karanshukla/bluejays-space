import { describe, expect, it } from 'vitest';
import { permalinkDescription } from './permalinkMeta';

const DEFAULT = 'The best Blue Jays misinformation on the web';

describe('permalinkDescription', () => {
  it('falls back to the site default when there is neither a subtitle nor a submitter', () => {
    expect(permalinkDescription({ submitter_name: null, subtitle: null }, DEFAULT)).toBeUndefined();
  });

  it('leads with the subtitle when there is no submitter, matching the pre-#179 behavior', () => {
    expect(
      permalinkDescription({ submitter_name: null, subtitle: 'Nobody saw it coming' }, DEFAULT)
    ).toBe(`Nobody saw it coming - ${DEFAULT}`);
  });

  it('credits the submitter even when there is no subtitle', () => {
    expect(permalinkDescription({ submitter_name: 'Jane', subtitle: null }, DEFAULT)).toBe(
      `Submitted by Jane. ${DEFAULT}`
    );
  });

  it('leads with the submitter credit ahead of the subtitle when both are present', () => {
    expect(
      permalinkDescription({ submitter_name: 'Jane', subtitle: 'Nobody saw it coming' }, DEFAULT)
    ).toBe(`Submitted by Jane. Nobody saw it coming - ${DEFAULT}`);
  });
});
