import { describe, expect, it } from 'vitest';
import { getProductiveTier } from '../src/shared/tiers';

describe('getProductiveTier', () => {
  it('returns unproductive for low counts', () => {
    expect(getProductiveTier(1, 1)).toBe('unproductive');
  });

  it('returns productive for minimum counts', () => {
    expect(getProductiveTier(3, 3)).toBe('productive');
  });

  it('returns highly productive for high counts', () => {
    expect(getProductiveTier(5, 5)).toBe('highly_productive');
  });
});
