import { SimulationResult, Team } from '@/lib/types';
import {
  WeeklyPreviewContestSnapshot,
  WeeklyPreviewPerfectWeekendEntry,
  WeeklyPreviewSourceRef,
} from '@/lib/weekly-preview/types';
import { GameOfWeekCandidate } from '@/lib/weekly-preview/types';

export const WEEKLY_ROUNDUP_VERSION = '2026-04-15-v1';

export const WEEKLY_ROUNDUP_SECTION_ORDER = [
  'the-shift',
  'preview-scorecard',
  'three-races',
  'newcastle-deep-dive',
  'result-that-changed',
  'rapid-round',
] as const;

export type WeeklyRoundupSectionId = (typeof WEEKLY_ROUNDUP_SECTION_ORDER)[number];
export type WeeklyRoundupStatus = 'draft' | 'published';

// ── Match Results ──

export interface MatchResult {
  fixtureId: string;
  homeTeam: string;
  awayTeam: string;
  homeGoals: number;
  awayGoals: number;
  matchday: number;
  status: 'FINISHED' | 'IN_PLAY' | 'SCHEDULED';
}

// ── Probability Shifts ──

export interface ProbabilityShiftMetrics {
  championPct: number;
  top4Pct: number;
  top7Pct: number;
  survivalPct: number;
  avgPosition: number;
  avgPoints: number;
}

export interface ProbabilityShift {
  team: string;
  preRound: ProbabilityShiftMetrics;
  postRound: ProbabilityShiftMetrics;
  delta: ProbabilityShiftMetrics;
}

// ── Perfect Weekend Grading ──

export interface PerfectWeekendGrade {
  fixtureId: string;
  homeTeam: string;
  awayTeam: string;
  predictedResult: 'home' | 'draw' | 'away';
  predictedResultLabel: string;
  actualResult: 'home' | 'draw' | 'away';
  actualScore: string;
  correct: boolean;
  predictedSwingPp: number;
}

// ── Result That Changed Everything ──

export interface ResultThatChanged {
  fixtureId: string;
  homeTeam: string;
  awayTeam: string;
  homeGoals: number;
  awayGoals: number;
  impactScore: number;
  topAffectedTeams: Array<{
    team: string;
    metric: string;
    delta: number;
  }>;
}

// ── Research ──

export interface RoundupMatchResearch {
  fixtureId: string;
  homeTeam: string;
  awayTeam: string;
  score: string;
  scorers: string;
  keyEvent: string;
  tacticalNote: string;
  managerQuote: string;
  narrativeHook: string;
  tier: 'deep' | 'light';
  sourceRefIds: string[];
}

export interface RoundupResearchBundle {
  matchResearch: RoundupMatchResearch[];
  sources: WeeklyPreviewSourceRef[];
}

// ── Dossier ──

export interface RoundupDossier {
  version: string;
  generatedAt: number;
  matchday: number;
  season: string;
  club: string;
  roundsRemaining: number;
  dataHash: string;

  // Teams and results
  teams: Team[];
  preRoundTeams: Team[];
  results: MatchResult[];

  // Simulation data
  preRoundSnapshot: SimulationResult[];
  postRoundResults: SimulationResult[];
  probabilityShifts: ProbabilityShift[];

  // Preview reference
  previousPreview: {
    matchday: number;
    perfectWeekend: WeeklyPreviewPerfectWeekendEntry[];
    perfectWeekendCumulativeDeltaPp: number;
    gameOfWeekShortlist: GameOfWeekCandidate[];
    gameOfWeekTeams: { home: string; away: string } | null;
    contestSnapshots: {
      title: WeeklyPreviewContestSnapshot;
      europe: WeeklyPreviewContestSnapshot;
      survival: WeeklyPreviewContestSnapshot;
    };
    clubBaselineTop7Pct: number;
    clubFixtureId: string | null;
  };

  // Perfect weekend grading
  perfectWeekendGrades: PerfectWeekendGrade[];
  perfectWeekendHitRate: number;
  perfectWeekendActualCorrect: number;
  perfectWeekendTotal: number;

  // Computed
  resultThatChanged: ResultThatChanged;
  targetClubResult: MatchResult | null;
  targetClubPostTop7Pct: number;
  targetClubPreTop7Pct: number;
  targetClubDeltaTop7Pp: number;

  // Research (populated by orchestrator after Phase S)
  researchBundle: RoundupResearchBundle;

  // Metadata
  sources: WeeklyPreviewSourceRef[];
  warnings: string[];
}

// ── Section Artifacts ──

export interface RoundupSectionArtifact {
  sectionId: WeeklyRoundupSectionId;
  headline: string;
  markdown: string;
  sourceRefs: string[];
  handoffNotes: string[];
  meta?: {
    fixtureCount?: number;
    hitRate?: number;
  };
}

// ── Draft ──

export interface RoundupDraft {
  id: string;
  version: string;
  season: string;
  matchday: number;
  club: string;
  status: WeeklyRoundupStatus;
  generatedAt: number;
  markdown: string;
  dossier: RoundupDossier;
  sections: RoundupSectionArtifact[];
  sources: WeeklyPreviewSourceRef[];
  warnings: string[];
  metadata: {
    llmCalls: number;
    webSearches: number;
    editorCalls: number;
    model: string;
    wallClockTimeMs: number;
  };
}
