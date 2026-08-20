import {
  Fixture,
  SensitivityMetric,
  SensitivityResult,
  SensitivityScanSummary,
  Team,
} from './types';
import { LeverageCandidate, pairedLeverageScan } from './leverage/paired-scan';

/**
 * Fixed seed for every sensitivity run.
 *
 * Baseline and locked worlds must share their random draws, or the difference
 * between them carries the noise of both. Pinning the seed also means the same
 * standings and fixtures always produce the same ranking, so a number a reader
 * saw yesterday does not move on its own overnight.
 */
export const SENSITIVITY_SEED = 20260821;

/**
 * Default simulation count.
 *
 * Chosen against measured cost and resolution on a 380-fixture Matchday 0
 * workload (380 fixtures x 3 outcomes = 1140 paired comparisons):
 *
 *   1,000 sims   ~0.5 s   median noise floor 0.53 pp
 *   5,000 sims   ~2.4 s   median noise floor 0.24 pp
 *  20,000 sims   ~9.7 s   median noise floor 0.12 pp
 *
 * A single fixture is worth roughly 0.2-0.4 pp at 38 rounds remaining, so 1,000
 * sims cannot resolve one at all and 20,000 is too slow to run on the main
 * thread. 5,000 sits at the edge: the strongest fixtures clear their floor and
 * the rest are honestly reported as below it.
 */
export const DEFAULT_SENSITIVITY_SIMS = 5000;

const OUTCOMES = ['home', 'draw', 'away'] as const;

function candidateId(fixtureId: string, outcome: string): string {
  return `${fixtureId}::${outcome}`;
}

/**
 * Per-fixture leverage on `metric` for `targetTeam`, with a measured error bar.
 *
 * Fixtures whose largest swing does not clear their own noise floor are
 * excluded from `ranked` entirely — reporting a difference smaller than its
 * standard error is a category mistake, and the old EPSILON = 1e-9 filter
 * excluded nothing.
 */
export function sensitivityScanDetailed(
  teams: Team[],
  fixtures: Fixture[],
  targetTeam: string,
  numSims: number = DEFAULT_SENSITIVITY_SIMS,
  metric: SensitivityMetric = 'top7Pct',
  seed: number = SENSITIVITY_SEED
): SensitivityScanSummary {
  const scheduled = fixtures.filter((f) => f.status === 'SCHEDULED');

  const candidates: LeverageCandidate[] = scheduled.flatMap((fixture) =>
    OUTCOMES.map((result) => ({
      id: candidateId(fixture.id, result),
      locks: [{ fixtureId: fixture.id, result }],
    }))
  );

  const scan = pairedLeverageScan({
    teams,
    fixtures,
    targetTeam,
    metric,
    candidates,
    numSims,
    seed,
  });

  const byId = new Map(scan.results.map((r) => [r.candidateId, r]));

  const measured: SensitivityResult[] = [];
  for (const fixture of scheduled) {
    const home = byId.get(candidateId(fixture.id, 'home'));
    const draw = byId.get(candidateId(fixture.id, 'draw'));
    const away = byId.get(candidateId(fixture.id, 'away'));
    if (!home || !draw || !away) continue;

    // Rank by the single strongest outcome, and carry that outcome's own error
    // bar — the three outcomes of one fixture do not share a standard error.
    const strongest = [home, draw, away].reduce((a, b) =>
      Math.abs(b.deltaPp) > Math.abs(a.deltaPp) ? b : a
    );

    measured.push({
      fixtureId: fixture.id,
      homeTeam: fixture.homeTeam,
      awayTeam: fixture.awayTeam,
      deltaIfHomeWin: home.deltaPp,
      deltaIfDraw: draw.deltaPp,
      deltaIfAwayWin: away.deltaPp,
      maxAbsDelta: Math.abs(strongest.deltaPp),
      absIfHomeWin: home.lockedPct,
      absIfDraw: draw.lockedPct,
      absIfAwayWin: away.lockedPct,
      absBaseline: scan.baselinePct,
      sePp: strongest.sePp,
      noiseFloorPp: strongest.noiseFloorPp,
      belowNoiseFloor: Math.abs(strongest.deltaPp) <= strongest.noiseFloorPp,
    });
  }

  const ranked = measured
    .filter((r) => !r.belowNoiseFloor)
    .sort((a, b) => b.maxAbsDelta - a.maxAbsDelta);

  const floors = measured.map((r) => r.noiseFloorPp).sort((a, b) => a - b);

  return {
    ranked,
    belowFloorCount: measured.length - ranked.length,
    baselinePct: scan.baselinePct,
    medianNoiseFloorPp: floors.length > 0 ? floors[Math.floor(floors.length / 2)] : 0,
    numSims: scan.numSims,
  };
}

/**
 * Ranked fixtures only. Drop-in replacement for the previous signature —
 * callers that need to distinguish "nothing is above the noise floor" from
 * "no fixtures exist" should use sensitivityScanDetailed instead.
 */
export function sensitivityScan(
  teams: Team[],
  fixtures: Fixture[],
  targetTeam: string,
  numSims: number = DEFAULT_SENSITIVITY_SIMS,
  metric: SensitivityMetric = 'top7Pct',
  seed: number = SENSITIVITY_SEED
): SensitivityResult[] {
  return sensitivityScanDetailed(teams, fixtures, targetTeam, numSims, metric, seed).ranked;
}
