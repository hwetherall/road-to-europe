/**
 * `simulateFull` was a byte-for-byte duplicate of `simulate` in
 * lib/montecarlo.ts, right down to the comments — its own docstring said so
 * ("exact copy of client-side simulate()"). Two copies meant two places to
 * change for the Dixon-Coles work and two places for a fix to be applied to
 * only one of. It is now an alias.
 *
 * `simulateFast` lived here too: a cheaper variant using +/-1 goal difference
 * instead of Poisson sampling, for the path-search inner loop. That loop now
 * runs on the paired leverage engine (lib/leverage/paired-scan.ts), so nothing
 * called it and it has been removed rather than left to rot.
 */
export { simulate as simulateFull } from './montecarlo';
