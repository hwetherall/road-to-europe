// ── Squad Quality ──

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

// ── Scenario System ──

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
  simulationResult: {
    targetMetric: string;
    baselineOdds: number;
    modifiedOdds: number;
    delta: number;
  };
  plausibility: {
    score: number;
    reasoning: string;
    constraints: string[];
  };
  iteration: number;
}

// ── Analysis Output ──

export interface WhatIfAnalysis {
  id: string;
  generatedAt: number;
  targetTeam: string;
  targetTeamName: string;
  targetMetric: string;
  targetMetricLabel: string;
  baselineOdds: number;

  diagnosis: {
    squadQualityRank: number;
    gapToTopSquad: number;
    keyBottlenecks: string[];
    narrativeSummary: string;
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
}

// ── Supabase Cache ──

export interface CachedWhatIfAnalysis {
  id: string;
  team_abbr: string;
  target_metric: string;
  analysis_json: WhatIfAnalysis;
  created_at: string;
  season: string;
  gameweek: number;
}
