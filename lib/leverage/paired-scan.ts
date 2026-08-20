import { Fixture, SensitivityMetric, Team } from '../types';
import {
  hashRand,
  outcomeSubstream,
  samplePoisson,
  scorelineSubstream,
  simKey,
} from '../sim/rng';
import { GOAL_PARAMS, POINTS_BY_OUTCOME } from '../sim/goals';
import { warnUnpricedFixtures } from '../sim/pricing';

/**
 * Paired leverage scan.
 *
 * The idea: a "locked" world differs from the baseline world in a handful of
 * fixtures and nowhere else. So there is no need to re-simulate all 380
 * fixtures once per lock. Simulate the baseline season once per iteration,
 * then PATCH the locked fixtures and recompute only the target club's rank.
 *
 * Two things fall out of that, both of which the old re-simulate-per-lock scan
 * could not give us:
 *
 *  1. Speed. Measured on a 380-fixture Matchday 0 workload — baseline plus all
 *     1140 fixture x outcome comparisons at 1000 sims: 62,700 ms for the old
 *     scan, 179 ms here. At 20,000 sims this engine takes ~3.4 s, which the
 *     old one could not reach at all.
 *
 *  2. An EXACT standard error. Because both worlds are stepped together, we
 *     observe the per-simulation difference d directly, so SE(delta) =
 *     sd(d)/sqrt(N) is measured rather than assumed. That matters: whether a
 *     given swing is reportable depends entirely on the real error bar, which
 *     varies per fixture and per metric. A single global variance-reduction
 *     constant cannot capture it.
 *
 * CONDITIONING ON THE FIXTURE'S OWN DRAW
 *
 * Pairing alone leaves one avoidable source of variance. If the baseline is
 * the season as drawn, then d = h_locked - h_natural carries the randomness of
 * the locked fixture's OWN outcome draw: locking a home win only moves the
 * needle in the (1 - p_home) of simulations where the fixture did not already
 * come up a home win.
 *
 * That draw can be conditioned away. All three outcomes of the fixture are
 * already patched and rank-scanned, so their hit indicators h_0, h_1, h_2 are
 * in hand; the probability-weighted average
 *
 *     b = p_0*h_0 + p_1*h_1 + p_2*h_2
 *
 * is the conditional expectation of the baseline given the rest of the season.
 * Using it in place of the sampled baseline is Rao-Blackwellisation: unbiased
 * for the same estimand, with variance multiplied by exactly (1 - p_o) — a
 * 1.75x reduction for a coin-flip lock, 4x for a heavy favourite. It is free,
 * because it changes only how the three already-computed indicators are
 * combined.
 *
 * The second benefit is the larger one. The sampled d takes values in
 * {-1, 0, +1} and is nonzero in only `changedShare` of simulations; for
 * championPct at Matchday 0 that share is small enough that the standard error
 * is estimated off a handful of nonzero draws and is itself unreliable. The
 * conditional d is continuous and nonzero in every pivotal simulation, so the
 * error bar behaves for the rare-event metrics too.
 *
 * Applied to single-fixture candidates only: conditioning over a k-fixture
 * bundle would need 3^k evaluations, and the month bundles in horizon.ts hold
 * tens of fixtures. Bundles keep the sampled baseline. See `baselineKind`.
 */

export type LockResult = 'home' | 'draw' | 'away';

export interface LeverageLock {
  fixtureId: string;
  result: LockResult;
}

/**
 * One thing whose leverage we want to measure. A single fixture at
 * fixture-level horizons; a coherent bundle of fixtures at matchday or month
 * level (see horizon.ts).
 */
export interface LeverageCandidate {
  id: string;
  locks: LeverageLock[];
}

export interface PairedDelta {
  candidateId: string;
  /** Change in the metric, in percentage points, versus the baseline. */
  deltaPp: number;
  /** Measured standard error of deltaPp. Not derived from a formula. */
  sePp: number;
  /** Two-sided ~95% reporting threshold: 2 x sePp. */
  noiseFloorPp: number;
  /** True when the delta is not distinguishable from zero at ~95%. */
  belowNoiseFloor: boolean;
  /** The metric's absolute value in the locked world. */
  lockedPct: number;
  /** Share of simulations in which the lock changed the target's outcome. */
  changedShare: number;
  /**
   * How the baseline this delta was measured against was formed.
   *
   * 'conditional' — Rao-Blackwellised: the baseline is the probability-weighted
   * average of all three outcomes of the locked fixture, so the fixture's own
   * outcome draw contributes no variance. Used for single-fixture candidates.
   *
   * 'sampled' — the baseline is the season as drawn, with the fixture at its
   * natural outcome. Used for multi-fixture bundles, where conditioning would
   * cost 3^k evaluations.
   *
   * Both are unbiased for the same quantity; only the variance differs.
   */
  baselineKind: 'conditional' | 'sampled';
}

export interface PairedScanResult {
  baselinePct: number;
  numSims: number;
  results: PairedDelta[];
  /** Candidate ids whose locks matched no scheduled fixture. */
  skippedCandidateIds: string[];
}

const OUTCOME_CODE: Record<LockResult, number> = { home: 0, draw: 1, away: 2 };

/**
 * Every SensitivityMetric is a threshold on final league position, which is
 * what makes the patch-and-rerank shortcut valid: we only need the target's
 * rank, never the whole sorted table.
 */
function metricHit(rank: number, metric: SensitivityMetric, teamCount: number): boolean {
  switch (metric) {
    case 'championPct':
      return rank === 1;
    case 'top4Pct':
      return rank <= 4;
    case 'top5Pct':
      return rank <= 5;
    case 'top6Pct':
      return rank <= 6;
    case 'top7Pct':
      return rank <= 7;
    // Bottom three, matching the existing engines' positionCounts.slice(-3).
    case 'relegationPct':
      return rank > teamCount - 3;
    case 'survivalPct':
      return rank <= teamCount - 3;
  }
}

export function pairedLeverageScan(params: {
  teams: Team[];
  fixtures: Fixture[];
  targetTeam: string;
  metric: SensitivityMetric;
  candidates: LeverageCandidate[];
  numSims: number;
  seed: number;
  /**
   * Fixtures forced in the BASELINE world as well as the locked one, so deltas
   * are measured against an already-constrained season. The greedy path search
   * needs this: at step k it asks "given the k locks I have already committed,
   * which next lock helps most?"
   */
  baselineLocks?: LeverageLock[];
}): PairedScanResult {
  const { teams, fixtures, targetTeam, metric, candidates, numSims, seed } = params;

  const n = teams.length;
  const teamIndex = new Map<string, number>();
  teams.forEach((t, i) => teamIndex.set(t.abbr, i));
  const targetLookup = teamIndex.get(targetTeam);

  if (targetLookup === undefined || n === 0 || numSims <= 0) {
    return {
      baselinePct: 0,
      numSims: 0,
      results: [],
      skippedCandidateIds: candidates.map((c) => c.id),
    };
  }
  const target = targetLookup;

  // ── Flatten the scheduled fixtures into typed arrays for the hot loop ──
  const scheduled = fixtures.filter(
    (f) =>
      f.status === 'SCHEDULED' &&
      teamIndex.has(f.homeTeam) &&
      teamIndex.has(f.awayTeam)
  );
  const fixtureCount = scheduled.length;

  warnUnpricedFixtures(scheduled, 'paired-scan');

  const homeIdx = new Int32Array(fixtureCount);
  const awayIdx = new Int32Array(fixtureCount);
  const homeProb = new Float64Array(fixtureCount);
  const drawProb = new Float64Array(fixtureCount);
  const positionOfFixture = new Map<string, number>();

  scheduled.forEach((f, j) => {
    homeIdx[j] = teamIndex.get(f.homeTeam) as number;
    awayIdx[j] = teamIndex.get(f.awayTeam) as number;
    homeProb[j] = f.homeWinProb ?? 0.4;
    drawProb[j] = f.drawProb ?? 0.25;
    positionOfFixture.set(f.id, j);
  });

  // Forcing a baseline lock is just a probability override: the outcome draw
  // then always lands on that result, and its scoreline still comes from the
  // same substream it would have used naturally, which is what keeps the
  // baseline and candidate worlds paired.
  for (const lock of params.baselineLocks ?? []) {
    const j = positionOfFixture.get(lock.fixtureId);
    if (j === undefined) continue;
    const outcome = OUTCOME_CODE[lock.result];
    homeProb[j] = outcome === 0 ? 1 : 0;
    drawProb[j] = outcome === 1 ? 1 : 0;
  }

  // ── Resolve candidate locks to fixture positions, dropping unknown ids ──
  const skippedCandidateIds: string[] = [];
  const live: Array<{ id: string; fixtures: Int32Array; outcomes: Int8Array }> = [];

  for (const candidate of candidates) {
    const seen = new Set<number>();
    const js: number[] = [];
    const os: number[] = [];
    for (const lock of candidate.locks) {
      const j = positionOfFixture.get(lock.fixtureId);
      // A repeated lock on one fixture is a caller error; first one wins.
      if (j === undefined || seen.has(j)) continue;
      seen.add(j);
      js.push(j);
      os.push(OUTCOME_CODE[lock.result]);
    }
    if (js.length === 0) {
      skippedCandidateIds.push(candidate.id);
      continue;
    }
    live.push({ id: candidate.id, fixtures: Int32Array.from(js), outcomes: Int8Array.from(os) });
  }

  const candidateCount = live.length;
  const sumDelta = new Float64Array(candidateCount);
  const sumDeltaSq = new Float64Array(candidateCount);
  const sumLocked = new Float64Array(candidateCount);
  // Counted separately from sumDeltaSq: with a conditional baseline the delta
  // is continuous, so E[d^2] no longer equals the share of simulations in which
  // the lock flipped the target's outcome. changedShare must keep meaning that.
  const changedCount = new Float64Array(candidateCount);
  let baselineHits = 0;

  // ── Split candidates by whether the baseline can be conditioned ──
  //
  // Single-fixture candidates are grouped by fixture: one group evaluates all
  // three outcomes of that fixture once, which is the same work the three
  // separate candidates cost before, and yields both the conditional baseline
  // and each outcome's own delta.
  // Flattened to typed arrays rather than a Map of object arrays: this is read
  // numSims x fixtureCount times, and object property access in that loop cost
  // more than the conditioning saved.
  const grouped = new Map<number, number[]>();
  const bundles: number[] = [];

  live.forEach((candidate, index) => {
    if (candidate.fixtures.length === 1) {
      const j = candidate.fixtures[0];
      const group = grouped.get(j);
      if (group) group.push(index);
      else grouped.set(j, [index]);
    } else {
      bundles.push(index);
    }
  });

  const groupCount = grouped.size;
  const groupFixture = new Int32Array(groupCount);
  const groupStart = new Int32Array(groupCount + 1);
  const entryCandidate = new Int32Array(candidateCount);
  const entryOutcome = new Int8Array(candidateCount);
  const bundleIndices = Int32Array.from(bundles);

  {
    let g = 0;
    let e = 0;
    for (const [j, indices] of grouped) {
      groupFixture[g] = j;
      groupStart[g] = e;
      for (const index of indices) {
        entryCandidate[e] = index;
        entryOutcome[e] = live[index].outcomes[0];
        e++;
      }
      g++;
    }
    groupStart[groupCount] = e;
  }

  // ── Per-simulation state, allocated once ──
  const points = new Float64Array(n);
  const goalDiff = new Float64Array(n);
  const goalsFor = new Float64Array(n);

  const baseOutcome = new Int8Array(fixtureCount);
  const baseHome = new Int16Array(fixtureCount);
  const baseAway = new Int16Array(fixtureCount);

  const maxLocks = live.reduce((m, c) => Math.max(m, c.fixtures.length), 0);
  const patchHome = new Int16Array(maxLocks);
  const patchAway = new Int16Array(maxLocks);

  /** Metric hit under each of a single fixture's three outcomes. */
  const outcomeHit = new Int8Array(3);

  // Scoreline draw writes into these rather than allocating a tuple per call —
  // this runs tens of millions of times.
  let drawnHome = 0;
  let drawnAway = 0;

  function drawScoreline(sim: number, j: number, outcome: number): void {
    const substream = scorelineSubstream(j, outcome);
    let draw = 0;
    const next = () => hashRand(sim, substream, draw++);

    if (outcome === 1) {
      // Draw: one Poisson sample, mirrored, so the scoreline is level.
      const goals = samplePoisson(GOAL_PARAMS.draw.home, next);
      drawnHome = goals;
      drawnAway = goals;
      return;
    }

    const params = outcome === 0 ? GOAL_PARAMS.homeWin : GOAL_PARAMS.awayWin;
    let home = samplePoisson(params.home, next);
    let away = samplePoisson(params.away, next);
    if (outcome === 0) {
      if (home <= away) home = away + 1;
    } else if (away <= home) {
      away = home + 1;
    }
    drawnHome = home;
    drawnAway = away;
  }

  function applyFixture(j: number, outcome: number, home: number, away: number, sign: number): void {
    const hi = homeIdx[j];
    const ai = awayIdx[j];
    points[hi] += sign * POINTS_BY_OUTCOME[outcome][0];
    points[ai] += sign * POINTS_BY_OUTCOME[outcome][1];
    const margin = home - away;
    goalDiff[hi] += sign * margin;
    goalDiff[ai] -= sign * margin;
    goalsFor[hi] += sign * home;
    goalsFor[ai] += sign * away;
  }

  /** 1-based rank of the target: how many clubs finish strictly above it. */
  function targetRank(): number {
    const p = points[target];
    const g = goalDiff[target];
    const f = goalsFor[target];
    let above = 0;
    for (let i = 0; i < n; i++) {
      if (i === target) continue;
      if (
        points[i] > p ||
        (points[i] === p && (goalDiff[i] > g || (goalDiff[i] === g && goalsFor[i] > f)))
      ) {
        above++;
      }
    }
    return above + 1;
  }

  for (let s = 0; s < numSims; s++) {
    const sim = simKey(seed, s);

    for (let i = 0; i < n; i++) {
      points[i] = teams[i].points;
      goalDiff[i] = teams[i].goalDifference;
      goalsFor[i] = teams[i].goalsFor;
    }

    // ── The baseline season, once ──
    for (let j = 0; j < fixtureCount; j++) {
      const r = hashRand(sim, outcomeSubstream(j), 0);
      const h = homeProb[j];
      const outcome = r < h ? 0 : r < h + drawProb[j] ? 1 : 2;
      drawScoreline(sim, j, outcome);
      baseOutcome[j] = outcome;
      baseHome[j] = drawnHome;
      baseAway[j] = drawnAway;
      applyFixture(j, outcome, drawnHome, drawnAway, 1);
    }

    const baselineHit = metricHit(targetRank(), metric, n) ? 1 : 0;
    baselineHits += baselineHit;

    // ── Single-fixture candidates: all three outcomes, conditional baseline ──
    //
    // The baseline contribution of fixture j is removed once, each outcome is
    // applied in turn and scanned, and the fixture is then restored. Three rank
    // scans per fixture — the same count the three separate candidates cost
    // before — but they now also yield the conditional baseline b.
    for (let gi = 0; gi < groupCount; gi++) {
      const j = groupFixture[gi];

      applyFixture(j, baseOutcome[j], baseHome[j], baseAway[j], -1);

      for (let o = 0; o < 3; o++) {
        if (o === baseOutcome[j]) {
          // Reuse the baseline's own scoreline for the outcome it drew, which is
          // what keeps the worlds paired rather than merely seeded.
          drawnHome = baseHome[j];
          drawnAway = baseAway[j];
        } else {
          drawScoreline(sim, j, o);
        }
        applyFixture(j, o, drawnHome, drawnAway, 1);
        outcomeHit[o] = metricHit(targetRank(), metric, n) ? 1 : 0;
        applyFixture(j, o, drawnHome, drawnAway, -1);
      }

      applyFixture(j, baseOutcome[j], baseHome[j], baseAway[j], 1);

      // The outcome draw uses r < homeProb ? 0 : r < homeProb + drawProb ? 1 : 2,
      // so the away probability is whatever is left. Clamped because the inputs
      // are bookmaker-derived and need not sum to exactly one.
      const pHome = homeProb[j];
      const pDraw = drawProb[j];
      const pAway = Math.max(0, 1 - pHome - pDraw);
      const b = pHome * outcomeHit[0] + pDraw * outcomeHit[1] + pAway * outcomeHit[2];

      const end = groupStart[gi + 1];
      for (let e = groupStart[gi]; e < end; e++) {
        const index = entryCandidate[e];
        const hit = outcomeHit[entryOutcome[e]];
        const d = hit - b;
        sumLocked[index] += hit;
        sumDelta[index] += d;
        sumDeltaSq[index] += d * d;
        if (hit !== baselineHit) changedCount[index] += 1;
      }
    }

    // ── Multi-fixture bundles: sampled baseline, as before ──
    for (let bi = 0; bi < bundleIndices.length; bi++) {
      const c = bundleIndices[bi];
      const { fixtures: js, outcomes: os } = live[c];
      const lockCount = js.length;

      for (let k = 0; k < lockCount; k++) {
        const j = js[k];
        const outcome = os[k];
        applyFixture(j, baseOutcome[j], baseHome[j], baseAway[j], -1);
        if (outcome === baseOutcome[j]) {
          // Same outcome the baseline drew: reuse the identical scoreline, which
          // is what keeps the two worlds paired instead of merely seeded.
          drawnHome = baseHome[j];
          drawnAway = baseAway[j];
        } else {
          drawScoreline(sim, j, outcome);
        }
        patchHome[k] = drawnHome;
        patchAway[k] = drawnAway;
        applyFixture(j, outcome, drawnHome, drawnAway, 1);
      }

      const lockedHit = metricHit(targetRank(), metric, n) ? 1 : 0;
      sumLocked[c] += lockedHit;
      const d = lockedHit - baselineHit;
      sumDelta[c] += d;
      sumDeltaSq[c] += d * d;
      if (d !== 0) changedCount[c] += 1;

      for (let k = lockCount - 1; k >= 0; k--) {
        const j = js[k];
        applyFixture(j, os[k], patchHome[k], patchAway[k], -1);
        applyFixture(j, baseOutcome[j], baseHome[j], baseAway[j], 1);
      }
    }
  }

  const results: PairedDelta[] = live.map((candidate, c) => {
    const meanD = sumDelta[c] / numSims;
    const variance =
      numSims > 1
        ? ((sumDeltaSq[c] / numSims - meanD * meanD) * numSims) / (numSims - 1)
        : 0;
    const sePp = Math.sqrt(Math.max(0, variance) / numSims) * 100;
    const deltaPp = meanD * 100;
    const noiseFloorPp = 2 * sePp;
    return {
      candidateId: candidate.id,
      deltaPp,
      sePp,
      noiseFloorPp,
      belowNoiseFloor: Math.abs(deltaPp) <= noiseFloorPp,
      lockedPct: (sumLocked[c] / numSims) * 100,
      changedShare: changedCount[c] / numSims,
      baselineKind: candidate.fixtures.length === 1 ? 'conditional' : 'sampled',
    };
  });

  return {
    baselinePct: (baselineHits / numSims) * 100,
    numSims,
    results,
    skippedCandidateIds,
  };
}
