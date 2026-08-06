import { describe, expect, it } from 'vitest';
import { variantFor } from './cardVariants';

const SEVEN = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];

describe('variantFor', () => {
  it('is stable for a given id', () => {
    expect(variantFor(42, SEVEN)).toBe(variantFor(42, SEVEN));
  });

  it('reaches every variant across a realistic run of ids', () => {
    const seen = new Set(Array.from({ length: 200 }, (_, i) => variantFor(i + 1, SEVEN)));
    expect(seen.size).toBe(SEVEN.length);
  });

  it('spreads ids roughly evenly rather than clustering on one variant', () => {
    const counts = new Map<string, number>();
    for (let id = 1; id <= 700; id++) {
      const v = variantFor(id, SEVEN);
      counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    // Perfectly even would be 100 each; anything inside ±40% is fine for a
    // visual shuffle and far from the degenerate "every card identical" bug
    // this replaced.
    for (const count of counts.values()) {
      expect(count).toBeGreaterThan(60);
      expect(count).toBeLessThan(140);
    }
  });

  it('does not march through the list in id order (consecutive ids are unrelated)', () => {
    const steps = new Set<number>();
    for (let id = 1; id <= 50; id++) {
      steps.add(SEVEN.indexOf(variantFor(id + 1, SEVEN)) - SEVEN.indexOf(variantFor(id, SEVEN)));
    }
    // `id % 7` would give exactly one step value (+1, wrapping to -6).
    expect(steps.size).toBeGreaterThan(3);
  });

  it('keeps two same-length lists independent when given different seeds', () => {
    // Same seed on same-length lists pairs them 1:1 forever — the tilt and the
    // crop would always be drawn together. Different seeds must break that.
    let paired = 0;
    for (let id = 1; id <= 100; id++) {
      if (SEVEN.indexOf(variantFor(id, SEVEN, 1)) === SEVEN.indexOf(variantFor(id, SEVEN, 2))) {
        paired++;
      }
    }
    expect(paired).toBeLessThan(40);
  });

  it('handles id 0 and single-entry lists', () => {
    expect(SEVEN).toContain(variantFor(0, SEVEN));
    expect(variantFor(0, ['only'])).toBe('only');
  });
});
