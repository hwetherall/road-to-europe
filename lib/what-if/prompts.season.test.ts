import { describe, expect, it } from 'vitest';
import { buildTemporalContext } from '@/lib/what-if/prompts';
import { CURRENT_SEASON, PREVIOUS_SEASON, SEASON_START_YEAR } from '@/lib/constants';
import { Fixture, Team } from '@/lib/types';

const teams: Team[] = Array.from({ length: 20 }, (_, i) => ({
  id: String(i),
  name: `Club ${i}`,
  abbr: `T${i}`,
  points: 0,
  goalDifference: 0,
  goalsFor: 0,
  goalsAgainst: 0,
  played: 0,
  won: 0,
  drawn: 0,
  lost: 0,
}));

const fixtures: Fixture[] = [
  {
    id: 'f1',
    homeTeam: 'T0',
    awayTeam: 'T1',
    matchday: 1,
    date: '2026-08-21',
    status: 'SCHEDULED',
    probSource: 'elo_estimated',
  },
];

// buildTemporalContext carries the season-disambiguation block that every
// research agent reads. It is where the stale-season bug lived.
describe('what-if temporal context', () => {
  const text = buildTemporalContext(teams, fixtures);

  it('interpolates every placeholder', () => {
    expect(text.match(/\$\{[^}]*\}/g)).toBeNull();
  });

  it('names the current season, not last season', () => {
    expect(text).toContain(`Current season: ${CURRENT_SEASON}`);
    expect(text).toContain(`The CURRENT season is ${CURRENT_SEASON}`);
    expect(text).toContain(`The PREVIOUS season was ${PREVIOUS_SEASON}`);
    expect(text).not.toMatch(/2024-25/);
  });

  it('derives the transfer-window year from the season, not a hardcoded month', () => {
    expect(text).toContain(`summer ${SEASON_START_YEAR}`);
    expect(text).toContain(`May-August ${SEASON_START_YEAR}`);
    expect(text).not.toMatch(/We are in March/);
  });

  it('no longer asserts a specific club finished in a specific position', () => {
    // The old prompt hardcoded "Nottingham Forest finished 7th in 2024-25".
    expect(text).not.toMatch(/finished \d+(st|nd|rd|th) in/);
  });
});
