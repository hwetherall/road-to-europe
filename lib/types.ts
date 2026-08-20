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
  // Absolute metric values from the sensitivity scan's own simulations
  absIfHomeWin: number;
  absIfAwayWin: number;
  absIfDraw: number;
  absBaseline: number;
  /**
   * Measured standard error of the outcome that produced maxAbsDelta, in
   * percentage points. Computed from the per-simulation paired difference, not
   * from an assumed variance-reduction factor.
   */
  sePp: number;
  /** Two-sided ~95% reporting threshold for this fixture: 2 x sePp. */
  noiseFloorPp: number;
  /** True when maxAbsDelta is not distinguishable from zero at ~95%. */
  belowNoiseFloor: boolean;
  /**
   * maxAbsDelta after empirical-Bayes shrinkage, in percentage points. The
   * ranking uses this rather than the raw value: the top of a list selected from
   * ~1,140 noisy estimates is biased upward, and shrinkage is the correction.
   */
  shrunkMaxAbsDeltaPp: number;
  /**
   * True when this fixture's strongest outcome survives the relevance test —
   * confidently worth more than the material-effect threshold, after controlling
   * the false discovery rate across the whole scan. This, not belowNoiseFloor,
   * decides whether a fixture is shown. See lib/leverage/floor.ts.
   */
  reportable: boolean;
}

/** A sensitivity scan plus the context needed to report honestly on it. */
export interface SensitivityScanSummary {
  /** Fixtures worth reporting, strongest shrunk swing first. */
  ranked: SensitivityResult[];
  /** Fixtures measured but not shown — immaterial, or not confidently material. */
  belowFloorCount: number;
  /** The target metric's baseline value, in percent. */
  baselinePct: number;
  /** Median noise floor across all fixtures measured, for UI copy. */
  medianNoiseFloorPp: number;
  numSims: number;
  /**
   * The editorial relevance threshold in percentage points: the smallest swing
   * considered worth a reader's attention. Shown in the UI, because a suppressed
   * fixture should be explained by a stated rule rather than a silent one.
   */
  materialEffectPp: number;
  /** Comparisons (fixture x outcome) that survived, and how many were tested. */
  reportableComparisons: number;
  comparisonCount: number;
  /**
   * Mean empirical-Bayes shrinkage weight across the scan. Near 1 means the
   * spread of real effects dwarfs the error bars, so the ranking is
   * signal-driven rather than selection-driven — a diagnostic worth surfacing
   * rather than a knob.
   */
  shrinkageWeight: number;
  /** Estimated spread of true effects across the scan, in percentage points. */
  tauPp: number;
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
  /**
   * Narrowed from `keyof SimulationResult`: only the position-threshold metrics
   * were ever passed, and only those can be measured by the paired leverage
   * engine, which works from the target's final rank.
   */
  targetMetric: SensitivityMetric;
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
