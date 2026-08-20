import { describe, expect, it } from 'vitest';
import { erf, normalCdf, normalSf } from '@/lib/leverage/normal';

describe('normal', () => {
  it('matches published normal quantiles', () => {
    // Standard table values; tolerance is the approximation's own error bound.
    expect(normalCdf(0)).toBeCloseTo(0.5, 6);
    expect(normalCdf(1)).toBeCloseTo(0.8413447, 6);
    expect(normalCdf(1.6448536)).toBeCloseTo(0.95, 6);
    expect(normalCdf(1.959964)).toBeCloseTo(0.975, 6);
    expect(normalCdf(2.5758293)).toBeCloseTo(0.995, 6);
    expect(normalCdf(4.08)).toBeCloseTo(0.9999775, 6);
  });

  it('is symmetric', () => {
    for (const z of [0.3, 1, 2.2, 3.7]) {
      expect(normalCdf(-z)).toBeCloseTo(1 - normalCdf(z), 9);
      expect(erf(-z)).toBeCloseTo(-erf(z), 9);
    }
  });

  it('gives a usable upper tail', () => {
    expect(normalSf(1.959964)).toBeCloseTo(0.025, 6);
    // The Sidak threshold for 1140 simultaneous comparisons at 5% family-wise.
    expect(normalSf(4.08)).toBeGreaterThan(1e-5);
    expect(normalSf(4.08)).toBeLessThan(5e-5);
    expect(normalSf(-1)).toBeCloseTo(0.8413447, 6);
    expect(normalSf(50)).toBeGreaterThan(0);
  });
});
