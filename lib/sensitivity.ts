import { Team, Fixture, SensitivityMetric, SensitivityResult, SimulationResult } from './types';
import { simulate } from './montecarlo';

function lockFixture(
  fixtures: Fixture[],
  fixtureId: string,
  result: 'home' | 'away' | 'draw'
): Fixture[] {
  return fixtures.map((f) => {
    if (f.id !== fixtureId) return f;
    return {
      ...f,
      homeWinProb: result === 'home' ? 1.0 : 0.0,
      drawProb: result === 'draw' ? 1.0 : 0.0,
      awayWinProb: result === 'away' ? 1.0 : 0.0,
    };
  });
}

export function sensitivityScan(
  teams: Team[],
  fixtures: Fixture[],
  targetTeam: string,
  simsPerLock: number = 1000,
  metric: SensitivityMetric = 'top7Pct'
): SensitivityResult[] {
  const EPSILON = 1e-9;
  const scheduledFixtures = fixtures.filter((f) => f.status === 'SCHEDULED');
  const baseline = simulate(teams, fixtures, simsPerLock);
  const baselineValue = getMetricValue(
    baseline.find((r) => r.team === targetTeam),
    metric
  );

  const results: SensitivityResult[] = [];

  for (const fixture of scheduledFixtures) {
    const homeWinResult = simulate(
      teams,
      lockFixture(fixtures, fixture.id, 'home'),
      simsPerLock
    );
    const deltaHome =
      getMetricValue(homeWinResult.find((r) => r.team === targetTeam), metric) -
      baselineValue;

    const awayWinResult = simulate(
      teams,
      lockFixture(fixtures, fixture.id, 'away'),
      simsPerLock
    );
    const deltaAway =
      getMetricValue(awayWinResult.find((r) => r.team === targetTeam), metric) -
      baselineValue;

    const drawResult = simulate(
      teams,
      lockFixture(fixtures, fixture.id, 'draw'),
      simsPerLock
    );
    const deltaDraw =
      getMetricValue(drawResult.find((r) => r.team === targetTeam), metric) -
      baselineValue;

    results.push({
      fixtureId: fixture.id,
      homeTeam: fixture.homeTeam,
      awayTeam: fixture.awayTeam,
      deltaIfHomeWin: deltaHome,
      deltaIfAwayWin: deltaAway,
      deltaIfDraw: deltaDraw,
      maxAbsDelta: Math.max(
        Math.abs(deltaHome),
        Math.abs(deltaAway),
        Math.abs(deltaDraw)
      ),
    });
  }

  return results
    .filter((r) => r.maxAbsDelta > EPSILON)
    .sort((a, b) => b.maxAbsDelta - a.maxAbsDelta);
}

function getMetricValue(
  result: SimulationResult | undefined,
  metric: SensitivityMetric
): number {
  if (!result) return 0;
  return result[metric];
}
