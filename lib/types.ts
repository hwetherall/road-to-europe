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

export type SensitivityMetric =
  | 'championPct'
  | 'top4Pct'
  | 'top5Pct'
  | 'top6Pct'
  | 'top7Pct'
  | 'relegationPct'
  | 'survivalPct';

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
  primaryMetric: SensitivityMetric;
  relevantCards: CardConfig[];
  accentColor: string;
}

export interface WhatIfState {
  locks: Record<string, 'home' | 'draw' | 'away'>;
  baseResult: SimulationResult | null;
  whatIfResult: SimulationResult | null;
}

// ── V4: Path Search Types ──

export interface PathSearchConfig {
  teams: Team[];
  fixtures: Fixture[];
  targetTeam: string;
  targetMetric: keyof SimulationResult;
  targetThreshold: number;
  maxFixturesToLock: number;
  branchDepth: number;
}

export interface FixtureLock {
  fixtureId: string;
  homeTeam: string;
  awayTeam: string;
  result: 'home' | 'draw' | 'away';
  resultLabel: string;
  individualPlausibility: number;
}

export interface CandidatePath {
  id: string;
  locks: FixtureLock[];
  resultingOdds: number;
  baselineOdds: number;
  delta: number;
  compositePlausibility: number;
  crossesThreshold: boolean;
  locksInvolvingTarget: number;
  locksInvolvingRivals: number;
}

export interface PathSearchResult {
  config: PathSearchConfig;
  baselineOdds: number;
  optimalPath: CandidatePath;
  candidatePaths: CandidatePath[];
  sensitivityData: SensitivityResult[];
  searchStats: {
    totalSimulations: number;
    totalPaths: number;
    pathsFiltered: number;
    searchTimeMs: number;
  };
}

// ── V4: Deep Analysis Output ──

export interface DeepAnalysis {
  id: string;
  generatedAt: number;
  targetTeam: string;
  targetMetric: string;
  targetThreshold: number;

  stateOfPlay: {
    position: number;
    points: number;
    gapToTarget: number;
    gamesRemaining: number;
    baselineOdds: number;
    optimalPathOdds: number;
    optimalPathPlausibility: number;
    contextNarrative: string;
  };

  decisiveMatch: {
    fixtureId: string;
    homeTeam: string;
    awayTeam: string;
    date: string;
    outcomeTable: {
      result: string;
      resultingOdds: number;
      delta: number;
    }[];
    risks: string[];
    angles: {
      title: string;
      analysis: string;
    }[];
    whatToWatch: string[];
  };

  matchesToWatch: {
    fixtureId: string;
    homeTeam: string;
    awayTeam: string;
    whyItMatters: string;
    idealResult: string;
    whyItsPlausible: string;
    simulationImpact: string;
  }[];

  bottomLine: {
    summary: string;
    keyScenario: string;
  };

  sources: string[];
  searchBudgetUsed: number;
}

// ── Pundit Panel ──

export type PunditArchetype =
  | 'analyst'
  | 'coach'
  | 'fan'
  | 'banter_merchant'
  | 'skeptic';

export type PunditImpact = 'positive' | 'negative' | 'neutral';

export interface PunditFixtureContext {
  fixtureId: string;
  homeTeam: string;
  awayTeam: string;
  date?: string;
}

export interface PunditSensitivitySnapshot {
  fixtureId: string;
  homeTeam: string;
  awayTeam: string;
  maxAbsDelta: number;
}

export interface PunditTake {
  archetype: PunditArchetype;
  targetTeam: string;
  fixtureId: string;
  takeText: string;
  impactOnTargetTeam: PunditImpact;
  watchFor: string;
  confidence: 1 | 2 | 3 | 4 | 5;
}
