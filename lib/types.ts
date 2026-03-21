export interface Team {
  id: string;
  name: string;
  abbr: string;
  points: number;
  goalDifference: number;
  goalsFor: number;
  goalsAgainst: number;
  played: number;
  won: number;
  drawn: number;
  lost: number;
}

export interface Fixture {
  id: string;
  homeTeam: string;
  awayTeam: string;
  matchday: number;
  date: string;
  status: 'FINISHED' | 'SCHEDULED' | 'LIVE';
  homeScore?: number;
  awayScore?: number;
  homeWinProb?: number;
  drawProb?: number;
  awayWinProb?: number;
  probSource: 'odds_api' | 'elo_estimated';
}

export interface SimulationResult {
  team: string;
  positionDistribution: number[];
  top4Pct: number;
  top5Pct: number;
  top6Pct: number;
  top7Pct: number;
  relegationPct: number;
  avgPoints: number;
  avgPosition: number;
}

export interface SensitivityResult {
  fixtureId: string;
  homeTeam: string;
  awayTeam: string;
  deltaIfHomeWin: number;
  deltaIfAwayWin: number;
  deltaIfDraw: number;
  maxAbsDelta: number;
}
