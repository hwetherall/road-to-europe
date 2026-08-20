import { Fixture } from '../types';

/**
 * A scheduled fixture with no attached probabilities means live-data.ts could not
 * match one of its clubs to the standings, so it fell through without calling
 * eloProb. The engines then default it to 40/25/35, which simulates all 38 of
 * that club's matches as if the opponent were irrelevant — wrong numbers rather
 * than missing ones. Reported once per run rather than thrown, so a match-day
 * page degrades instead of blanking, but it must not pass unremarked.
 */
export function warnUnpricedFixtures(fixtures: Fixture[], where: string): void {
  const unpriced = fixtures.filter(
    (f) => f.status === 'SCHEDULED' && (f.homeWinProb === undefined || f.drawProb === undefined)
  );
  if (unpriced.length === 0) return;
  const sample = unpriced.slice(0, 5).map((f) => `${f.homeTeam}-${f.awayTeam}`).join(', ');
  console.error(
    `[${where}] ${unpriced.length} scheduled fixture(s) have no probabilities and will be ` +
      `simulated at 40/25/35: ${sample}${unpriced.length > 5 ? ', ...' : ''}. ` +
      `Their clubs are probably missing from lib/clubs.ts.`
  );
}
