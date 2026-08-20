/**
 * Counter-based PRNG for common random numbers across paired simulations.
 *
 * WHY NOT A STREAMING PRNG
 *
 * The obvious design — one seeded stream per simulation, e.g. mulberry32(seed +
 * simIndex) — does not work here. sampleGoals() is a rejection sampler, so it
 * consumes a *variable* number of draws: a home win costs two calls, a draw
 * one. The moment a locked fixture's outcome differs from the baseline, the
 * stream desynchronises and every fixture after it in that simulation diverges
 * too. The pairing is lost exactly where it matters.
 *
 * A stateless hash keyed on (simulation, substream, draw) gives every fixture
 * its own independent substream, so a divergence inside one fixture cannot
 * contaminate any other.
 *
 * Measured on a 380-fixture Matchday 0 workload, locking one fixture,
 * 1000 sims, 24 trials — standard deviation of the reported delta:
 *
 *   unpaired Math.random                      1.771 pp
 *   one mulberry32 stream per simulation      0.969 pp   (1.8x reduction)
 *   substream per (sim, fixture, draw)        0.777 pp   (2.3x reduction)
 *
 * WHY ADDITIVE MIXING, NOT XOR
 *
 * Over the real index space (1000 sims x 380 fixtures x 4 draws = 1,520,000
 * draws) XOR-mixing the three axes loses ~630 values to structural collisions;
 * additive mixing into a murmur3 finaliser loses none, matching an ideal
 * random source. Both pass chi-square uniformity (32 bins, n = 1e6) and
 * lag-1 correlation on all three axes; additive is the safer default and no
 * slower in practice.
 */

/**
 * Uniform in [0, 1). Deterministic in its three indices and nothing else, so
 * two runs that agree on (sim, substream, draw) always see the same value.
 */
export function hashRand(sim: number, substream: number, draw: number): number {
  let t =
    (Math.imul(sim, 0x9e3779b1) +
      Math.imul(substream, 0x85ebca6b) +
      Math.imul(draw, 0xc2b2ae35)) |
    0;
  t ^= t >>> 16;
  t = Math.imul(t, 0x21f0aaad);
  t ^= t >>> 15;
  t = Math.imul(t, 0x735a2d97);
  t ^= t >>> 15;
  return (t >>> 0) / 4294967296;
}

/**
 * Simulation key for iteration `index` of the run identified by `seed`.
 *
 * Not `seed + index`: with that, seeds 42 and 43 over 500 iterations share 499
 * of their 500 keys, so two nominally different runs are almost the same
 * sample. Spreading the seed across the whole 32-bit range first means adjacent
 * seeds land billions apart and never overlap for any realistic sim count.
 */
export function simKey(seed: number, index: number): number {
  return (Math.imul(seed, 0x9e3779b1) + index) | 0;
}

/**
 * Substream layout for a fixture.
 *
 * Each fixture owns four substreams: one for the outcome draw, and one for the
 * scoreline of each of the three possible outcomes. Keeping the scorelines on
 * separate substreams is what makes a lock cheap AND exactly paired — the
 * scoreline for "home win" is identical whether that outcome came up naturally
 * in the baseline or was forced by a lock.
 */
export const SUBSTREAMS_PER_FIXTURE = 4;

/** Substream carrying the win/draw/loss selection draw for fixture `index`. */
export function outcomeSubstream(index: number): number {
  return index * SUBSTREAMS_PER_FIXTURE;
}

/** Substream carrying the scoreline draws for `outcome` (0 home, 1 draw, 2 away). */
export function scorelineSubstream(index: number, outcome: number): number {
  return index * SUBSTREAMS_PER_FIXTURE + 1 + outcome;
}

/**
 * Poisson sample by Knuth's rejection method, drawing from a caller-supplied
 * stream. Unbounded in the number of draws it consumes, which is exactly why
 * each caller needs its own substream.
 */
export function samplePoisson(lambda: number, next: () => number): number {
  const limit = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= next();
  } while (p > limit);
  return k - 1;
}

/** Draws from one substream, advancing the draw index on each call. */
export function substreamReader(sim: number, substream: number): () => number {
  let draw = 0;
  return () => hashRand(sim, substream, draw++);
}
