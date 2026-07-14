import { describe, expect, it } from 'vitest';
import { asNullableText } from './formHelpers';

describe('asNullableText', () => {
  it('returns null for an empty string', () => {
    expect(asNullableText('')).toBeNull();
  });

  it('returns null for a whitespace-only string', () => {
    expect(asNullableText('   ')).toBeNull();
  });

  it('returns null for null input', () => {
    expect(asNullableText(null)).toBeNull();
  });

  it('trims surrounding whitespace from a non-empty string', () => {
    expect(asNullableText('  hello  ')).toBe('hello');
  });

  it('passes through a non-empty string unchanged (aside from trimming)', () => {
    expect(asNullableText('https://example.com/post')).toBe('https://example.com/post');
  });
});
