import { describe, expect, it } from 'vitest';
import { pairedLeverageScan, LeverageCandidate } from '@/lib/leverage/paired-scan';
import { simulate } from '@/lib/montecarlo';
import { eloProb } from '@/lib/elo';
import { Fixture, SensitivityMetric, Team } from '@/lib/types';

// A 20-club league with a realistic strength spread, so per-fixture
// probabilities vary the way live bookmaker odds do rather than being uniform.
const ABBRS = Array.from({ length: 20 }, (_, i) => `T${String(i).padStart(2, '0')}`);
const RATINGS = ABBRS.map((_, i) => 1650 - i * 15); // 1650 down to 1365

function buildScenario(matchdaysPlayed: number): { teams: Team[]; fixtures: Fixture[] } {
  const teams: Team[] = ABBRS.map((abbr, i) => ({
    id: abbr,
    name: abbr,
    abbr,
    // Stronger clubs have banked more points, proportional to matches played.
    points: Math.round(matchdaysPlayed * (2.2 - i * 0.07)),
    goalDifference: Math.round(matchdaysPlayed * (1.1 - i * 0.11)),
    goalsFor: Math.round(matchdaysPlayed * (1.8 - i * 0.04)),
    goalsAgainst: 0,
    played: matchdaysPlayed,
    won: 0,
    drawn: 0,
    lost: 0,
  }));

  const fixtures: Fixture[] = [];
  let n = 0;
  for (let i = 0; i < 20; i++) {
    for (let j = 0; j < 20; j++) {
      if (i === j) continue;
      const matchday = (n % 38) + 1;
      const probs = eloProb(RATINGS[i], RATINGS[j]);
      fixtures.push({
        id: `f${n}`,
        homeTeam: ABBRS[i],
        awayTeam: ABBRS[j],
        matchday,
        date: '2026-08-21',
        // Treat the first `matchdaysPlayed` rounds as already played.
        status: matchday <= matchdaysPlayed ? 'FINISHED' : 'SCHEDULED',
        homeWinProb: probs.homeWin,
        drawProb: probs.draw,
        awayWinProb: probs.awayWin,
        probSource: 'odds_api',
      });
      n++;
    }
  }
  return { teams, fixtures };
}

const METRIC: SensitivityMetric = 'top7Pct';
const TARGET = 'T07';

function singleFixtureCandidates(fixtures: Fixture[], limit: number): LeverageCandidate[] {
  const scheduled = fixtures.filter((f) => f.status === 'SCHEDULED').slice(0, limit);
  return scheduled.flatMap((f) =>
    (['home', 'draw', 'away'] as const).map((result) => ({
      id: `${f.id}:${result}`,
      locks: [{ fixtureId: f.id, result }],
    }))
  );
}

describe('pairedLeverageScan', () => {
  it("baseline matches the existing engine's own metric within Monte Carlo error", () => {
    // This is the load-bearing correctness check: it validates the whole
    // patched season path — outcome probabilities, Poisson scorelines, EPL
    // tiebreakers and ranking — against the engine already in production.
    const { teams, fixtures } = buildScenario(0);
    const N = 20000;

    const reference = simulate(teams, fixtures, N).find((r) => r.team === TARGET);
    expect(reference).toBeDefined();

    const paired = pairedLeverageScan({
      teams,
      fixtures,
      targetTeam: TARGET,
      metric: METRIC,
      candidates: [],
      numSims: N,
      seed: 991,
    });

    const p = (reference as { top7Pct: number }).top7Pct / 100;
    // Independent estimates, so the difference carries both errors.
    const tolerancePp = 4 * Math.sqrt((2 * p * (1 - p)) / N) * 100;
    expect(Math.abs(paired.baselinePct - (reference as { top7Pct: number }).top7Pct)).toBeLessThan(
      tolerancePp
    );
  }, 30_000);

  it('reports a standard error that matches the observed spread of the delta', () => {
    const { teams, fixtures } = buildScenario(0);
    const candidate: LeverageCandidate[] = [
      { id: 'lock', locks: [{ fixtureId: 'f7', result: 'home' }] },
    ];

    const TRIALS = 16;
    const N = 4000;
    const deltas: number[] = [];
    const reportedSes: number[] = [];

    for (let t = 0; t < TRIALS; t++) {
      const out = pairedLeverageScan({
        teams,
        fixtures,
        targetTeam: TARGET,
        metric: METRIC,
        candidates: candidate,
        numSims: N,
        seed: 1_000_000 * (t + 1),
      });
      deltas.push(out.results[0].deltaPp);
      reportedSes.push(out.results[0].sePp);
    }

    const mean = deltas.reduce((a, b) => a + b, 0) / TRIALS;
    const observedSd = Math.sqrt(
      deltas.reduce((s, v) => s + (v - mean) ** 2, 0) / (TRIALS - 1)
    );
    const reportedSe = reportedSes.reduce((a, b) => a + b, 0) / TRIALS;

    // The estimate of an SD from 16 samples is itself noisy (relative error
    // ~1/sqrt(2*15) = 18%), so allow a factor of 2 either way. The point is
    // that the reported SE tracks reality, not that it is exact.
    expect(reportedSe).toBeGreaterThan(observedSd / 2);
    expect(reportedSe).toBeLessThan(observedSd * 2);
  }, 30_000);

  it('is deterministic for a given seed and varies with the seed', () => {
    const { teams, fixtures } = buildScenario(0);
    const candidates = singleFixtureCandidates(fixtures, 4);
    const args = {
      teams,
      fixtures,
      targetTeam: TARGET,
      metric: METRIC,
      candidates,
      numSims: 500,
    };

    const a = pairedLeverageScan({ ...args, seed: 42 });
    const b = pairedLeverageScan({ ...args, seed: 42 });
    const c = pairedLeverageScan({ ...args, seed: 43 });

    expect(a.results.map((r) => r.deltaPp)).toEqual(b.results.map((r) => r.deltaPp));
    expect(a.results.map((r) => r.deltaPp)).not.toEqual(c.results.map((r) => r.deltaPp));
  });

  it('orders the three outcomes of the target own fixture sensibly', () => {
    // Locking the target to win its own match must not be worse for the
    // target than locking it to lose. A sign error would show up here.
    const { teams, fixtures } = buildScenario(0);
    const own = fixtures.find(
      (f) => f.status === 'SCHEDULED' && f.homeTeam === TARGET
    ) as Fixture;

    const out = pairedLeverageScan({
      teams,
      fixtures,
      targetTeam: TARGET,
      metric: METRIC,
      candidates: [
        { id: 'win', locks: [{ fixtureId: own.id, result: 'home' }] },
        { id: 'lose', locks: [{ fixtureId: own.id, result: 'away' }] },
      ],
      numSims: 20000,
      seed: 7,
    });

    const win = out.results.find((r) => r.candidateId === 'win') as { deltaPp: number };
    const lose = out.results.find((r) => r.candidateId === 'lose') as { deltaPp: number };
    expect(win.deltaPp).toBeGreaterThan(lose.deltaPp);
    expect(win.deltaPp).toBeGreaterThan(0);
    expect(lose.deltaPp).toBeLessThan(0);
  }, 20_000);

  it('reports candidates whose fixtures do not exist rather than silently dropping them', () => {
    const { teams, fixtures } = buildScenario(0);
    const out = pairedLeverageScan({
      teams,
      fixtures,
      targetTeam: TARGET,
      metric: METRIC,
      candidates: [
        { id: 'ghost', locks: [{ fixtureId: 'does-not-exist', result: 'home' }] },
        { id: 'real', locks: [{ fixtureId: 'f7', result: 'home' }] },
      ],
      numSims: 200,
      seed: 5,
    });

    expect(out.skippedCandidateIds).toEqual(['ghost']);
    expect(out.results.map((r) => r.candidateId)).toEqual(['real']);
  });

  it('bundles a multi-fixture lock into one aggregate swing', () => {
    const { teams, fixtures } = buildScenario(0);
    const own = fixtures
      .filter((f) => f.status === 'SCHEDULED' && (f.homeTeam === TARGET || f.awayTeam === TARGET))
      .slice(0, 5);

    const bundleLocks = own.map((f) => ({
      fixtureId: f.id,
      result: (f.homeTeam === TARGET ? 'home' : 'away') as 'home' | 'away',
    }));

    const out = pairedLeverageScan({
      teams,
      fixtures,
      targetTeam: TARGET,
      metric: METRIC,
      candidates: [
        { id: 'bundle', locks: bundleLocks },
        { id: 'single', locks: [bundleLocks[0]] },
      ],
      numSims: 20000,
      seed: 11,
    });

    const bundle = out.results.find((r) => r.candidateId === 'bundle') as { deltaPp: number };
    const single = out.results.find((r) => r.candidateId === 'single') as { deltaPp: number };
    // Five wins must move the needle more than one of the same wins.
    expect(bundle.deltaPp).toBeGreaterThan(single.deltaPp);
  }, 20_000);
});
