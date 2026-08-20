/**
 * Standard normal tail probabilities.
 *
 * Needed because the noise floor moved from a fixed 2-sigma gate to a
 * Benjamini-Hochberg procedure, which needs p-values. There is no statistics
 * dependency in this repo and one function does not justify adding one.
 *
 * Abramowitz & Stegun 7.1.26 for erf, absolute error < 1.5e-7. In the tail that
 * matters here — a family-wise-adjusted threshold sits around z = 4, where the
 * true tail probability is ~2e-5 — the absolute bound implies a relative error
 * under 1%. That is immaterial for ranking and for a 5% false-discovery target,
 * but it does mean these values should not be quoted as exact p-values.
 */

const A1 = 0.254829592;
const A2 = -0.284496736;
const A3 = 1.421413741;
const A4 = -1.453152027;
const A5 = 1.061405429;
const P = 0.3275911;

/** Error function, for x of either sign. */
export function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + P * ax);
  const poly = t * (A1 + t * (A2 + t * (A3 + t * (A4 + t * A5))));
  return sign * (1 - poly * Math.exp(-ax * ax));
}

/** Standard normal CDF. */
export function normalCdf(z: number): number {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

/**
 * Upper-tail probability P(Z > z). Clamped away from exactly zero so a log-scale
 * consumer cannot divide by it, and because the approximation underlying it is
 * not trustworthy far enough into the tail to distinguish 1e-12 from 0.
 */
export function normalSf(z: number): number {
  return Math.min(1, Math.max(1e-12, 1 - normalCdf(z)));
}
