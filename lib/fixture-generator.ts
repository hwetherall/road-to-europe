import { Team, Fixture } from './types';
import { teamElo, eloProb } from './elo';

export function generateRemainingFixtures(teams: Team[], knownFixtures: Fixture[]): Fixture[] {
  const knownSet = new Set(knownFixtures.map((f) => `${f.homeTeam}-${f.awayTeam}`));

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
        matchday: 32 + Math.floor(idCounter / 10),
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
