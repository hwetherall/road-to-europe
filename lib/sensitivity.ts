import { Team, Fixture, SensitivityResult } from './types';
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
  simsPerLock: number = 1000
): SensitivityResult[] {
  const scheduledFixtures = fixtures.filter((f) => f.status === 'SCHEDULED');
  const baseline = simulate(teams, fixtures, simsPerLock);
  const baselineTop7 = baseline.find((r) => r.team === targetTeam)?.top7Pct ?? 0;

  const results: SensitivityResult[] = [];

  for (const fixture of scheduledFixtures) {
    const homeWinResult = simulate(
      teams,
      lockFixture(fixtures, fixture.id, 'home'),
      simsPerLock
    );
    const deltaHome =
      (homeWinResult.find((r) => r.team === targetTeam)?.top7Pct ?? 0) - baselineTop7;

    const awayWinResult = simulate(
      teams,
      lockFixture(fixtures, fixture.id, 'away'),
      simsPerLock
    );
    const deltaAway =
      (awayWinResult.find((r) => r.team === targetTeam)?.top7Pct ?? 0) - baselineTop7;

    const drawResult = simulate(
      teams,
      lockFixture(fixtures, fixture.id, 'draw'),
      simsPerLock
    );
    const deltaDraw =
      (drawResult.find((r) => r.team === targetTeam)?.top7Pct ?? 0) - baselineTop7;

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

  return results.sort((a, b) => b.maxAbsDelta - a.maxAbsDelta);
}
