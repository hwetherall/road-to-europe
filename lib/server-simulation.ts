import { Team, Fixture, SimulationResult } from './types';

// Poisson-distributed goal sampling
function sampleGoals(lambda: number): number {
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= Math.random();
  } while (p > L);
  return k - 1;
}

// Goal expectations by result type (calibrated to EPL averages)
const GOAL_PARAMS = {
  homeWin: { home: 1.7, away: 0.6 },
  draw: { home: 1.1, away: 1.1 },
  awayWin: { home: 0.7, away: 1.5 },
};

/**
 * Full simulation — exact copy of client-side simulate().
 * Used for final path validation (10K sims with Poisson GD).
 */
export function simulateFull(
  teams: Team[],
  fixtures: Fixture[],
  numSims: number
): SimulationResult[] {
  const teamIndex: Record<string, number> = {};
  teams.forEach((t, i) => {
    teamIndex[t.abbr] = i;
  });

  const n = teams.length;
  const positionCounts = new Array(n).fill(null).map(() => new Array(n).fill(0));
  const totalPoints = new Array(n).fill(0);
  const totalPositions = new Array(n).fill(0);

  const scheduledFixtures = fixtures.filter((f) => f.status === 'SCHEDULED');

  for (let sim = 0; sim < numSims; sim++) {
    const points = teams.map((t) => t.points);
    const gd = teams.map((t) => t.goalDifference);
    const gf = teams.map((t) => t.goalsFor);

    for (const fixture of scheduledFixtures) {
      const hi = teamIndex[fixture.homeTeam];
      const ai = teamIndex[fixture.awayTeam];
      if (hi === undefined || ai === undefined) continue;

      const hProb = fixture.homeWinProb ?? 0.4;
      const dProb = fixture.drawProb ?? 0.25;

      const rand = Math.random();
      let homeGoals: number;
      let awayGoals: number;

      if (rand < hProb) {
        homeGoals = sampleGoals(GOAL_PARAMS.homeWin.home);
        awayGoals = sampleGoals(GOAL_PARAMS.homeWin.away);
        if (homeGoals <= awayGoals) {
          homeGoals = awayGoals + 1;
        }
        points[hi] += 3;
      } else if (rand < hProb + dProb) {
        homeGoals = sampleGoals(GOAL_PARAMS.draw.home);
        awayGoals = homeGoals;
        points[hi] += 1;
        points[ai] += 1;
      } else {
        homeGoals = sampleGoals(GOAL_PARAMS.awayWin.home);
        awayGoals = sampleGoals(GOAL_PARAMS.awayWin.away);
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

/**
 * Fast simulation variant for path search inner loops.
 * Simplified GD: ±1 per result instead of Poisson sampling.
 * ~10x faster per call, sufficient for ranking paths.
 */
export function simulateFast(
  teams: Team[],
  fixtures: Fixture[],
  numSims: number
): SimulationResult[] {
  const teamIndex: Record<string, number> = {};
  teams.forEach((t, i) => {
    teamIndex[t.abbr] = i;
  });

  const n = teams.length;
  const positionCounts = new Array(n).fill(null).map(() => new Array(n).fill(0));
  const totalPoints = new Array(n).fill(0);
  const totalPositions = new Array(n).fill(0);

  const scheduledFixtures = fixtures.filter((f) => f.status === 'SCHEDULED');

  for (let sim = 0; sim < numSims; sim++) {
    const points = teams.map((t) => t.points);
    const gd = teams.map((t) => t.goalDifference);
    const gf = teams.map((t) => t.goalsFor);

    for (const fixture of scheduledFixtures) {
      const hi = teamIndex[fixture.homeTeam];
      const ai = teamIndex[fixture.awayTeam];
      if (hi === undefined || ai === undefined) continue;

      const hProb = fixture.homeWinProb ?? 0.4;
      const dProb = fixture.drawProb ?? 0.25;

      const rand = Math.random();

      if (rand < hProb) {
        // Home win: simplified +1/-1 GD
        points[hi] += 3;
        gd[hi] += 1;
        gd[ai] -= 1;
        gf[hi] += 1;
      } else if (rand < hProb + dProb) {
        // Draw: 0 GD change
        points[hi] += 1;
        points[ai] += 1;
      } else {
        // Away win: simplified +1/-1 GD
        points[ai] += 3;
        gd[ai] += 1;
        gd[hi] -= 1;
        gf[ai] += 1;
      }
    }

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
