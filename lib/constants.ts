import { Team, Fixture } from './types';

export const TARGET_TEAM = 'NEW';
export const TOTAL_MATCHDAYS = 38;
export const NUM_TEAMS = 20;

export const EUROPEAN_ZONES = {
  ucl: { max: 4, label: 'Champions League', color: '#22c55e' },
  ucl5: { max: 5, label: 'UCL (expanded)', color: '#3b82f6' },
  uel: { max: 6, label: 'Europa League', color: '#f97316' },
  uecl: { max: 7, label: 'Conference League', color: '#00ccaa' },
  relegation: { min: 18, label: 'Relegation', color: '#ef4444' },
} as const;

// Real EPL standings as of March 21, 2026
export const HARDCODED_STANDINGS: Team[] = [
  { id: '1', abbr: 'ARS', name: 'Arsenal', points: 70, goalDifference: 42, goalsFor: 68, goalsAgainst: 26, played: 31, won: 21, drawn: 7, lost: 3 },
  { id: '2', abbr: 'MCI', name: 'Man City', points: 61, goalDifference: 31, goalsFor: 62, goalsAgainst: 31, played: 30, won: 19, drawn: 4, lost: 7 },
  { id: '3', abbr: 'MUN', name: 'Man United', points: 55, goalDifference: 18, goalsFor: 52, goalsAgainst: 34, played: 31, won: 16, drawn: 7, lost: 8 },
  { id: '4', abbr: 'AVL', name: 'Aston Villa', points: 51, goalDifference: 12, goalsFor: 48, goalsAgainst: 36, played: 30, won: 15, drawn: 6, lost: 9 },
  { id: '5', abbr: 'CFC', name: 'Chelsea', points: 49, goalDifference: 14, goalsFor: 50, goalsAgainst: 36, played: 31, won: 14, drawn: 7, lost: 10 },
  { id: '6', abbr: 'LFC', name: 'Liverpool', points: 49, goalDifference: 10, goalsFor: 46, goalsAgainst: 36, played: 31, won: 14, drawn: 7, lost: 10 },
  { id: '7', abbr: 'BRE', name: 'Brentford', points: 45, goalDifference: 4, goalsFor: 44, goalsAgainst: 40, played: 30, won: 13, drawn: 6, lost: 11 },
  { id: '8', abbr: 'FUL', name: 'Fulham', points: 44, goalDifference: 2, goalsFor: 40, goalsAgainst: 38, played: 31, won: 12, drawn: 8, lost: 11 },
  { id: '9', abbr: 'EVE', name: 'Everton', points: 44, goalDifference: 5, goalsFor: 42, goalsAgainst: 37, played: 31, won: 12, drawn: 8, lost: 11 },
  { id: '10', abbr: 'BRI', name: 'Brighton', points: 43, goalDifference: 3, goalsFor: 41, goalsAgainst: 38, played: 31, won: 12, drawn: 7, lost: 12 },
  { id: '11', abbr: 'NEW', name: 'Newcastle', points: 42, goalDifference: 1, goalsFor: 38, goalsAgainst: 37, played: 30, won: 12, drawn: 6, lost: 12 },
  { id: '12', abbr: 'BOU', name: 'Bournemouth', points: 42, goalDifference: -2, goalsFor: 38, goalsAgainst: 40, played: 31, won: 12, drawn: 6, lost: 13 },
  { id: '13', abbr: 'SUN', name: 'Sunderland', points: 40, goalDifference: -1, goalsFor: 37, goalsAgainst: 38, played: 30, won: 11, drawn: 7, lost: 12 },
  { id: '14', abbr: 'CRY', name: 'Crystal Palace', points: 39, goalDifference: -5, goalsFor: 35, goalsAgainst: 40, played: 30, won: 11, drawn: 6, lost: 13 },
  { id: '15', abbr: 'LEE', name: 'Leeds', points: 32, goalDifference: -12, goalsFor: 30, goalsAgainst: 42, played: 30, won: 9, drawn: 5, lost: 16 },
  { id: '16', abbr: 'TOT', name: 'Tottenham', points: 30, goalDifference: -14, goalsFor: 32, goalsAgainst: 46, played: 30, won: 8, drawn: 6, lost: 16 },
  { id: '17', abbr: 'NFO', name: "Nott'm Forest", points: 29, goalDifference: -19, goalsFor: 28, goalsAgainst: 47, played: 30, won: 8, drawn: 5, lost: 17 },
  { id: '18', abbr: 'WHU', name: 'West Ham', points: 29, goalDifference: -21, goalsFor: 29, goalsAgainst: 50, played: 30, won: 8, drawn: 5, lost: 17 },
  { id: '19', abbr: 'BUR', name: 'Burnley', points: 20, goalDifference: -30, goalsFor: 22, goalsAgainst: 52, played: 31, won: 5, drawn: 5, lost: 21 },
  { id: '20', abbr: 'WOL', name: 'Wolves', points: 17, goalDifference: -38, goalsFor: 20, goalsAgainst: 58, played: 31, won: 4, drawn: 5, lost: 22 },
];

// Known upcoming fixtures with bookmaker probabilities
export const KNOWN_FIXTURES: Fixture[] = [
  { id: 'kf1', homeTeam: 'EVE', awayTeam: 'CFC', matchday: 32, date: '2026-03-28', status: 'SCHEDULED', homeWinProb: 0.325, drawProb: 0.278, awayWinProb: 0.397, probSource: 'odds_api' },
  { id: 'kf2', homeTeam: 'LEE', awayTeam: 'BRE', matchday: 32, date: '2026-03-28', status: 'SCHEDULED', homeWinProb: 0.388, drawProb: 0.278, awayWinProb: 0.334, probSource: 'odds_api' },
  { id: 'kf3', homeTeam: 'NEW', awayTeam: 'SUN', matchday: 32, date: '2026-03-28', status: 'SCHEDULED', homeWinProb: 0.571, drawProb: 0.241, awayWinProb: 0.188, probSource: 'odds_api' },
  { id: 'kf4', homeTeam: 'AVL', awayTeam: 'WHU', matchday: 32, date: '2026-03-28', status: 'SCHEDULED', homeWinProb: 0.495, drawProb: 0.261, awayWinProb: 0.244, probSource: 'odds_api' },
  { id: 'kf5', homeTeam: 'TOT', awayTeam: 'NFO', matchday: 32, date: '2026-03-28', status: 'SCHEDULED', homeWinProb: 0.418, drawProb: 0.279, awayWinProb: 0.303, probSource: 'odds_api' },
  { id: 'kf6', homeTeam: 'WHU', awayTeam: 'WOL', matchday: 33, date: '2026-04-04', status: 'SCHEDULED', homeWinProb: 0.538, drawProb: 0.245, awayWinProb: 0.217, probSource: 'odds_api' },
  { id: 'kf7', homeTeam: 'ARS', awayTeam: 'BOU', matchday: 33, date: '2026-04-04', status: 'SCHEDULED', homeWinProb: 0.719, drawProb: 0.172, awayWinProb: 0.109, probSource: 'odds_api' },
  { id: 'kf8', homeTeam: 'BRE', awayTeam: 'EVE', matchday: 33, date: '2026-04-04', status: 'SCHEDULED', homeWinProb: 0.445, drawProb: 0.279, awayWinProb: 0.276, probSource: 'odds_api' },
  { id: 'kf9', homeTeam: 'BUR', awayTeam: 'BRI', matchday: 33, date: '2026-04-04', status: 'SCHEDULED', homeWinProb: 0.222, drawProb: 0.250, awayWinProb: 0.528, probSource: 'odds_api' },
  { id: 'kf10', homeTeam: 'LFC', awayTeam: 'FUL', matchday: 33, date: '2026-04-04', status: 'SCHEDULED', homeWinProb: 0.629, drawProb: 0.201, awayWinProb: 0.170, probSource: 'odds_api' },
  { id: 'kf11', homeTeam: 'CRY', awayTeam: 'NEW', matchday: 33, date: '2026-04-04', status: 'SCHEDULED', homeWinProb: 0.341, drawProb: 0.272, awayWinProb: 0.387, probSource: 'odds_api' },
];

// Team name mappings for API matching
export const TEAM_NAME_MAP: Record<string, string> = {
  'Arsenal FC': 'ARS',
  'Manchester City FC': 'MCI',
  'Manchester United FC': 'MUN',
  'Aston Villa FC': 'AVL',
  'Chelsea FC': 'CFC',
  'Liverpool FC': 'LFC',
  'Brentford FC': 'BRE',
  'Fulham FC': 'FUL',
  'Everton FC': 'EVE',
  'Brighton & Hove Albion FC': 'BRI',
  'Newcastle United FC': 'NEW',
  'AFC Bournemouth': 'BOU',
  'Sunderland AFC': 'SUN',
  'Crystal Palace FC': 'CRY',
  'Leeds United FC': 'LEE',
  'Tottenham Hotspur FC': 'TOT',
  'Nottingham Forest FC': 'NFO',
  'West Ham United FC': 'WHU',
  'Burnley FC': 'BUR',
  'Wolverhampton Wanderers FC': 'WOL',
};
