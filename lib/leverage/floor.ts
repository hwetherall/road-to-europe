import { normalSf } from './normal';

/**
 * Deciding which leverage comparisons are worth reporting.
 *
 * WHY THE OLD GATE WAS THE WRONG SHAPE
 *
 * The previous rule was |delta| > 2 * sePp: a two-sided significance test
 * against a null of exactly zero. It was a real improvement on the inert
 * EPSILON = 1e-9 it replaced, but it answers a question no reader is asking.
 *
 * Every fixture in a 380-fixture league has SOME nonzero effect on where the
 * target finishes. So a nil-null test does not separate interesting fixtures
 * from boring ones; it separates fixtures we have enough simulations to resolve
 * from ones we do not. Measured on a Matchday 0 workload it rejected 44% of
 * fixtures at 5,000 simulations and 0% at 20,000 — it does the least work
 * exactly where the extra compute was spent. Push the simulation count high
 * enough and it admits everything, at which point what a reader sees is decided
 * by the ranking rather than by the gate.
 *
 * THREE CHANGES
 *
 * 1. TEST AGAINST A RELEVANCE NULL. The null becomes H0: |delta| <= material,
 *    where `material` is an editorial threshold — the smallest swing worth a
 *    reader's attention. The claim being made is then "we are confident this
 *    fixture is worth more than X percentage points", which is a sentence that
 *    can be shown to a reader, and which stops depending on the simulation
 *    budget once the budget is adequate.
 *
 * 2. CONTROL THE FALSE DISCOVERY RATE, NOT EACH COMPARISON. A Matchday 0 scan
 *    is 1,140 simultaneous comparisons (380 fixtures x 3 outcomes). Testing each
 *    at 5% would admit ~57 by chance alone. Benjamini-Hochberg rather than
 *    Bonferroni or Sidak, deliberately: family-wise control is the right error
 *    rate when a single decision is drawn from the family, and we publish a
 *    ranked LIST. The guarantee a reader needs is "of the fixtures shown, at
 *    most q are noise" — which is FDR. Family-wise control here would be
 *    answering a question nobody asked, at a large cost in power.
 *
 * 3. SHRINK THE REPORTED MAGNITUDES. The top-ranked delta was selected as the
 *    largest of 1,140 noisy estimates, so it is biased upward — the winner's
 *    curse. A normal-normal empirical-Bayes posterior mean corrects it:
 *
 *        tau^2   = max(0, mean(d^2) - mean(se^2))      (method of moments)
 *        weight  = tau^2 / (tau^2 + se^2)
 *        shrunk  = d * weight
 *
 *    This is the same estimator as the preseason blend in lib/elo.ts, one level
 *    up: weight = tau^2/(tau^2 + se^2) there reads K/(K + n). When the spread of
 *    true effects is large relative to the error bars the weight approaches 1
 *    and shrinkage is a near no-op — which is itself informative, being positive
 *    evidence that the ranking is driven by signal rather than by selection.
 *    `shrinkageWeight` is returned so that can be read rather than assumed.
 *
 * The p-values are computed from the RAW estimate and its standard error, not
 * from the shrunk one. Shrinking and then testing the shrunk value would count
 * the same prior twice.
 */

/** Default false discovery rate for the ranked list. */
export const DEFAULT_FDR_Q = 0.05;

export interface FloorInput {
  deltaPp: number;
  sePp: number;
}

export interface FloorVerdict {
  /** Posterior-mean delta after empirical-Bayes shrinkage toward zero. */
  shrunkDeltaPp: number;
  /** Shrinkage weight applied to this comparison. 1 = untouched. */
  shrinkageWeight: number;
  /** One-sided p-value against H0: |delta| <= materialEffectPp. */
  pValue: number;
  /** True when this comparison survives Benjamini-Hochberg at `q`. */
  reportable: boolean;
}

export interface FloorAssessment {
  verdicts: FloorVerdict[];
  /** The editorial relevance threshold applied, in percentage points. */
  materialEffectPp: number;
  /** The false discovery rate targeted. */
  q: number;
  /** Largest p-value admitted by the procedure; 0 when nothing was admitted. */
  bhCutoffP: number;
  /** Mean empirical-Bayes shrinkage weight. Near 1 means shrinkage did little. */
  shrinkageWeight: number;
  /** Estimated spread of true effects, in percentage points. */
  tauPp: number;
  reportableCount: number;
  comparisonCount: number;
}

/**
 * Assess a whole family of comparisons at once.
 *
 * Must be called with the ENTIRE family — every comparison the caller might
 * report — or the multiplicity correction is measuring the wrong denominator.
 */
export function assessFloor(
  inputs: FloorInput[],
  materialEffectPp: number,
  q: number = DEFAULT_FDR_Q
): FloorAssessment {
  const m = inputs.length;
  if (m === 0) {
    return {
      verdicts: [],
      materialEffectPp,
      q,
      bhCutoffP: 0,
      shrinkageWeight: 1,
      tauPp: 0,
      reportableCount: 0,
      comparisonCount: 0,
    };
  }

  // ── Empirical Bayes, method of moments ──
  let sumDeltaSq = 0;
  let sumVar = 0;
  for (const input of inputs) {
    sumDeltaSq += input.deltaPp * input.deltaPp;
    sumVar += input.sePp * input.sePp;
  }
  const tauSq = Math.max(0, sumDeltaSq / m - sumVar / m);
  const tauPp = Math.sqrt(tauSq);

  // ── Per-comparison shrinkage and p-value ──
  const weights = new Float64Array(m);
  const pValues = new Float64Array(m);
  for (let i = 0; i < m; i++) {
    const { deltaPp, sePp } = inputs[i];
    const varI = sePp * sePp;
    // A zero-variance comparison is measured exactly; nothing to shrink.
    weights[i] = tauSq + varI > 0 ? tauSq / (tauSq + varI) : 1;
    pValues[i] =
      sePp > 0
        ? normalSf((Math.abs(deltaPp) - materialEffectPp) / sePp)
        : Math.abs(deltaPp) > materialEffectPp
          ? 0
          : 1;
  }

  // ── Benjamini-Hochberg: largest k with p_(k) <= k*q/m ──
  const order = Array.from({ length: m }, (_, i) => i).sort((a, b) => pValues[a] - pValues[b]);
  let cutoffRank = 0;
  for (let k = 1; k <= m; k++) {
    if (pValues[order[k - 1]] <= (k * q) / m) cutoffRank = k;
  }
  const bhCutoffP = cutoffRank > 0 ? pValues[order[cutoffRank - 1]] : 0;

  const reportable = new Uint8Array(m);
  for (let k = 0; k < cutoffRank; k++) reportable[order[k]] = 1;

  let sumWeight = 0;
  const verdicts: FloorVerdict[] = inputs.map((input, i) => {
    sumWeight += weights[i];
    return {
      shrunkDeltaPp: input.deltaPp * weights[i],
      shrinkageWeight: weights[i],
      pValue: pValues[i],
      reportable: reportable[i] === 1,
    };
  });

  return {
    verdicts,
    materialEffectPp,
    q,
    bhCutoffP,
    shrinkageWeight: sumWeight / m,
    tauPp,
    reportableCount: cutoffRank,
    comparisonCount: m,
  };
}
