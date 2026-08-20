import {
  Fixture,
  SensitivityMetric,
  SensitivityResult,
  SensitivityScanSummary,
  Team,
} from './types';
import { LeverageCandidate, pairedLeverageScan } from './leverage/paired-scan';
import { assessFloor } from './leverage/floor';

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
 * Measured on a 380-fixture Matchday 0 workload (380 fixtures x 3 outcomes =
 * 1140 paired comparisons), with the conditional baseline in paired-scan.ts:
 *
 *   5,000 sims   ~1.5 s   median noise floor 0.126 pp
 *  20,000 sims   ~6.2 s   median noise floor 0.062 pp
 *
 * 20,000 is affordable off the main thread but not on it. 5,000 is the ceiling
 * for a click-to-interactive path, and at 0.126pp its resolution is no longer
 * the binding constraint on what gets reported — the material-effect threshold
 * below is. That is the intended state: the simulation budget should stop being
 * what decides which fixtures a reader sees.
 */
export const DEFAULT_SENSITIVITY_SIMS = 5000;

/**
 * The smallest swing worth showing a reader, in percentage points.
 *
 * EDITORIAL, NOT STATISTICAL. With 5,000 simulations the measured error bar is
 * ~0.15pp, so a 0.3pp swing is comfortably resolvable — and still not a story.
 * Testing against zero instead would report almost every fixture in the league,
 * which is a list nobody can read and which implies a precision about
 * *importance* that the model does not have.
 *
 * This threshold is what the scan tests against (see lib/leverage/floor.ts), and
 * it is stated in the UI, because a fixture being hidden should be explained by
 * a rule the reader can see rather than by an invisible one.
 *
 * MEASURED, and robust. Re-run against the real preseason priors (Matchday 0,
 * 380 fixtures, target NEW, top7Pct, 5,000 sims) the delta distribution turns out
 * to be sharply bimodal:
 *
 *   Newcastle's own 38 fixtures   5.56 - 8.63 pp   (median 6.68)
 *   the other 300 fixtures        0.04 - 0.62 pp   (median 0.25)
 *
 * Nothing at all falls between 0.62 and 5.56pp. So every threshold from ~0.7 to
 * ~5.5pp returns the same 38 fixtures, and this constant is not a knife-edge
 * judgement — 1.0pp sits in the middle of an empty region. Below the gap the
 * answer does change: 0.25pp admits 49 fixtures, the extra 11 being rivals'
 * matches worth a quarter of a point each.
 *
 * The bimodality is the real finding. At 38 rounds remaining a club's own results
 * dominate its fate by an order of magnitude over any single other result, and no
 * amount of extra simulation changes that. It is also the measured case for the
 * month-level bundles in leverage/horizon.ts: other clubs' results matter in
 * aggregate, never individually.
 */
export const MATERIAL_EFFECT_PP = 1.0;

const OUTCOMES = ['home', 'draw', 'away'] as const;

function candidateId(fixtureId: string, outcome: string): string {
  return `${fixtureId}::${outcome}`;
}

/**
 * Per-fixture leverage on `metric` for `targetTeam`, with a measured error bar.
 *
 * `ranked` holds only the fixtures worth reporting: those confidently worth more
 * than `materialEffectPp`, after controlling the false discovery rate across
 * every comparison in the scan. Reported magnitudes are shrunk toward zero,
 * because the top of a ranking over ~1,140 estimates is selected on noise as
 * well as signal. See lib/leverage/floor.ts for why that replaced a plain
 * two-sigma gate against zero.
 *
 * `belowNoiseFloor` is retained per fixture — the greedy path search and the
 * horizon windows still need "is this distinguishable from zero at all" — but it
 * is no longer what decides whether a reader sees a fixture.
 */
export function sensitivityScanDetailed(
  teams: Team[],
  fixtures: Fixture[],
  targetTeam: string,
  numSims: number = DEFAULT_SENSITIVITY_SIMS,
  metric: SensitivityMetric = 'top7Pct',
  seed: number = SENSITIVITY_SEED,
  materialEffectPp: number = MATERIAL_EFFECT_PP
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

  // Assess the WHOLE family at once — every fixture x outcome comparison, not
  // the per-fixture maxima. The chart shows all three outcomes of every listed
  // fixture, so all three are claims, and the multiplicity correction has to be
  // over the set of claims actually made.
  const assessment = assessFloor(
    scan.results.map((r) => ({ deltaPp: r.deltaPp, sePp: r.sePp })),
    materialEffectPp
  );
  const verdictById = new Map(
    scan.results.map((r, i) => [r.candidateId, assessment.verdicts[i]])
  );

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

    // A fixture is worth showing if ANY of its three outcomes is, since the
    // fixture is the unit the reader sees. The shrunk magnitude used for ranking
    // comes from the strongest outcome, which is also the one whose error bar is
    // reported, so the two stay consistent.
    const verdicts = [home, draw, away].map((r) => verdictById.get(r.candidateId));
    const strongestVerdict = verdictById.get(strongest.candidateId);

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
      shrunkMaxAbsDeltaPp: Math.abs(strongestVerdict?.shrunkDeltaPp ?? strongest.deltaPp),
      reportable: verdicts.some((v) => v?.reportable === true),
    });
  }

  const ranked = measured
    .filter((r) => r.reportable)
    .sort((a, b) => b.shrunkMaxAbsDeltaPp - a.shrunkMaxAbsDeltaPp);

  const floors = measured.map((r) => r.noiseFloorPp).sort((a, b) => a - b);

  return {
    ranked,
    belowFloorCount: measured.length - ranked.length,
    baselinePct: scan.baselinePct,
    medianNoiseFloorPp: floors.length > 0 ? floors[Math.floor(floors.length / 2)] : 0,
    numSims: scan.numSims,
    materialEffectPp: assessment.materialEffectPp,
    reportableComparisons: assessment.reportableCount,
    comparisonCount: assessment.comparisonCount,
    shrinkageWeight: assessment.shrinkageWeight,
    tauPp: assessment.tauPp,
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
  seed: number = SENSITIVITY_SEED,
  materialEffectPp: number = MATERIAL_EFFECT_PP
): SensitivityResult[] {
  return sensitivityScanDetailed(
    teams,
    fixtures,
    targetTeam,
    numSims,
    metric,
    seed,
    materialEffectPp
  ).ranked;
}
