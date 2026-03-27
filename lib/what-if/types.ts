export interface PlayerQuality {
  name: string;
  overall: number;
  potential: number;
  age: number;
  positions: string[];
  club: string;
  valueEuro: number;
  wageEuro: number;
  pace: number;
  shooting: number;
  passing: number;
  dribbling: number;
  defending: number;
  physical: number;
}

export interface SquadProfile {
  teamName: string;
  teamAbbr: string;
  averageOverall: number;
  averageStartingXI: number;
  depthScore: number;
  weakestPositionGroup: string;
  weakestPositionAvg: number;
  strongestPositionGroup: string;
  strongestPositionAvg: number;
  players: PlayerQuality[];
  totalSquadValue: number;
}

export interface ScenarioModification {
  type: 'team_quality_delta' | 'fixture_lock' | 'probability_modifier' | 'competition_withdrawal';
  description: string;
  teamAbbr?: string;
  homeWinDelta?: number;
  awayWinDelta?: number;
  drawDelta?: number;
  competition?: string;
  fatigueReduction?: number;
}

export interface CounterfactualScenario {
  id: string;
  title: string;
  category:
    | 'squad_upgrade'
    | 'competition_priority'
    | 'tactical_change'
    | 'injury_prevention'
    | 'combination'
    | 'perfect_world';
  description: string;
  modifications: ScenarioModification[];
  fixtureLocks?: Array<{
    fixtureId: string;
    result: 'home' | 'draw' | 'away';
  }>;
  simulationResult: {
    targetMetric: string;
    baselineOdds: number;
    modifiedOdds: number;
    delta: number;
    modifiedExpectedPoints?: number;
    modifiedExpectedPosition?: number;
  };
  plausibility: {
    score: number;
    reasoning: string;
    constraints: string[];
  };
  iteration: number;
}

export interface WhatIfSearchTraceEntry {
  phase: 'diagnose' | 'hypothesise' | 'stress-test' | 'synthesise';
  query: string;
  provider: 'serper' | 'tavily' | 'unavailable';
  resultCount: number;
}

export const WHAT_IF_ANALYSIS_VERSION = '2026-03-26-searchtrail-v3';

export interface WhatIfAnalysis {
  id: string;
  version: string;
  generatedAt: number;
  targetTeam: string;
  targetTeamName: string;
  targetMetric: string;
  targetMetricLabel: string;
  baselineOdds: number;
  baselineExpectedPoints?: number;
  baselineExpectedPosition?: number;
  diagnosis: {
    squadQualityRank: number;
    gapToTopSquad: number;
    keyBottlenecks: string[];
    narrativeSummary: string;
    departedPlayers?: {
      name: string;
      to: string;
      fee: string;
      overall: number;
      position: string;
    }[];
  };
  scenarios: CounterfactualScenario[];
  perfectWorld: CounterfactualScenario;
  stressTest: {
    feasibleScenarios: CounterfactualScenario[];
    infeasibleReasons: Record<string, string[]>;
  };
  narrative: {
    perfectWorldSection: string;
    realityCheckSection: string;
    pragmaticPathSection: string;
    longTermPerspective: string;
    bottomLine: string;
  };
  totalIterations: number;
  totalSimulations: number;
  totalWebSearches: number;
  totalLLMCalls: number;
  wallClockTimeMs: number;
  costEstimate: number;
  searchTrail: WhatIfSearchTraceEntry[];
}

export interface CachedWhatIfAnalysis {
  id: string;
  team_abbr: string;
  target_metric: string;
  analysis_json: WhatIfAnalysis;
  created_at: string;
  season: string;
  gameweek: number;
}
