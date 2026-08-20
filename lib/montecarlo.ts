import { Team, Fixture, SimulationResult } from './types';
import { GOAL_PARAMS } from './sim/goals';
import {
  hashRand,
  outcomeSubstream,
  samplePoisson,
  scorelineSubstream,
  simKey,
} from './sim/rng';

/**
 * Monte Carlo season simulation.
 *
 * Pass `seed` for a reproducible run: the same standings, fixtures and seed
 * always produce the same probabilities, so a number does not drift when the
 * reader presses Re-run. Omit it and the run uses Math.random as before.
 *
 * Randomness is drawn per (simulation, fixture) substream rather than from one
 * sequential stream — see lib/sim/rng.ts for why that matters.
 */
export function simulate(
  teams: Team[],
  fixtures: Fixture[],
  numSims: number,
  seed?: number
): SimulationResult[] {
  const teamIndex: Record<string, number> = {};
  teams.forEach((t, i) => {
    teamIndex[t.abbr] = i;
  });

  const n = teams.length;
  const positionCounts = new Array(n).fill(null).map(() => new Array(n).fill(0));
  const totalPoints = new Array(n).fill(0);
  const totalPositions = new Array(n).fill(0);

  // Only process scheduled fixtures
  const scheduledFixtures = fixtures.filter((f) => f.status === 'SCHEDULED');
  const seeded = seed !== undefined;

  for (let sim = 0; sim < numSims; sim++) {
    const simIndex = seeded ? simKey(seed as number, sim) : 0;

    // Clone current state
    const points = teams.map((t) => t.points);
    const gd = teams.map((t) => t.goalDifference);
    const gf = teams.map((t) => t.goalsFor);

    for (let j = 0; j < scheduledFixtures.length; j++) {
      const fixture = scheduledFixtures[j];
      const hi = teamIndex[fixture.homeTeam];
      const ai = teamIndex[fixture.awayTeam];
      if (hi === undefined || ai === undefined) continue;

      const hProb = fixture.homeWinProb ?? 0.4;
      const dProb = fixture.drawProb ?? 0.25;

      const rand = seeded ? hashRand(simIndex, outcomeSubstream(j), 0) : Math.random();
      const outcome = rand < hProb ? 0 : rand < hProb + dProb ? 1 : 2;

      let draw = 0;
      const next = seeded
        ? () => hashRand(simIndex, scorelineSubstream(j, outcome), draw++)
        : Math.random;

      let homeGoals: number;
      let awayGoals: number;

      if (outcome === 0) {
        // Home win
        homeGoals = samplePoisson(GOAL_PARAMS.homeWin.home, next);
        awayGoals = samplePoisson(GOAL_PARAMS.homeWin.away, next);
        // Ensure home actually wins
        if (homeGoals <= awayGoals) {
          homeGoals = awayGoals + 1;
        }
        points[hi] += 3;
      } else if (outcome === 1) {
        // Draw
        homeGoals = samplePoisson(GOAL_PARAMS.draw.home, next);
        awayGoals = homeGoals; // Force equal for draw
        points[hi] += 1;
        points[ai] += 1;
      } else {
        // Away win
        homeGoals = samplePoisson(GOAL_PARAMS.awayWin.home, next);
        awayGoals = samplePoisson(GOAL_PARAMS.awayWin.away, next);
        // Ensure away actually wins
        if (awayGoals <= homeGoals) {
          awayGoals = homeGoals + 1;
        }
        points[ai] += 3;
      }

      gd[hi] += homeGoals - awayGoals;
      gd[ai] += awayGoals - homeGoals;
      gf[hi] += homeGoals;
      gf[ai] += awayGoals;
    }

    // Sort by points -> GD -> GF (EPL tiebreakers)
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
    top4Pct: positionCounts[i].slice(0, 4).reduce((a, b) => a + b, 0) / numSims * 100,
    top5Pct: positionCounts[i].slice(0, 5).reduce((a, b) => a + b, 0) / numSims * 100,
    top6Pct: positionCounts[i].slice(0, 6).reduce((a, b) => a + b, 0) / numSims * 100,
    top7Pct: positionCounts[i].slice(0, 7).reduce((a, b) => a + b, 0) / numSims * 100,
    relegationPct: positionCounts[i].slice(-3).reduce((a, b) => a + b, 0) / numSims * 100,
    championPct: positionCounts[i][0] / numSims * 100,
    survivalPct: (1 - positionCounts[i].slice(-3).reduce((a, b) => a + b, 0) / numSims) * 100,
    avgPoints: totalPoints[i] / numSims,
    avgPosition: totalPositions[i] / numSims,
  }));
}
