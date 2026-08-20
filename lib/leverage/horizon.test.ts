import { describe, expect, it } from 'vitest';
import {
  bestCaseResult,
  buildLeverageWindows,
  nearestRivals,
  selectLeverageUnit,
} from '@/lib/leverage/horizon';
import { pairedLeverageScan } from '@/lib/leverage/paired-scan';
import { eloProb } from '@/lib/elo';
import { Fixture, Team } from '@/lib/types';

const ABBRS = Array.from({ length: 20 }, (_, i) => `T${String(i).padStart(2, '0')}`);
const RATINGS = ABBRS.map((_, i) => 1650 - i * 15);

// Matchday 1 is 21 Aug 2026; one round per week thereafter.
function matchdayDate(matchday: number): string {
  const start = Date.UTC(2026, 7, 21);
  return new Date(start + (matchday - 1) * 7 * 86400000).toISOString();
}

function scenario() {
  const teams: Team[] = ABBRS.map((abbr, i) => ({
    id: abbr, name: abbr, abbr,
    points: 0, goalDifference: -i, goalsFor: 0, goalsAgainst: 0,
    played: 0, won: 0, drawn: 0, lost: 0,
  }));
  const fixtures: Fixture[] = [];
  let n = 0;
  for (let i = 0; i < 20; i++) {
    for (let j = 0; j < 20; j++) {
      if (i === j) continue;
      const matchday = (n % 38) + 1;
      const p = eloProb(RATINGS[i], RATINGS[j]);
      fixtures.push({
        id: `f${n}`, homeTeam: ABBRS[i], awayTeam: ABBRS[j], matchday,
        date: matchdayDate(matchday), status: 'SCHEDULED',
        homeWinProb: p.homeWin, drawProb: p.draw, awayWinProb: p.awayWin,
        probSource: 'odds_api',
      });
      n++;
    }
  }
  return { teams, fixtures };
}

describe('selectLeverageUnit', () => {
  it('scales the unit of analysis with the horizon', () => {
    expect(selectLeverageUnit(38)).toBe('month');
    expect(selectLeverageUnit(26)).toBe('month');
    expect(selectLeverageUnit(25)).toBe('matchday');
    expect(selectLeverageUnit(13)).toBe('matchday');
    expect(selectLeverageUnit(12)).toBe('fixture');
    expect(selectLeverageUnit(1)).toBe('fixture');
  });
});

describe('nearestRivals', () => {
  it('picks the clubs immediately around the target, closest first', () => {
    const { teams } = scenario();
    // All on 0 points, so GD orders them: T00 top, T19 bottom.
    const rivals = nearestRivals(teams, 'T07', 4);
    expect(rivals).toEqual(['T06', 'T08', 'T05', 'T09']);
  });

  it('does not fall off the end of the table', () => {
    const { teams } = scenario();
    expect(nearestRivals(teams, 'T00', 3)).toEqual(['T01', 'T02', 'T03']);
    expect(nearestRivals(teams, 'T19', 3)).toEqual(['T18', 'T17', 'T16']);
  });

  it('returns nothing for a club that is not in the table', () => {
    const { teams } = scenario();
    expect(nearestRivals(teams, 'ZZZ', 3)).toEqual([]);
  });
});

describe('bestCaseResult', () => {
  const rivals = new Set(['R1', 'R2']);
  const fx = (homeTeam: string, awayTeam: string): Fixture => ({
    id: 'x', homeTeam, awayTeam, matchday: 1, date: matchdayDate(1),
    status: 'SCHEDULED', probSource: 'elo_estimated',
  });

  it('wants the target to win its own match', () => {
    expect(bestCaseResult(fx('TGT', 'R1'), 'TGT', rivals)).toBe('home');
    expect(bestCaseResult(fx('R1', 'TGT'), 'TGT', rivals)).toBe('away');
  });

  it('wants a rival to lose', () => {
    expect(bestCaseResult(fx('R1', 'OTH'), 'TGT', rivals)).toBe('away');
    expect(bestCaseResult(fx('OTH', 'R2'), 'TGT', rivals)).toBe('home');
  });

  it('prefers a draw when two rivals meet — two points into the race, not three', () => {
    expect(bestCaseResult(fx('R1', 'R2'), 'TGT', rivals)).toBe('draw');
  });

  it('is indifferent to a match involving neither the target nor a rival', () => {
    expect(bestCaseResult(fx('OTH', 'ANO'), 'TGT', rivals)).toBeNull();
  });
});

describe('buildLeverageWindows', () => {
  it('produces nothing at fixture level — sensitivityScan covers that', () => {
    const { teams, fixtures } = scenario();
    expect(
      buildLeverageWindows({ teams, fixtures, targetTeam: 'T07', unit: 'fixture' })
    ).toEqual([]);
  });

  it('groups into calendar months, in chronological order', () => {
    const { teams, fixtures } = scenario();
    const windows = buildLeverageWindows({ teams, fixtures, targetTeam: 'T07', unit: 'month' });

    expect(windows.length).toBeGreaterThan(3);
    expect(windows[0].label).toBe('August 2026');
    expect(windows[0].unit).toBe('month');
    // Chronological by first matchday in the window.
    const firsts = windows.map((w) => w.matchdays[0]);
    expect([...firsts].sort((a, b) => a - b)).toEqual(firsts);
    // Every bundled fixture involves the target or a close rival.
    for (const w of windows) expect(w.fixtureCount).toBeGreaterThan(0);
  });

  it('groups into matchdays when asked', () => {
    const { teams, fixtures } = scenario();
    const windows = buildLeverageWindows({ teams, fixtures, targetTeam: 'T07', unit: 'matchday' });
    expect(windows[0].label).toBe('Matchday 1');
    expect(windows.every((w) => w.matchdays.length === 1)).toBe(true);
  });

  it('skips fixtures with no usable date rather than inventing a window', () => {
    const { teams, fixtures } = scenario();
    const undated = fixtures.map((f) => ({ ...f, date: '' }));
    expect(
      buildLeverageWindows({ teams, fixtures: undated, targetTeam: 'T07', unit: 'month' })
    ).toEqual([]);
    // Matchday grouping still works without dates.
    expect(
      buildLeverageWindows({ teams, fixtures: undated, targetTeam: 'T07', unit: 'matchday' }).length
    ).toBeGreaterThan(0);
  });

  it('month windows clear the noise floor where single fixtures struggle', () => {
    // The point of the horizon scaling: a cluster carries a signal a single
    // August fixture does not.
    const { teams, fixtures } = scenario();
    const windows = buildLeverageWindows({ teams, fixtures, targetTeam: 'T07', unit: 'month' });

    const scan = pairedLeverageScan({
      teams,
      fixtures,
      targetTeam: 'T07',
      metric: 'top7Pct',
      candidates: windows.map((w) => w.candidate),
      numSims: 4000,
      seed: 20260821,
    });

    const above = scan.results.filter((r) => !r.belowNoiseFloor);
    expect(above.length).toBeGreaterThan(windows.length / 2);
    // Best-case bundles for the target must help the target.
    for (const r of above) expect(r.deltaPp).toBeGreaterThan(0);
  }, 60_000);
});
