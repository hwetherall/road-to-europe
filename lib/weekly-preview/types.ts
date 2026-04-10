import { Fixture, SimulationResult, Team } from '@/lib/types';
import { SquadProfile } from '@/lib/what-if/types';

export const WEEKLY_PREVIEW_VERSION = '2026-04-10-v1';
export const WEEKLY_PREVIEW_SECTION_ORDER = [
  'overview',
  'three-contests',
  'hot-news',
  'game-of-the-week',
  'club-focus',
  'match-focus',
  'perfect-weekend',
  'summary',
] as const;

export type WeeklyPreviewSectionId = (typeof WEEKLY_PREVIEW_SECTION_ORDER)[number];
export type WeeklyPreviewStatus = 'draft' | 'published';

export interface WeeklyPreviewSourceRef {
  id: string;
  title: string;
  url: string;
  provider: string;
}

export interface WeeklyPreviewNumericClaim {
  id: string;
  formatted: string;
  value: number;
  unit: 'percent' | 'pp';
  label: string;
  sourcePath: string;
}

export interface WeeklyPreviewHotNewsItem {
  title: string;
  summary: string;
  quantifiedImpact?: string;
  uncertaintyNote?: string;
  relevantTeams: string[];
  sourceRefIds: string[];
}

export interface WeeklyPreviewClubFactSheet {
  clubNews: string[];
  injuryUpdates: string[];
  squadUpdates: string[];
  opponentUpdates: string[];
  squadEdgeNotes: string[];
}

export interface GameOfWeekCandidate {
  fixtureId: string;
  homeTeam: string;
  awayTeam: string;
  leverageScore: number;
  tableStoryScore: number;
  marketClosenessScore: number;
  overallScore: number;
  leverageSpreadPp: number;
  titleImpactPp: number;
  europeImpactPp: number;
  survivalImpactPp: number;
}

export interface WeeklyPreviewPerfectWeekendEntry {
  fixtureId: string;
  homeTeam: string;
  awayTeam: string;
  result: 'home' | 'draw' | 'away';
  resultLabel: string;
  deltaPp: number;
  resultingTop7Pct: number;
}

export interface WeeklyPreviewContestSnapshot {
  label: string;
  summary: string;
  numericClaims: WeeklyPreviewNumericClaim[];
}

export interface WeeklyPreviewDossier {
  version: string;
  generatedAt: number;
  season: string;
  club: string;
  targetMetric: 'top7Pct';
  dataHash: string;
  matchday: number;
  teams: Team[];
  fixtures: Fixture[];
  nextRoundFixtures: Fixture[];
  selectedClubFixture: Fixture | null;
  selectedClubBaseline: SimulationResult;
  leagueResults: SimulationResult[];
  standingsSource: string;
  fixturesSource: string;
  oddsSource: string;
  oddsCoverage: {
    matchedFixtures: number;
    totalScheduledFixtures: number;
    nextRoundMatchedFixtures: number;
    nextRoundScheduledFixtures: number;
  };
  contestSnapshots: {
    title: WeeklyPreviewContestSnapshot;
    europe: WeeklyPreviewContestSnapshot;
    survival: WeeklyPreviewContestSnapshot;
  };
  hotNewsCandidates: WeeklyPreviewHotNewsItem[];
  gameOfWeekShortlist: GameOfWeekCandidate[];
  gameOfWeekResearch: string[];
  clubFactSheet: WeeklyPreviewClubFactSheet;
  squadProfiles: {
    selectedClub: SquadProfile;
    opponent: SquadProfile | null;
  };
  roundsRemaining: number;
  perfectWeekend: WeeklyPreviewPerfectWeekendEntry[];
  perfectWeekendCumulativeDeltaPp: number;
  approvedStorylines: string[];
  warnings: string[];
  sources: WeeklyPreviewSourceRef[];
  allowedNumericClaimsBySection: Record<WeeklyPreviewSectionId, WeeklyPreviewNumericClaim[]>;
}

export interface WeeklyPreviewSectionArtifact {
  sectionId: WeeklyPreviewSectionId;
  headline: string;
  markdown: string;
  factsUsed: string[];
  newFacts: string[];
  numericClaimIds: string[];
  sourceRefs: string[];
  handoffNotes: string[];
  meta?: {
    itemCount?: number;
    fixtureCount?: number;
  };
}

export interface WeeklyPreviewDraft {
  id: string;
  version: string;
  season: string;
  matchday: number;
  club: string;
  status: WeeklyPreviewStatus;
  generatedAt: number;
  scheduledFor: string;
  markdown: string;
  dossier: WeeklyPreviewDossier;
  sections: WeeklyPreviewSectionArtifact[];
  sources: WeeklyPreviewSourceRef[];
  warnings: string[];
  metadata: {
    llmCalls: number;
    sectionAgentCalls: number;
    editorCalls: number;
    factCheckCorrections: number;
    model: string;
  };
}
