/**
 * Preseason Elo priors for 2026-27.
 *
 * WHY THIS FILE EXISTS
 *
 * lib/elo.ts used to derive a club's rating from its current-season points per
 * game alone. At Matchday 0 every club has played nothing, so every club came
 * back as exactly 1500 and the entire league was a coin flip. That is not a
 * cosmetic problem: 370 of the season's 380 fixtures get their probabilities
 * from team strength rather than from bookmaker odds, so a flat rating table
 * means 97% of the season is simulated as twenty identical clubs.
 *
 * DERIVATION — two sources, deliberately
 *
 * 1. CONTINUING CLUBS (17) — regressed carryover.
 *
 *      finalElo = 1500 + (2025-26 final PPG - 1.5) * 200
 *      prior    = 1500 + REGRESSION_RETAIN * (finalElo - 1500)
 *
 *    Retaining 55% shrinks each club 45% toward the league mean. One season of
 *    PPG is a noisy estimate of true strength and squads change over a summer,
 *    so the observed spread overstates the real spread badly.
 *
 *    REGRESSION_RETAIN was CALIBRATED, not guessed. The original spec proposed
 *    0.70 as "a defensible starting guess" and said Step 2 should sanity-check it
 *    against the market. Doing that sweep, scoring each candidate against 27
 *    market probabilities (20 relegation + 7 title) by mean absolute error:
 *
 *      retain   spread   title MAE   releg MAE   combined
 *      0.35     163      6.00        4.30        10.31
 *      0.45     177      5.77        4.21         9.98
 *      0.55     192      5.39        4.16         9.55   <- adopted
 *      0.65     207      5.58        4.25         9.83
 *      0.70     229      5.96        4.37        10.33
 *      0.80     229      6.62        5.27        11.89
 *
 *    0.70 was over-confident: it put Arsenal at 47.1% for the title where the
 *    market says 42.1%. At 0.55 that becomes 38.5%. The optimum is shallow —
 *    anything from 0.45 to 0.65 is close — which is the honest characterisation:
 *    this is one parameter fitted to 27 observations, not a precise quantity.
 *
 *    Note what is and is not market-derived here. The market set ONE global
 *    number, how hard to shrink last season's table. It did not set any club's
 *    position in that table. The shape of the forecast is still last season's
 *    results; the market only calibrated our confidence in them. That distinction
 *    is what keeps the Ledger a test of something.
 *
 *    Source: api.football-data.org/v4/competitions/PL/standings?season=2025,
 *    all 20 clubs at 38 games played. (The previous-season filter IS permitted
 *    on the current plan — checked, so the 31-game archived table in
 *    constants.ts is not needed.)
 *
 * 2. PROMOTED CLUBS (3) — anchored to the betting market.
 *
 *    A carryover prior cannot say anything about a promoted club: there is no
 *    Premier League season to carry over. The previous design used one flat
 *    PROMOTED_DEFAULT for all three, and the market says that is wrong — it
 *    prices Hull at 68.7% to be relegated against Coventry at 46.8% and Ipswich
 *    at 46.4%, a spread of 22 percentage points that a single constant cannot
 *    express.
 *
 *    So each promoted club's rating is set to the value that makes this
 *    simulator reproduce its market relegation probability. Source: Kalshi
 *    KXEPLRELEGATION-27, bid/ask mids de-vigged to sum to 3.0 (three clubs are
 *    relegated, so the market's implied probabilities must total three, not
 *    one). 17 of 20 markets carried a genuine two-sided quote and total volume
 *    was ~$30k.
 *
 * WHY NOT FIT ALL TWENTY TO THE MARKET
 *
 * Because it would destroy the thing being built. The Preseason Ledger's value
 * is that it records an independent forecast and then scores it. Fit every club
 * to the market and the Ledger measures how well Keepwatch reproduces Kalshi,
 * which is both less interesting and untestable as a claim about football. The
 * market is used here as a prior where there is no data, not as a target.
 *
 * The consequence is intentional: several continuing clubs disagree sharply with
 * the market — Tottenham, Chelsea and Sunderland most of all — and those
 * disagreements are kept, published, and scored. See ledger/ and §0.7 of
 * next-steps-plan.md.
 *
 * A NOTE ON THE TWO CONSTANTS INTERACTING
 *
 * REGRESSION_RETAIN pulls continuing clubs toward 1500 while a promoted club's
 * rating is set on an absolute scale, so the two can cross. They nearly did:
 * West Ham (39 pts) regress to 1434 and Burnley (22 pts) to 1371, either of
 * which would have landed among or below the promoted three. Both were relegated
 * so it does not arise this season. It will recur, and a continuing club priced
 * below a promoted one is a signal to re-examine the retain factor rather than
 * an automatic error.
 */

/** Where a club's prior came from. Recorded per club, because it varies. */
export type PriorProvenance = 'carryover_regressed' | 'market_relegation';

export const LEAGUE_MEAN_ELO = 1500;
export const REGRESSION_RETAIN = 0.55;

/**
 * Fallback for a club with no entry below. Should never be reached — every club
 * in the league is in the table — so reaching it means an unmapped club, and
 * priorElo logs it rather than quietly rating an unknown club as promoted.
 */
export const PROMOTED_DEFAULT = 1380;

export const PRIORS_GENERATED_AT = '2026-08-20';
export const PRIORS_SOURCE = 'hybrid_carryover_market_promoted';

export interface Prior {
  elo: number;
  from: PriorProvenance;
  /** 2025-26 final points, for continuing clubs. */
  lastSeasonPoints?: number;
  /** Free-text reason, required for any hand-set or market-set value. */
  note?: string;
}

export const PRESEASON_PRIORS: Record<string, Prior> = {
  // ── Continuing clubs: 2025-26 final PPG, regressed 30% toward 1500 ──
  ARS: { elo: 1581, from: 'carryover_regressed', lastSeasonPoints: 85 },
  MCI: { elo: 1561, from: 'carryover_regressed', lastSeasonPoints: 78 },
  MUN: { elo: 1541, from: 'carryover_regressed', lastSeasonPoints: 71 },
  AVL: { elo: 1523, from: 'carryover_regressed', lastSeasonPoints: 65 },
  LFC: { elo: 1509, from: 'carryover_regressed', lastSeasonPoints: 60 },
  BOU: { elo: 1500, from: 'carryover_regressed', lastSeasonPoints: 57 },
  SUN: { elo: 1491, from: 'carryover_regressed', lastSeasonPoints: 54 },
  BRI: { elo: 1488, from: 'carryover_regressed', lastSeasonPoints: 53 },
  BRE: { elo: 1488, from: 'carryover_regressed', lastSeasonPoints: 53 },
  CFC: { elo: 1486, from: 'carryover_regressed', lastSeasonPoints: 52 },
  FUL: { elo: 1486, from: 'carryover_regressed', lastSeasonPoints: 52 },
  NEW: { elo: 1477, from: 'carryover_regressed', lastSeasonPoints: 49 },
  EVE: { elo: 1477, from: 'carryover_regressed', lastSeasonPoints: 49 },
  LEE: { elo: 1471, from: 'carryover_regressed', lastSeasonPoints: 47 },
  CRY: { elo: 1465, from: 'carryover_regressed', lastSeasonPoints: 45 },
  NFO: { elo: 1462, from: 'carryover_regressed', lastSeasonPoints: 44 },

  // ── Tottenham: hand-adjusted, 1454 -> 1499 ──
  //
  // The only continuing club whose carryover prior was overridden, and the
  // clearest case of the spec's explanation (1): a summer the carryover cannot
  // see. Tottenham survived on 41 points and then spent heavily — reported
  // incomings include Tonali, Matheus Fernandes and van Hecke for large fees,
  // plus Sensi and Robertson on frees, with further signings under discussion.
  // (Fees as relayed by the project owner rather than independently verified;
  // what the rating rests on is the fact of a large first-team rebuild, not any
  // particular figure.)
  //
  // The carryover prior put Tottenham 17th of 20 and gave them a 20.7% chance of
  // relegation against a market 5.7% — a 15pp disagreement, and the largest on
  // the board. No value of REGRESSION_RETAIN fixes it, because the problem is
  // the club's POSITION in last season's table, not how hard that table is
  // shrunk. Fitted to the market relegation price by the same method as the
  // promoted clubs: 1499 reproduces 5.8%.
  //
  // This moves them from 17th to 7th in the prior table. That is a large jump on
  // one season's evidence, and it is the honest consequence of holding
  // information the model's inputs cannot encode. Reversible: delete this block
  // and restore `{ elo: 1454, from: 'carryover_regressed', lastSeasonPoints: 41 }`.
  TOT: {
    elo: 1499,
    from: 'market_relegation',
    lastSeasonPoints: 41,
    note: 'hand-adjusted from carryover 1454. Major summer rebuild after surviving on 41 points; fitted to Kalshi relegation 5.7%, reproduces 5.8%',
  },

  // ── Sunderland: NOT adjusted, deliberately ──
  //
  // The second-largest disagreement on the board, and left alone. The model has
  // them at 7.8% to be relegated against a market 23.9% — a 16pp gap in the
  // opposite direction to Tottenham's. The market was also pessimistic about
  // Sunderland last season, when they were widely tipped to go straight back
  // down and instead finished 7th and qualified for Europe. So this is not
  // obviously the market knowing something the table does not; it may be the
  // market repeating a mistake, and 54 points is real evidence.
  //
  // Recorded here because "we chose not to act" is a decision, and an unrecorded
  // one is indistinguishable from an oversight. The Ledger will score it.

  // ── Promoted clubs: fitted to Kalshi KXEPLRELEGATION-27, 2026-08-20 ──
  //
  // Each rating is the value at which this simulator reproduces the club's
  // market relegation probability. Fitted coordinate-wise (the three are each
  // other's main relegation rivals, so each fit shifts the others) over three
  // rounds of bisection, then verified at 20,000 simulations:
  //
  //   club  elo   model    market
  //   HUL   1400  67.8%    68.7%
  //   COV   1425  47.8%    46.8%
  //   IPS   1425  47.3%    46.4%
  //
  // Re-fitted jointly with the Tottenham adjustment below: strengthening one
  // mid-table club pushes relegation risk onto everyone else, so all four had to
  // move together rather than in sequence.
  //
  // Note how tight the bottom of the table is: 25 Elo separates Hull from
  // Ipswich and yet 21 percentage points of relegation risk. Over 38 games a
  // 25-Elo edge is worth about 5 points, and 5 points is a lot where clubs
  // finish 1-2 points apart. A single flat PROMOTED_DEFAULT could not have
  // expressed that, which is the whole reason these three are market-anchored.
  COV: {
    elo: 1425,
    from: 'market_relegation',
    note: 'Kalshi KXEPLRELEGATION-27 46.8% (de-vigged to sum 3.0); fitted 47.8%',
  },
  HUL: {
    elo: 1400,
    from: 'market_relegation',
    note: 'Kalshi KXEPLRELEGATION-27 68.7%; fitted 67.8%. Market rates Hull clearly weakest of the three',
  },
  IPS: {
    elo: 1425,
    from: 'market_relegation',
    note: 'Kalshi KXEPLRELEGATION-27 46.4%; fitted 47.3%',
  },
};

/** Clubs whose prior we could not find. Logged once each, not per call. */
const reportedMisses = new Set<string>();

export function priorElo(abbr: string): number {
  const prior = PRESEASON_PRIORS[abbr];
  if (prior) return prior.elo;

  if (!reportedMisses.has(abbr)) {
    reportedMisses.add(abbr);
    console.error(
      `[priors] No preseason prior for "${abbr}"; rating it as a promoted club ` +
        `(${PROMOTED_DEFAULT}). This is almost certainly an unmapped club — check ` +
        `lib/clubs.ts, since a provider's own abbreviation will not match ours.`
    );
  }
  return PROMOTED_DEFAULT;
}

export function priorFor(abbr: string): Prior | undefined {
  return PRESEASON_PRIORS[abbr];
}

/** Spread of the prior table, in Elo. A flat table is the bug this file fixes. */
export function priorSpread(): number {
  const values = Object.values(PRESEASON_PRIORS).map((p) => p.elo);
  return Math.max(...values) - Math.min(...values);
}
