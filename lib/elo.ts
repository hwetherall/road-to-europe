import { Team } from './types';

const HOME_ADV = 65;
const BASE_ELO = 1500;

export function teamElo(team: Team): number {
  const ppg = team.played > 0 ? team.points / team.played : 1.5;
  return BASE_ELO + (ppg - 1.5) * 200;
}

export function eloProb(homeStrength: number, awayStrength: number) {
  const diff = homeStrength + HOME_ADV - awayStrength;
  const expectedHome = 1 / (1 + Math.pow(10, -diff / 400));
  const drawRate = Math.max(0.10, 0.26 - 0.004 * Math.abs(diff / 50));

  const rawHome = Math.max(0.05, expectedHome - drawRate / 2);
  const rawAway = Math.max(0.05, 1 - expectedHome - drawRate / 2);
  const rawDraw = drawRate;

  // Normalise to sum to 1
  const total = rawHome + rawAway + rawDraw;
  return {
    homeWin: rawHome / total,
    draw: rawDraw / total,
    awayWin: rawAway / total,
  };
}
