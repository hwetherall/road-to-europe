import {
  Fixture,
  SimulationResult,
  SensitivityResult,
  PathSearchConfig,
  PathSearchResult,
  CandidatePath,
  FixtureLock,
} from './types';
import { simulateFast, simulateFull } from './server-simulation';
import { compositePlausibility, filterByPlausibility, deduplicatePaths } from './plausibility';

const MIN_COMPOSITE_PLAUSIBILITY = 0.005; // 0.5%
const MIN_LOCK_IMPROVEMENT_PP = 0.25;
const PLAUSIBILITY_WEIGHT = 0.35;

// ── Helpers ──

function applyLocks(fixtures: Fixture[], locks: FixtureLock[]): Fixture[] {
  return fixtures.map((f) => {
    const lock = locks.find((l) => l.fixtureId === f.id);
    if (!lock) return f;
    return {
      ...f,
      homeWinProb: lock.result === 'home' ? 1.0 : 0.0,
      drawProb: lock.result === 'draw' ? 1.0 : 0.0,
      awayWinProb: lock.result === 'away' ? 1.0 : 0.0,
    };
  });
}

function makeFixtureLock(
  sensitivity: SensitivityResult,
  result: 'home' | 'draw' | 'away',
  fixtures: Fixture[]
): FixtureLock {
  const fixture = fixtures.find((f) => f.id === sensitivity.fixtureId);
  const resultLabel =
    result === 'home'
      ? `${sensitivity.homeTeam} win`
      : result === 'away'
        ? `${sensitivity.awayTeam} win`
        : 'Draw';

  const individualPlausibility = fixture
    ? result === 'home'
      ? (fixture.homeWinProb ?? 0.33)
      : result === 'away'
        ? (fixture.awayWinProb ?? 0.33)
        : (fixture.drawProb ?? 0.33)
    : 0.33;

  return {
    fixtureId: sensitivity.fixtureId,
    homeTeam: sensitivity.homeTeam,
    awayTeam: sensitivity.awayTeam,
    result,
    resultLabel,
    individualPlausibility,
  };
}

function buildCandidatePath(
  locks: FixtureLock[],
  resultingOdds: number,
  baselineOdds: number,
  targetTeam: string
): CandidatePath {
  return {
    id: crypto.randomUUID(),
    locks,
    resultingOdds,
    baselineOdds,
    delta: resultingOdds - baselineOdds,
    compositePlausibility: compositePlausibility(locks),
    locksInvolvingTarget: locks.filter(
      (l) => l.homeTeam === targetTeam || l.awayTeam === targetTeam
    ).length,
    locksInvolvingRivals: locks.filter(
      (l) => l.homeTeam !== targetTeam && l.awayTeam !== targetTeam
    ).length,
  };
}

function getMetricValue(result: SimulationResult | undefined, metric: keyof SimulationResult): number {
  if (!result) return 0;
  return result[metric] as number;
}

function getImprovement(
  currentOdds: number,
  candidateOdds: number,
  minimize: boolean
): number {
  return minimize ? currentOdds - candidateOdds : candidateOdds - currentOdds;
}

// ── Main Path Search ──

export function pathSearch(config: PathSearchConfig): PathSearchResult {
  const {
    teams,
    fixtures,
    targetTeam,
    targetMetric,
    maxFixturesToLock,
    branchDepth,
  } = config;

  const startTime = Date.now();
  let totalSims = 0;

  // For relegation, we want to MINIMIZE the metric (lower relegation% is better)
  const minimize = targetMetric === 'relegationPct';

  // ── Step 1: Baseline ──
  const baselineResults = simulateFull(teams, fixtures, 10000);
  totalSims += 10000;
  const baselineOdds = getMetricValue(
    baselineResults.find((r) => r.team === targetTeam),
    targetMetric
  );

  // ── Step 2: Sensitivity scan ──
  const scheduledFixtures = fixtures.filter((f) => f.status === 'SCHEDULED');
  const sensitivity: SensitivityResult[] = [];

  for (const fixture of scheduledFixtures) {
    const deltas: Record<string, number> = {};
    const absVals: Record<string, number> = {};
    for (const result of ['home', 'draw', 'away'] as const) {
      const lock: FixtureLock = {
        fixtureId: fixture.id,
        homeTeam: fixture.homeTeam,
        awayTeam: fixture.awayTeam,
        result,
        resultLabel: '',
        individualPlausibility: 0,
      };
      const locked = applyLocks(fixtures, [lock]);
      const simResult = simulateFast(teams, locked, 1000);
      totalSims += 1000;
      const odds = getMetricValue(
        simResult.find((r) => r.team === targetTeam),
        targetMetric
      );
      deltas[result] = odds - baselineOdds;
      absVals[result] = odds;
    }
    sensitivity.push({
      fixtureId: fixture.id,
      homeTeam: fixture.homeTeam,
      awayTeam: fixture.awayTeam,
      deltaIfHomeWin: deltas.home,
      deltaIfDraw: deltas.draw,
      deltaIfAwayWin: deltas.away,
      maxAbsDelta: Math.max(
        Math.abs(deltas.home),
        Math.abs(deltas.draw),
        Math.abs(deltas.away)
      ),
      absIfHomeWin: absVals.home,
      absIfAwayWin: absVals.away,
      absIfDraw: absVals.draw,
      absBaseline: baselineOdds,
    });
  }
  sensitivity.sort((a, b) => b.maxAbsDelta - a.maxAbsDelta);
  const topFixtures = sensitivity.slice(0, 15);

  // ── Step 3: Greedy optimal path ──
  function buildGreedyPath(
    startingLocks: FixtureLock[],
    excludeFixtures: Set<string>,
    maxLocks: number
  ): CandidatePath {
    const locks: FixtureLock[] = [...startingLocks];
    let currentPlausibility = compositePlausibility(locks);

    const startingFixtures = applyLocks(fixtures, locks);
    const startingResult = simulateFast(teams, startingFixtures, 1000);
    totalSims += 1000;
    let currentOdds = getMetricValue(
      startingResult.find((r) => r.team === targetTeam),
      targetMetric
    );

    for (let step = locks.length; step < maxLocks; step++) {
      let bestLock: FixtureLock | null = null;
      let bestOdds = currentOdds;
      let bestImprovement = 0;
      let bestUtility = -Infinity;
      let bestPlausibility = currentPlausibility;

      for (const sf of topFixtures) {
        if (locks.some((l) => l.fixtureId === sf.fixtureId)) continue;
        if (excludeFixtures.has(sf.fixtureId)) continue;

        for (const result of ['home', 'draw', 'away'] as const) {
          const candidateLock = makeFixtureLock(sf, result, fixtures);
          const testLocks = [...locks, candidateLock];
          const candidatePlausibility = compositePlausibility(testLocks);
          if (candidatePlausibility < MIN_COMPOSITE_PLAUSIBILITY) continue;

          const testFixtures = applyLocks(fixtures, testLocks);
          const simResult = simulateFast(teams, testFixtures, 1000);
          totalSims += 1000;
          const odds = getMetricValue(
            simResult.find((r) => r.team === targetTeam),
            targetMetric
          );
          const improvement = getImprovement(currentOdds, odds, minimize);
          if (improvement <= 0) continue;

          const utility =
            improvement * Math.pow(candidatePlausibility, PLAUSIBILITY_WEIGHT);

          if (utility > bestUtility) {
            bestLock = candidateLock;
            bestOdds = odds;
            bestImprovement = improvement;
            bestUtility = utility;
            bestPlausibility = candidatePlausibility;
          }
        }
      }

      if (!bestLock) break;
      if (bestImprovement < MIN_LOCK_IMPROVEMENT_PP) break;

      locks.push(bestLock);
      currentOdds = bestOdds;
      currentPlausibility = bestPlausibility;

    }

    // Final validation with full 10K sims
    const finalFixtures = applyLocks(fixtures, locks);
    const finalResult = simulateFull(teams, finalFixtures, 10000);
    totalSims += 10000;
    const finalOdds = getMetricValue(
      finalResult.find((r) => r.team === targetTeam),
      targetMetric
    );

    return buildCandidatePath(locks, finalOdds, baselineOdds, targetTeam);
  }

  const optimalPath = buildGreedyPath([], new Set(), maxFixturesToLock);

  // ── Step 4: Branch at decision points ──
  const candidatePaths: CandidatePath[] = [optimalPath];

  for (let i = 0; i < Math.min(branchDepth, optimalPath.locks.length); i++) {
    const lock = optimalPath.locks[i];
    const otherResults = (['home', 'draw', 'away'] as const).filter(
      (r) => r !== lock.result
    );

    for (const altResult of otherResults) {
      const altStartingLocks = [
        ...optimalPath.locks.slice(0, i),
        makeFixtureLock(
          topFixtures.find((f) => f.fixtureId === lock.fixtureId)!,
          altResult,
          fixtures
        ),
      ];

      const altPath = buildGreedyPath(altStartingLocks, new Set(), maxFixturesToLock);
      candidatePaths.push(altPath);
    }
  }

  // ── Step 5: Plausibility filter ──
  const plausiblePaths = filterByPlausibility(candidatePaths)
    .sort((a, b) => b.compositePlausibility - a.compositePlausibility);

  const diversePaths = deduplicatePaths(plausiblePaths);
  const finalPaths = diversePaths.slice(0, 6);

  return {
    config,
    baselineOdds,
    optimalPath,
    candidatePaths: finalPaths,
    sensitivityData: topFixtures,
    searchStats: {
      totalSimulations: totalSims,
      totalPaths: candidatePaths.length,
      pathsFiltered: candidatePaths.length - finalPaths.length,
      searchTimeMs: Date.now() - startTime,
    },
  };
}
