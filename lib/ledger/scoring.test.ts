import { describe, expect, it } from 'vitest';
import {
  brierScore,
  logLoss,
  meanScore,
  rankedProbabilityScore,
  skillScore,
} from '@/lib/ledger/scoring';

describe('brierScore', () => {
  it('is zero for a correct point-mass forecast', () => {
    expect(brierScore(1, true)).toBe(0);
    expect(brierScore(0, false)).toBe(0);
  });

  it('is one for a maximally wrong forecast', () => {
    expect(brierScore(0, true)).toBe(1);
    expect(brierScore(1, false)).toBe(1);
  });

  it('scores 0.25 for a coin flip, whatever happens', () => {
    expect(brierScore(0.5, true)).toBeCloseTo(0.25, 12);
    expect(brierScore(0.5, false)).toBeCloseTo(0.25, 12);
  });

  /**
   * Propriety, demonstrated rather than asserted. If the true probability is
   * 0.30, then the EXPECTED Brier score is minimised by reporting 0.30 — every
   * other report scores worse in expectation. This is what stops a forecaster
   * gaming the Ledger by shading toward a confident-sounding number.
   */
  it('is minimised in expectation by reporting the true probability', () => {
    const truth = 0.3;
    const expected = (p: number) => truth * brierScore(p, true) + (1 - truth) * brierScore(p, false);
    const atTruth = expected(truth);
    for (const p of [0, 0.1, 0.2, 0.29, 0.31, 0.4, 0.5, 0.8, 1]) {
      expect(expected(p)).toBeGreaterThan(atTruth - 1e-12);
    }
  });

  it('clamps rather than throwing on an out-of-range forecast', () => {
    expect(brierScore(1.4, true)).toBe(0);
    expect(brierScore(-0.2, false)).toBe(0);
  });
});

describe('logLoss', () => {
  it('is zero for a correct point-mass forecast', () => {
    expect(logLoss(1, true)).toBeCloseTo(0, 12);
    expect(logLoss(0, false)).toBeCloseTo(0, 12);
  });

  it('returns ln 2 for a coin flip', () => {
    expect(logLoss(0.5, true)).toBeCloseTo(Math.LN2, 12);
  });

  /**
   * The reason both rules are recorded. Brier's penalty for being confidently
   * wrong is bounded at 1; log loss's is not. A model that is usually right and
   * occasionally certain-and-wrong looks acceptable on one and awful on the other.
   */
  it('punishes confident errors far harder than Brier does', () => {
    const brier = brierScore(0.001, true);
    const log = logLoss(0.001, true);
    expect(brier).toBeLessThan(1.01);
    expect(log).toBeGreaterThan(6);
  });

  it('is minimised in expectation by reporting the true probability', () => {
    const truth = 0.7;
    const expected = (p: number) => truth * logLoss(p, true) + (1 - truth) * logLoss(p, false);
    const atTruth = expected(truth);
    for (const p of [0.05, 0.3, 0.5, 0.69, 0.71, 0.9, 0.99]) {
      expect(expected(p)).toBeGreaterThan(atTruth - 1e-12);
    }
  });

  it('does not return Infinity for a zero probability on an event that happened', () => {
    expect(Number.isFinite(logLoss(0, true))).toBe(true);
  });
});

describe('rankedProbabilityScore', () => {
  const K = 20;
  const pointMass = (position: number) => {
    const d = new Array(K).fill(0);
    d[position - 1] = 1;
    return d;
  };

  it('is zero for a correct point-mass forecast', () => {
    expect(rankedProbabilityScore(pointMass(1), 1)).toBeCloseTo(0, 12);
    expect(rankedProbabilityScore(pointMass(7), 7)).toBeCloseTo(0, 12);
    expect(rankedProbabilityScore(pointMass(20), 20)).toBeCloseTo(0, 12);
  });

  it('is one for the most wrong point-mass forecast possible', () => {
    // Predicted 1st with certainty, finished 20th: the two CDFs differ by 1 at
    // every one of the 19 summed steps.
    expect(rankedProbabilityScore(pointMass(1), 20)).toBeCloseTo(1, 12);
    expect(rankedProbabilityScore(pointMass(20), 1)).toBeCloseTo(1, 12);
  });

  /**
   * The property that makes RPS the right rule for an ordered outcome, and the
   * reason Brier is not used here: Brier would score both of these identically,
   * because to Brier both are simply "not the predicted position".
   */
  it('punishes being wrong by many places more than by one', () => {
    const nearMiss = rankedProbabilityScore(pointMass(5), 6);
    const wayOff = rankedProbabilityScore(pointMass(5), 20);
    expect(nearMiss).toBeLessThan(wayOff);
    expect(wayOff / nearMiss).toBeGreaterThan(10);
  });

  it('grows monotonically as the outcome moves away from the forecast', () => {
    let previous = -1;
    for (let actual = 5; actual <= 20; actual++) {
      const score = rankedProbabilityScore(pointMass(5), actual);
      expect(score).toBeGreaterThan(previous);
      previous = score;
    }
  });

  it('prefers a hedged forecast to a confidently wrong one', () => {
    const spread = new Array(K).fill(1 / K);
    expect(rankedProbabilityScore(spread, 20)).toBeLessThan(
      rankedProbabilityScore(pointMass(1), 20)
    );
  });

  it('normalises a distribution that does not quite sum to one', () => {
    // Monte Carlo output sums to one only up to rounding.
    const almost = pointMass(3).map((p) => p * 0.999);
    expect(rankedProbabilityScore(almost, 3)).toBeCloseTo(0, 9);
  });

  it('rejects a position outside the table', () => {
    expect(() => rankedProbabilityScore(pointMass(1), 0)).toThrow();
    expect(() => rankedProbabilityScore(pointMass(1), 21)).toThrow();
  });
});

describe('meanScore and skillScore', () => {
  it('averages, and reports nothing for an empty set', () => {
    expect(meanScore([0.1, 0.3])).toBeCloseTo(0.2, 12);
    expect(meanScore([])).toBeNull();
  });

  it('is positive only when the model beats the baseline', () => {
    expect(skillScore(0.1, 0.25)).toBeCloseTo(0.6, 12);
    expect(skillScore(0.25, 0.25)).toBeCloseTo(0, 12);
    expect(skillScore(0.4, 0.25) as number).toBeLessThan(0);
    expect(skillScore(0.1, 0)).toBeNull();
  });
});
