import { Team } from './types';
import { priorElo } from './ratings/priors';

const HOME_ADV = 65;
const BASE_ELO = 1500;

/**
 * Prior weight expressed in pseudo-matches.
 *
 * K = 12 means the preseason prior and this season's results carry equal weight
 * once 12 matches have been played:
 *
 *   played  0  ->  w = 1.00   pure prior
 *   played  6  ->  w = 0.67
 *   played 12  ->  w = 0.50
 *   played 19  ->  w = 0.39   half a season
 *   played 38  ->  w = 0.24
 *
 * Chosen so the prior dominates the volatile opening stretch and has largely
 * decayed by the new year. It is a shrinkage estimator, not a fitted
 * hyperparameter — the same idea as regressing last season's PPG toward the mean
 * in ratings/priors.ts, applied to the other direction of the same problem. A
 * backtest is what would replace 12 with a fitted value; until then the number
 * is surfaced in the UI rather than hidden, so a reader can see how much of an
 * August projection is assumption.
 */
const PRIOR_PSEUDO_MATCHES = 12;

/**
 * Strength implied by this season's results alone. Crude by design: points per
 * game says nothing about who those points came against. Replaced when the goal
 * model gains per-team attack and defence strengths; this is the seam for it.
 */
function formElo(team: Team): number {
  if (team.played === 0) return BASE_ELO;
  return BASE_ELO + (team.points / team.played - 1.5) * 200;
}

/** Weight given to the preseason prior. 1.0 at Matchday 0, decaying with matches. */
export function priorWeight(played: number): number {
  return PRIOR_PSEUDO_MATCHES / (PRIOR_PSEUDO_MATCHES + Math.max(0, played));
}

/**
 * A club's current strength: its preseason prior blended with this season's form,
 * weighted by how much evidence the season has actually produced.
 *
 * The signature is unchanged from the points-per-game version deliberately — five
 * call sites depend on it, and none of them should have to know that the
 * internals became a Bayesian blend.
 */
export function teamElo(team: Team): number {
  const prior = priorElo(team.abbr);
  if (team.played === 0) return prior;
  const w = priorWeight(team.played);
  return w * prior + (1 - w) * formElo(team);
}

/** The blend broken out, for the confidence indicator and for debugging. */
export function eloBreakdown(team: Team) {
  return {
    prior: priorElo(team.abbr),
    form: formElo(team),
    blended: teamElo(team),
    priorWeight: priorWeight(team.played),
    played: team.played,
  };
}

export function eloProb(homeStrength: number, awayStrength: number) {
  const diff = homeStrength + HOME_ADV - awayStrength;
  const expectedHome = 1 / (1 + Math.pow(10, -diff / 400));
  const drawRate = Math.max(0.10, 0.26 - 0.004 * Math.abs(diff / 50));

  const rawHome = Math.max(0.05, expectedHome - drawRate / 2);
  const rawAway = Math.max(0.05, 1 - expectedHome - drawRate / 2);
  const rawDraw = drawRate;

  // Normalise to sum to 1
  const total = rawHome + rawAway + rawDraw;
  return {
    homeWin: rawHome / total,
    draw: rawDraw / total,
    awayWin: rawAway / total,
  };
}
