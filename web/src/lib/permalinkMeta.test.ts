import { describe, expect, it } from 'vitest';
import { permalinkDescription } from './permalinkMeta';

const DEFAULT = 'The best Blue Jays misinformation on the web';

describe('permalinkDescription', () => {
  it('falls back to the site default when there is neither a stat block nor a submitter', () => {
    expect(
      permalinkDescription({ submitter_name: null, stat_block: null }, DEFAULT)
    ).toBeUndefined();
  });

  it('leads with the stat block when there is no submitter, matching the pre-#179 behavior', () => {
    expect(permalinkDescription({ submitter_name: null, stat_block: '.382 AVG' }, DEFAULT)).toBe(
      `.382 AVG - ${DEFAULT}`
    );
  });

  it('credits the submitter even when there is no stat block', () => {
    expect(permalinkDescription({ submitter_name: 'Jane', stat_block: null }, DEFAULT)).toBe(
      `Submitted by Jane. ${DEFAULT}`
    );
  });

  it('leads with the submitter credit ahead of the stat block when both are present', () => {
    expect(permalinkDescription({ submitter_name: 'Jane', stat_block: '.382 AVG' }, DEFAULT)).toBe(
      `Submitted by Jane. .382 AVG - ${DEFAULT}`
    );
  });
});
