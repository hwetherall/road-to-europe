import { Team, Fixture } from './types';
import { NUM_TEAMS } from './constants';
import { teamElo, eloProb } from './elo';

/** A complete double round-robin: 20 * 19 = 380 fixtures. */
const FULL_SEASON_FIXTURES = NUM_TEAMS * (NUM_TEAMS - 1);

/**
 * Synthesise the fixtures football-data.org didn't give us.
 *
 * This is a repair path for an incomplete schedule, not a normal one. Once the
 * full 380-fixture list is published — which it is from season start onwards —
 * this must generate nothing.
 */
export function generateRemainingFixtures(teams: Team[], knownFixtures: Fixture[]): Fixture[] {
  if (knownFixtures.length >= FULL_SEASON_FIXTURES) {
    // The expected path at season start. Generating here would invent duplicate
    // fixtures and stamp them with an out-of-range matchday.
    console.log(
      `[fixture-generator] ${knownFixtures.length} fixtures known (>= ${FULL_SEASON_FIXTURES}); generating none.`
    );
    return [];
  }

  // Track both home-away AND away-home directions so we don't regenerate
  // a fixture that's already known regardless of which side was home
  const knownSet = new Set<string>();
  for (const f of knownFixtures) {
    knownSet.add(`${f.homeTeam}-${f.awayTeam}`);
  }

  const gamesNeeded: Record<string, number> = {};
  teams.forEach((t) => {
    gamesNeeded[t.abbr] = 38 - t.played;
  });

  // Subtract known fixtures
  knownFixtures.forEach((f) => {
    if (gamesNeeded[f.homeTeam] > 0) gamesNeeded[f.homeTeam]--;
    if (gamesNeeded[f.awayTeam] > 0) gamesNeeded[f.awayTeam]--;
  });

  const eloRatings: Record<string, number> = {};
  teams.forEach((t) => {
    eloRatings[t.abbr] = teamElo(t);
  });

  const generated: Fixture[] = [];
  const abbrs = teams.map((t) => t.abbr);
  let idCounter = 0;

  // Continue from the last known matchday rather than assuming we're in March.
  const baseMatchday = Math.max(...knownFixtures.map((f) => f.matchday), 0) + 1;

  // Use a seeded-ish approach: deterministic pairing, random home/away
  for (let i = 0; i < abbrs.length; i++) {
    for (let j = i + 1; j < abbrs.length; j++) {
      const a = abbrs[i];
      const b = abbrs[j];
      if (knownSet.has(`${a}-${b}`) || knownSet.has(`${b}-${a}`)) continue;
      if (gamesNeeded[a] <= 0 || gamesNeeded[b] <= 0) continue;

      // Alternate home/away based on index parity for determinism
      const home = (i + j) % 2 === 0 ? a : b;
      const away = home === a ? b : a;

      const prob = eloProb(eloRatings[home], eloRatings[away]);

      idCounter++;
      generated.push({
        id: `gen-${idCounter}`,
        homeTeam: home,
        awayTeam: away,
        matchday: baseMatchday + Math.floor(idCounter / 10),
        date: '',
        status: 'SCHEDULED',
        homeWinProb: prob.homeWin,
        drawProb: prob.draw,
        awayWinProb: prob.awayWin,
        probSource: 'elo_estimated',
      });

      gamesNeeded[home]--;
      gamesNeeded[away]--;
    }
  }

  return generated;
}
