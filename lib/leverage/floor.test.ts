import { describe, expect, it } from 'vitest';
import { assessFloor } from '@/lib/leverage/floor';

describe('assessFloor — Benjamini-Hochberg', () => {
  // Hand-worked, m = 10, q = 0.05, so the BH line is k * 0.005:
  //
  //   k       1      2      3      4 ...
  //   p     .006   .008   .010   .300
  //   line  .005   .010   .015   .020
  //   p<=line  no    yes    yes     no
  //
  // BH takes the LARGEST k that clears, then rejects everything up to it. So all
  // three of the smallest p-values are reported — including the first, whose own
  // p exceeds its own line. That step-up behaviour is the whole difference from
  // Bonferroni, and it is why BH has usable power at m = 1140.
  //
  // Boundary ties are avoided on purpose: p is reconstructed from a z-score by
  // bisection here and recomputed from that z inside assessFloor, so an exact
  // equality case would turn on the last bit of two different approximations.
  it('matches a hand-worked example, including the step-up property', () => {
    const ps = [0.006, 0.008, 0.01, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];
    // Materiality 0 and se 1 makes delta the z-score, so p is controllable.
    const inputs = ps.map((pv) => ({ deltaPp: zFor(pv), sePp: 1 }));

    const out = assessFloor(inputs, 0, 0.05);
    expect(out.comparisonCount).toBe(10);
    expect(out.reportableCount).toBe(3);
    out.verdicts.forEach((v, i) => expect(v.reportable).toBe(i < 3));
  });

  it('admits nothing when no comparison clears the line', () => {
    const inputs = Array.from({ length: 50 }, () => ({ deltaPp: 0.5, sePp: 1 }));
    const out = assessFloor(inputs, 0, 0.05);
    expect(out.reportableCount).toBe(0);
    expect(out.bhCutoffP).toBe(0);
    expect(out.verdicts.every((v) => !v.reportable)).toBe(true);
  });

  // Under a global null the p-values are Uniform(0,1), so an exact uniform grid
  // is the deterministic stand-in for 200 pure-noise comparisons.
  it('rejects nothing under a global null', () => {
    const inputs = Array.from({ length: 200 }, (_, i) => ({
      deltaPp: zFor((i + 0.5) / 200),
      sePp: 1,
    }));
    const out = assessFloor(inputs, 0, 0.05);
    expect(out.reportableCount).toBe(0);
  });

  // The case the old per-comparison gate got wrong: a few genuine effects buried
  // in noise that is individually "significant at 5%" often enough to swamp them.
  it('separates a few real effects from a noise background', () => {
    const noise = Array.from({ length: 196 }, (_, i) => ({
      deltaPp: zFor((i + 0.5) / 196),
      sePp: 1,
    }));
    const real = [8, 9, 10, 11].map((z) => ({ deltaPp: z, sePp: 1 }));
    const out = assessFloor([...real, ...noise], 0, 0.05);

    expect(out.reportableCount).toBe(4);
    out.verdicts.slice(0, 4).forEach((v) => expect(v.reportable).toBe(true));
    out.verdicts.slice(4).forEach((v) => expect(v.reportable).toBe(false));
  });

  it('handles an empty family', () => {
    const out = assessFloor([], 1);
    expect(out.reportableCount).toBe(0);
    expect(out.comparisonCount).toBe(0);
    expect(out.verdicts).toEqual([]);
  });
});

describe('assessFloor — relevance null', () => {
  it('rejects a precisely-measured but immaterial effect', () => {
    // 0.10pp measured to +/-0.01pp: overwhelming against a nil null, and
    // nothing a reader should be shown when the threshold is 1pp.
    const inputs = [{ deltaPp: 0.1, sePp: 0.01 }];
    expect(assessFloor(inputs, 0).reportableCount).toBe(1);
    expect(assessFloor(inputs, 1).reportableCount).toBe(0);
  });

  it('keeps a large effect that a nil null would also keep', () => {
    const inputs = [{ deltaPp: 8.5, sePp: 0.12 }];
    expect(assessFloor(inputs, 1).reportableCount).toBe(1);
  });

  it('is symmetric in the sign of the effect', () => {
    const up = assessFloor([{ deltaPp: 4, sePp: 0.5 }], 1);
    const down = assessFloor([{ deltaPp: -4, sePp: 0.5 }], 1);
    expect(up.verdicts[0].pValue).toBeCloseTo(down.verdicts[0].pValue, 12);
    expect(down.verdicts[0].reportable).toBe(true);
    expect(down.verdicts[0].shrunkDeltaPp).toBeLessThan(0);
  });
});

describe('assessFloor — empirical Bayes shrinkage', () => {
  it('barely moves estimates when the effect spread dwarfs the error bars', () => {
    // Mirrors the Matchday 0 top7Pct regime: deltas spanning 0-8pp, se ~0.12pp.
    const inputs = Array.from({ length: 300 }, (_, i) => ({
      deltaPp: (i % 30) * 0.3,
      sePp: 0.12,
    }));
    const out = assessFloor(inputs, 1);
    expect(out.tauPp).toBeGreaterThan(1);
    expect(out.shrinkageWeight).toBeGreaterThan(0.99);
  });

  it('shrinks hard when the error bars dominate', () => {
    // Rare-event regime: true effects near zero, error bars large.
    const inputs = Array.from({ length: 300 }, () => ({ deltaPp: 0.05, sePp: 2 }));
    const out = assessFloor(inputs, 0);
    expect(out.tauPp).toBe(0);
    expect(out.shrinkageWeight).toBeLessThan(0.01);
    expect(Math.abs(out.verdicts[0].shrunkDeltaPp)).toBeLessThan(0.01);
  });

  it('shrinks noisier comparisons more than precise ones', () => {
    const inputs = [
      { deltaPp: 3, sePp: 0.1 },
      { deltaPp: 3, sePp: 2.0 },
      ...Array.from({ length: 50 }, (_, i) => ({ deltaPp: i * 0.1, sePp: 0.5 })),
    ];
    const out = assessFloor(inputs, 0.5);
    expect(out.verdicts[0].shrinkageWeight).toBeGreaterThan(out.verdicts[1].shrinkageWeight);
    expect(Math.abs(out.verdicts[0].shrunkDeltaPp)).toBeGreaterThan(
      Math.abs(out.verdicts[1].shrunkDeltaPp)
    );
    out.verdicts.forEach((v) => {
      expect(v.shrinkageWeight).toBeGreaterThanOrEqual(0);
      expect(v.shrinkageWeight).toBeLessThanOrEqual(1);
    });
  });
});

/** Inverse normal upper tail, by bisection — test-only, so clarity over speed. */
function zFor(p: number): number {
  let lo = 0;
  let hi = 40;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (0.5 * erfc(mid / Math.SQRT2) > p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

function erfc(x: number): number {
  const t = 1 / (1 + 0.3275911 * x);
  const poly =
    t *
    (0.254829592 +
      t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  return poly * Math.exp(-x * x);
}
