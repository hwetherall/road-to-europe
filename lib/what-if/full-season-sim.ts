import { Team, Fixture, SimulationResult } from '../types';
import { teamElo, eloProb } from '../elo';
import { GOAL_PARAMS } from '../sim/goals';
import {
  hashRand,
  outcomeSubstream,
  samplePoisson,
  scorelineSubstream,
  simKey,
} from '../sim/rng';

export interface TeamModification {
  teamAbbr: string;
  homeWinDelta: number;   // Applied to EVERY home match for this team
  awayWinDelta: number;   // Applied to EVERY away match for this team
  drawDelta: number;      // Applied to EVERY match involving this team
}

export interface FullSeasonSimConfig {
  teams: Team[];
  fixtures: Fixture[];         // ALL 380 fixtures (completed + scheduled)
  modifications: TeamModification[];
  numSims: number;             // Default 10000
  /** Optional: makes the run reproducible. See lib/sim/rng.ts. */
  seed?: number;
}

/**
 * Simulate a FULL 38-game season from scratch.
 *
 * KEY DIFFERENCE from the standard simulate():
 * - Ignores current standings entirely (all teams start at 0 points)
 * - Simulates ALL 380 fixtures, including those already completed
 * - Uses Elo-derived base probabilities for every fixture
 * - Applies team-level modifications across ALL fixtures
 *
 * This answers the question: "If we replayed the entire season with
 * these structural changes, what would the final table look like?"
 *
 * Base probabilities come from Elo ratings. We do NOT use bookmaker
 * odds here because:
 * 1. Bookmaker odds only exist for upcoming fixtures
 * 2. We need consistent probabilities across all 380 matches
 * 3. Elo captures relative team strength, which is what we're modifying
 *
 * The Elo ratings themselves come from the CURRENT season's points-per-game,
 * which means they reflect how teams have actually performed this season.
 * When we apply modifications (e.g. "West Ham with a better squad"),
 * we're asking: "What if this team had been X% stronger all season?"
 */
export function simulateFullSeason(config: FullSeasonSimConfig): SimulationResult[] {
  const { teams, fixtures, modifications, numSims, seed } = config;
  const seeded = seed !== undefined;

  const teamIndex: Record<string, number> = {};
  teams.forEach((t, i) => { teamIndex[t.abbr] = i; });

  // Pre-compute Elo for each team (based on current season PPG)
  const eloRatings: Record<string, number> = {};
  for (const team of teams) {
    eloRatings[team.abbr] = teamElo(team);
  }

  // Pre-compute modification lookup
  const modMap: Record<string, TeamModification> = {};
  for (const mod of modifications) {
    modMap[mod.teamAbbr] = mod;
  }

  // Pre-compute base probabilities for ALL 380 fixtures
  // These are Elo-derived, with modifications applied
  const allFixtures = fixtures.filter(f =>
    // Include ALL fixtures: completed AND scheduled
    teamIndex[f.homeTeam] !== undefined && teamIndex[f.awayTeam] !== undefined
  );

  interface PrecomputedFixture {
    homeIdx: number;
    awayIdx: number;
    homeWinProb: number;
    drawProb: number;
    awayWinProb: number;
  }

  const precomputed: PrecomputedFixture[] = allFixtures.map(f => {
    const homeElo = eloRatings[f.homeTeam] ?? 1500;
    const awayElo = eloRatings[f.awayTeam] ?? 1500;
    const base = eloProb(homeElo, awayElo);

    // Apply modifications
    const homeMod = modMap[f.homeTeam];
    const awayMod = modMap[f.awayTeam];

    let hProb = base.homeWin;
    let dProb = base.draw;
    let aProb = base.awayWin;

    // Home team modifications (when playing at home)
    if (homeMod) {
      hProb += homeMod.homeWinDelta;
      dProb += homeMod.drawDelta;
    }

    // Away team modifications (when playing away)
    if (awayMod) {
      aProb += awayMod.awayWinDelta;
      dProb += awayMod.drawDelta;
    }

    // Clamp and normalise
    hProb = Math.max(0.02, Math.min(0.95, hProb));
    dProb = Math.max(0.02, Math.min(0.50, dProb));
    aProb = Math.max(0.02, Math.min(0.95, aProb));
    const total = hProb + dProb + aProb;

    return {
      homeIdx: teamIndex[f.homeTeam],
      awayIdx: teamIndex[f.awayTeam],
      homeWinProb: hProb / total,
      drawProb: dProb / total,
      awayWinProb: aProb / total,
    };
  });

  const n = teams.length;
  const positionCounts = new Array(n).fill(null).map(() => new Array(n).fill(0));
  const totalPoints = new Array(n).fill(0);
  const totalPositions = new Array(n).fill(0);

  for (let sim = 0; sim < numSims; sim++) {
    const simIndex = seeded ? simKey(seed as number, sim) : 0;

    // Start from ZERO — no banked points
    const points = new Array(n).fill(0);
    const gd = new Array(n).fill(0);
    const gf = new Array(n).fill(0);

    for (let j = 0; j < precomputed.length; j++) {
      const pf = precomputed[j];
      const rand = seeded ? hashRand(simIndex, outcomeSubstream(j), 0) : Math.random();
      const outcome =
        rand < pf.homeWinProb ? 0 : rand < pf.homeWinProb + pf.drawProb ? 1 : 2;

      let draw = 0;
      const next = seeded
        ? () => hashRand(simIndex, scorelineSubstream(j, outcome), draw++)
        : Math.random;

      let homeGoals: number;
      let awayGoals: number;

      if (outcome === 0) {
        homeGoals = samplePoisson(GOAL_PARAMS.homeWin.home, next);
        awayGoals = samplePoisson(GOAL_PARAMS.homeWin.away, next);
        if (homeGoals <= awayGoals) homeGoals = awayGoals + 1;
        points[pf.homeIdx] += 3;
      } else if (outcome === 1) {
        homeGoals = samplePoisson(GOAL_PARAMS.draw.home, next);
        awayGoals = homeGoals;
        points[pf.homeIdx] += 1;
        points[pf.awayIdx] += 1;
      } else {
        homeGoals = samplePoisson(GOAL_PARAMS.awayWin.home, next);
        awayGoals = samplePoisson(GOAL_PARAMS.awayWin.away, next);
        if (awayGoals <= homeGoals) awayGoals = homeGoals + 1;
        points[pf.awayIdx] += 3;
      }

      gd[pf.homeIdx] += homeGoals - awayGoals;
      gd[pf.awayIdx] += awayGoals - homeGoals;
      gf[pf.homeIdx] += homeGoals;
      gf[pf.awayIdx] += awayGoals;
    }

    // Sort by points → GD → GF (EPL tiebreakers)
    const indices = teams.map((_, i) => i);
    indices.sort((a, b) => {
      if (points[b] !== points[a]) return points[b] - points[a];
      if (gd[b] !== gd[a]) return gd[b] - gd[a];
      return gf[b] - gf[a];
    });

    indices.forEach((teamIdx, position) => {
      positionCounts[teamIdx][position]++;
      totalPoints[teamIdx] += points[teamIdx];
      totalPositions[teamIdx] += position + 1;
    });
  }

  return teams.map((team, i) => ({
    team: team.abbr,
    positionDistribution: positionCounts[i],
    top4Pct: positionCounts[i].slice(0, 4).reduce((a: number, b: number) => a + b, 0) / numSims * 100,
    top5Pct: positionCounts[i].slice(0, 5).reduce((a: number, b: number) => a + b, 0) / numSims * 100,
    top6Pct: positionCounts[i].slice(0, 6).reduce((a: number, b: number) => a + b, 0) / numSims * 100,
    top7Pct: positionCounts[i].slice(0, 7).reduce((a: number, b: number) => a + b, 0) / numSims * 100,
    relegationPct: positionCounts[i].slice(-3).reduce((a: number, b: number) => a + b, 0) / numSims * 100,
    championPct: positionCounts[i][0] / numSims * 100,
    survivalPct: (1 - positionCounts[i].slice(-3).reduce((a: number, b: number) => a + b, 0) / numSims) * 100,
    avgPoints: totalPoints[i] / numSims,
    avgPosition: totalPositions[i] / numSims,
  }));
}
