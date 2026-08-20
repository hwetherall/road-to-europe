import {
  Fixture,
  SimulationResult,
  SensitivityResult,
  PathSearchConfig,
  PathSearchResult,
  CandidatePath,
  FixtureLock,
} from './types';
import { simulateFull } from './server-simulation';
import { LeverageCandidate, pairedLeverageScan } from './leverage/paired-scan';
import { DEFAULT_SENSITIVITY_SIMS, SENSITIVITY_SEED, sensitivityScanDetailed } from './sensitivity';
import { compositePlausibility, filterByPlausibility, deduplicatePaths } from './plausibility';

const MIN_COMPOSITE_PLAUSIBILITY = 0.005; // 0.5%
const MIN_LOCK_IMPROVEMENT_PP = 0.25;
const PLAUSIBILITY_WEIGHT = 0.35;

/** Simulations per greedy step. Ranking work, so cheaper than the main scan. */
const GREEDY_SIMS = 1000;

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
  // Delegated to the shared paired engine. This used to be a second,
  // independent implementation that re-simulated all 380 fixtures once per
  // lock: ~25 s at Matchday 0, on unpaired random draws, with no error bars.
  const scan = sensitivityScanDetailed(
    teams,
    fixtures,
    targetTeam,
    DEFAULT_SENSITIVITY_SIMS,
    targetMetric,
    SENSITIVITY_SEED
  );
  totalSims += DEFAULT_SENSITIVITY_SIMS;
  const sensitivity = scan.ranked;

  // Only fixtures that clear their own measured noise floor are candidates. In
  // August that list can legitimately be short or empty, in which case the
  // greedy search below finds no path rather than optimising against noise.
  const topFixtures = sensitivity.slice(0, 15);

  // ── Step 3: Greedy optimal path ──
  function buildGreedyPath(
    startingLocks: FixtureLock[],
    excludeFixtures: Set<string>,
    maxLocks: number
  ): CandidatePath {
    const locks: FixtureLock[] = [...startingLocks];
    let currentPlausibility = compositePlausibility(locks);

    // One paired scan per step evaluates every candidate next-lock against the
    // same baseline season, replacing a separate 1000-sim run per candidate.
    for (let step = locks.length; step < maxLocks; step++) {
      const candidates: LeverageCandidate[] = [];
      const byId = new Map<string, FixtureLock>();

      for (const sf of topFixtures) {
        if (locks.some((l) => l.fixtureId === sf.fixtureId)) continue;
        if (excludeFixtures.has(sf.fixtureId)) continue;

        for (const result of ['home', 'draw', 'away'] as const) {
          const candidateLock = makeFixtureLock(sf, result, fixtures);
          const testLocks = [...locks, candidateLock];
          if (compositePlausibility(testLocks) < MIN_COMPOSITE_PLAUSIBILITY) continue;
          const id = `${sf.fixtureId}::${result}`;
          byId.set(id, candidateLock);
          candidates.push({
            id,
            locks: testLocks.map((l) => ({ fixtureId: l.fixtureId, result: l.result })),
          });
        }
      }

      if (candidates.length === 0) break;

      const stepScan = pairedLeverageScan({
        teams,
        fixtures,
        targetTeam,
        metric: targetMetric,
        candidates,
        numSims: GREEDY_SIMS,
        seed: SENSITIVITY_SEED,
        baselineLocks: locks.map((l) => ({ fixtureId: l.fixtureId, result: l.result })),
      });
      totalSims += GREEDY_SIMS;

      let bestLock: FixtureLock | null = null;
      let bestImprovement = 0;
      let bestUtility = -Infinity;
      let bestPlausibility = currentPlausibility;

      for (const result of stepScan.results) {
        const candidateLock = byId.get(result.candidateId);
        if (!candidateLock) continue;

        // deltaPp is measured against this scan's own baseline, which already
        // has the committed locks applied. For relegation, lower is better.
        const improvement = minimize ? -result.deltaPp : result.deltaPp;
        if (improvement <= 0) continue;
        // Never chase a gain smaller than its own error bar.
        if (improvement <= result.noiseFloorPp) continue;

        const candidatePlausibility = compositePlausibility([...locks, candidateLock]);
        const utility = improvement * Math.pow(candidatePlausibility, PLAUSIBILITY_WEIGHT);

        if (utility > bestUtility) {
          bestLock = candidateLock;
          bestImprovement = improvement;
          bestUtility = utility;
          bestPlausibility = candidatePlausibility;
        }
      }

      if (!bestLock) break;
      if (bestImprovement < MIN_LOCK_IMPROVEMENT_PP) break;

      locks.push(bestLock);
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
