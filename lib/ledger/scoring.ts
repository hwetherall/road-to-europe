/**
 * Proper scoring rules for the Preseason Ledger.
 *
 * WHY "PROPER" IS THE LOAD-BEARING WORD
 *
 * A scoring rule is proper when it is minimised by reporting your true belief.
 * That property is what makes a forecast testable: under a proper rule there is
 * no way to improve your score by shading a number toward something that sounds
 * more confident, or hedging toward 50% to look cautious. Both make the score
 * worse. Everything the Ledger claims rests on this — a track record kept under
 * an improper rule measures presentation, not accuracy.
 *
 * Brier and log loss are both proper. They disagree about how much to punish
 * confident errors: Brier is quadratic and bounded, log loss is unbounded and
 * goes to infinity for a probability of 0 assigned to something that happens.
 * Both are recorded because the disagreement is informative — a model that looks
 * fine on Brier and terrible on log loss is one that is occasionally very
 * confidently wrong, which is exactly the failure worth knowing about.
 */

/** Probabilities are clipped this far from 0 and 1 before taking a logarithm. */
const LOG_LOSS_EPSILON = 1e-15;

/**
 * Brier score for a single binary forecast: (p - outcome)^2. Lower is better.
 *
 * Reference points worth holding on to: 0 is perfect, 0.25 is what you get by
 * always saying 50%, and 1.0 is the worst possible. Anything above 0.25 means
 * the forecast was worse than refusing to forecast.
 */
export function brierScore(forecast: number, outcome: boolean): number {
  const p = clampProbability(forecast);
  const o = outcome ? 1 : 0;
  return (p - o) ** 2;
}

/**
 * Log loss (negative log likelihood) for a single binary forecast.
 *
 * Unbounded by design: assigning 0.1% to something that then happens costs ~6.9,
 * where Brier charges only 0.998. That asymmetry is the point — it is the rule
 * that notices a model which is confidently wrong rather than merely wrong.
 */
export function logLoss(forecast: number, outcome: boolean): number {
  const p = Math.min(1 - LOG_LOSS_EPSILON, Math.max(LOG_LOSS_EPSILON, clampProbability(forecast)));
  return outcome ? -Math.log(p) : -Math.log(1 - p);
}

/**
 * Ranked Probability Score over an ORDERED outcome, here final league position.
 *
 *   RPS = 1/(K-1) * sum over k of (F_forecast(k) - F_observed(k))^2
 *
 * where F is the cumulative distribution up to position k. Lower is better; 0 is
 * a point mass on the right answer.
 *
 * This is the right rule for position and Brier is not, because position is
 * ordered and Brier is blind to that. Brier treats "predicted 5th, finished 6th"
 * and "predicted 5th, finished 20th" as equally wrong — both are simply a miss.
 * RPS accumulates the squared error of the CUMULATIVE distribution, so being
 * wrong by fifteen places is penalised far more heavily than being wrong by one.
 * For a forecaster that is the difference between a near miss and no idea, and
 * collapsing them loses most of the information in the forecast.
 *
 * `distribution` must be indexed from 0 = 1st place, and is normalised here
 * rather than assumed to sum to one: it arrives from a Monte Carlo run, so it
 * sums to one only up to rounding.
 */
export function rankedProbabilityScore(distribution: number[], finalPosition: number): number {
  const k = distribution.length;
  if (k < 2) return 0;
  if (finalPosition < 1 || finalPosition > k) {
    throw new Error(`finalPosition ${finalPosition} is outside 1..${k}`);
  }

  const total = distribution.reduce((sum, p) => sum + p, 0);
  if (total <= 0) return 0;

  let cumulativeForecast = 0;
  let sum = 0;
  for (let i = 0; i < k - 1; i++) {
    cumulativeForecast += distribution[i] / total;
    // The observed CDF is a step: 0 below the actual position, 1 from it on.
    const cumulativeObserved = i + 1 >= finalPosition ? 1 : 0;
    sum += (cumulativeForecast - cumulativeObserved) ** 2;
  }
  return sum / (k - 1);
}

/** Mean of a set of scores, or null when there is nothing to average. */
export function meanScore(scores: number[]): number | null {
  if (scores.length === 0) return null;
  return scores.reduce((sum, s) => sum + s, 0) / scores.length;
}

/**
 * The score a forecast has to beat to be worth anything: the same metric scored
 * against the base rate rather than against a per-club forecast.
 *
 * Reporting a Brier score alone says nothing — 0.05 sounds good until you notice
 * that always predicting "not relegated" scores 0.13 on a 15%-base-rate event.
 * A skill score is the comparison that makes the number mean something.
 */
export function skillScore(modelScore: number, baselineScore: number): number | null {
  if (baselineScore <= 0) return null;
  return 1 - modelScore / baselineScore;
}

function clampProbability(p: number): number {
  if (!Number.isFinite(p)) return 0.5;
  return Math.min(1, Math.max(0, p));
}
