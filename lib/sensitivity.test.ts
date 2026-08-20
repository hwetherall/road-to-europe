import { describe, expect, it } from 'vitest';
import { Fixture, SensitivityMetric, Team } from '@/lib/types';
import { MATERIAL_EFFECT_PP, sensitivityScanDetailed } from '@/lib/sensitivity';

const ABBRS = [
  'ARS', 'MCI', 'MUN', 'AVL', 'CFC', 'LFC', 'BRE', 'FUL', 'EVE', 'BRI',
  'NEW', 'BOU', 'SUN', 'CRY', 'LEE', 'TOT', 'NFO', 'WHU', 'BUR', 'WOL',
];

/**
 * Matchday 0: nothing played, all 380 fixtures scheduled, every club equally
 * strong — which is exactly what lib/elo.ts produces at played === 0 until the
 * preseason priors land. 1,140 comparisons, the largest family the app ever
 * assesses.
 */
function matchdayZero(): { teams: Team[]; fixtures: Fixture[] } {
  const teams: Team[] = ABBRS.map((abbr, i) => ({
    id: String(i + 1), name: abbr, abbr,
    points: 0, goalDifference: 0, goalsFor: 0, goalsAgainst: 0,
    played: 0, won: 0, drawn: 0, lost: 0,
  }));

  const fixtures: Fixture[] = [];
  let n = 0;
  for (const home of ABBRS) {
    for (const away of ABBRS) {
      if (home === away) continue;
      n++;
      fixtures.push({
        id: `f${n}`, homeTeam: home, awayTeam: away,
        matchday: 1 + Math.floor((n - 1) / 10),
        date: '2026-08-21', status: 'SCHEDULED',
        // eloProb(1500, 1500) with the 65-point home advantage, normalised.
        homeWinProb: 0.4318, drawProb: 0.2603, awayWinProb: 0.3079,
        probSource: 'elo_estimated',
      });
    }
  }
  return { teams, fixtures };
}

const TARGET = 'NEW';

describe('sensitivityScanDetailed at Matchday 0', () => {
  it('builds the full 1140-comparison family', () => {
    const { teams, fixtures } = matchdayZero();
    const s = sensitivityScanDetailed(teams, fixtures, TARGET, 2000, 'top7Pct');
    expect(fixtures.length).toBe(380);
    expect(s.comparisonCount).toBe(1140);
    expect(s.materialEffectPp).toBe(MATERIAL_EFFECT_PP);
  });

  /**
   * The point of testing against a relevance null rather than a nil null.
   *
   * The old gate asked "is this distinguishable from zero", which every fixture
   * eventually is: it admitted 315 of 380 fixtures at 5,000 simulations and all
   * 380 at 20,000, so the reported list grew with the compute budget rather than
   * converging. Asking "is this confidently worth more than a percentage point"
   * converges, because it is a question about the league rather than about how
   * long we were willing to simulate.
   */
  it('reports the same fixtures across a 10x range of simulation budgets', () => {
    const { teams, fixtures } = matchdayZero();
    const counts = [2000, 5000, 20000].map(
      (sims) => sensitivityScanDetailed(teams, fixtures, TARGET, sims, 'top7Pct').ranked.length
    );

    // Stable, and nothing like the 315 / 380 a nil-null gate produced.
    for (const count of counts) {
      expect(count).toBeGreaterThan(20);
      expect(count).toBeLessThan(60);
    }
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(2);
  }, 120000);

  /**
   * At 38 rounds remaining, the only fixtures worth a percentage point of the
   * target's own top-7 chances are the ones the target plays in. Every other
   * club's result matters, but not individually — which is precisely the case
   * for the month-level bundles in horizon.ts, and an editorial finding rather
   * than a statistical artefact.
   */
  it('reports only the target own fixtures', () => {
    const { teams, fixtures } = matchdayZero();
    const s = sensitivityScanDetailed(teams, fixtures, TARGET, 5000, 'top7Pct');

    expect(s.ranked.length).toBeGreaterThan(0);
    for (const r of s.ranked) {
      expect(r.homeTeam === TARGET || r.awayTeam === TARGET).toBe(true);
    }
    expect(s.belowFloorCount).toBe(380 - s.ranked.length);
  }, 120000);

  it('keeps the reported set inside the distinguishable-from-zero set', () => {
    const { teams, fixtures } = matchdayZero();
    const s = sensitivityScanDetailed(teams, fixtures, TARGET, 5000, 'top7Pct');
    // With a positive material threshold, |d| - 2se > material implies
    // |d| > 2se, so anything reportable must also clear its own noise floor.
    for (const r of s.ranked) expect(r.belowNoiseFloor).toBe(false);
  }, 120000);

  it('ranks by the shrunk magnitude, descending', () => {
    const { teams, fixtures } = matchdayZero();
    const s = sensitivityScanDetailed(teams, fixtures, TARGET, 5000, 'top7Pct');
    for (let i = 1; i < s.ranked.length; i++) {
      expect(s.ranked[i - 1].shrunkMaxAbsDeltaPp).toBeGreaterThanOrEqual(
        s.ranked[i].shrunkMaxAbsDeltaPp
      );
    }
  }, 120000);

  /**
   * Shrinkage is expected to be nearly inert here, and that is the informative
   * outcome: the spread of real effects (tau ~1.8pp) dwarfs the error bars
   * (~0.06pp), so the ranking is driven by signal rather than by selection. If
   * this weight ever falls materially below 1, the top of the list has become
   * partly an artefact of picking the largest of 1,140 noisy estimates.
   */
  it('records a shrinkage weight, near-inert in this regime', () => {
    const { teams, fixtures } = matchdayZero();
    for (const metric of ['top7Pct', 'championPct'] as SensitivityMetric[]) {
      const s = sensitivityScanDetailed(teams, fixtures, TARGET, 5000, metric);
      expect(s.shrinkageWeight).toBeGreaterThan(0.9);
      expect(s.shrinkageWeight).toBeLessThanOrEqual(1);
      expect(s.tauPp).toBeGreaterThan(0);
    }
  }, 120000);

  it('suppresses everything when the threshold is set absurdly high', () => {
    const { teams, fixtures } = matchdayZero();
    const s = sensitivityScanDetailed(teams, fixtures, TARGET, 2000, 'top7Pct', undefined, 50);
    expect(s.ranked.length).toBe(0);
    expect(s.belowFloorCount).toBe(380);
    expect(s.reportableComparisons).toBe(0);
  }, 120000);
});
