import { describe, expect, it, vi } from 'vitest';
import { generateRemainingFixtures } from '@/lib/fixture-generator';
import { Fixture, Team } from '@/lib/types';

function team(abbr: string, played: number, points: number): Team {
  return {
    id: abbr,
    name: abbr,
    abbr,
    points,
    goalDifference: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    played,
    won: 0,
    drawn: 0,
    lost: 0,
  };
}

const ABBRS = Array.from({ length: 20 }, (_, i) => `T${String(i).padStart(2, '0')}`);

function fullSeason(): Fixture[] {
  const fixtures: Fixture[] = [];
  for (let i = 0; i < ABBRS.length; i++) {
    for (let j = 0; j < ABBRS.length; j++) {
      if (i === j) continue;
      fixtures.push({
        id: `f${fixtures.length}`,
        homeTeam: ABBRS[i],
        awayTeam: ABBRS[j],
        matchday: (fixtures.length % 38) + 1,
        date: '2026-08-21',
        status: 'SCHEDULED',
        probSource: 'elo_estimated',
      });
    }
  }
  return fixtures;
}

describe('generateRemainingFixtures', () => {
  it('generates nothing when the full 380-fixture schedule is published', () => {
    const teams = ABBRS.map((a) => team(a, 0, 0));
    const fixtures = fullSeason();
    expect(fixtures).toHaveLength(380);

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(generateRemainingFixtures(teams, fixtures)).toEqual([]);
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });

  it('continues from the last known matchday instead of hardcoding 32', () => {
    // Mid-season repair case: matchdays 1-7 played, only some of MD8 published.
    const teams = ABBRS.map((a) => team(a, 7, 10));
    const known: Fixture[] = [
      {
        id: 'k1',
        homeTeam: ABBRS[0],
        awayTeam: ABBRS[1],
        matchday: 8,
        date: '2026-10-17',
        status: 'SCHEDULED',
        probSource: 'odds_api',
      },
    ];

    const generated = generateRemainingFixtures(teams, known);
    expect(generated.length).toBeGreaterThan(0);

    const matchdays = generated.map((f) => f.matchday);
    expect(Math.min(...matchdays)).toBe(9);
    // The old bug stamped August fixtures with matchday 32+.
    expect(matchdays.some((m) => m === 32)).toBe(false);
    expect(Math.max(...matchdays)).toBeLessThanOrEqual(38);
  });

  it('never regenerates a fixture that is already known in either direction', () => {
    const teams = ABBRS.map((a) => team(a, 0, 0));
    const known: Fixture[] = [
      {
        id: 'k1',
        homeTeam: ABBRS[0],
        awayTeam: ABBRS[1],
        matchday: 1,
        date: '2026-08-21',
        status: 'SCHEDULED',
        probSource: 'odds_api',
      },
    ];

    const generated = generateRemainingFixtures(teams, known);
    const pairs = generated.map((f) => [f.homeTeam, f.awayTeam].sort().join('-'));
    expect(pairs).not.toContain([ABBRS[0], ABBRS[1]].sort().join('-'));
  });
});
