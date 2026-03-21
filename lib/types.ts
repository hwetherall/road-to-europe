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
  championPct: number;
  survivalPct: number;
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

export interface CardConfig {
  key: keyof SimulationResult;
  label: string;
  sub: string;
  color: string;
  invert?: boolean;
}

export interface TeamContext {
  team: string;
  zone: 'title' | 'europe' | 'midtable' | 'relegation';
  primaryMetric: string;
  relevantCards: CardConfig[];
  accentColor: string;
}

export interface WhatIfState {
  locks: Record<string, 'home' | 'draw' | 'away'>;
  baseResult: SimulationResult | null;
  whatIfResult: SimulationResult | null;
}
