// ── Fact-Check Pipeline Types ──
//
// Claim-level web verification replaces the old monolithic memory-based
// fact-check pass. Each factual claim is extracted, individually verified
// against live web sources, and only evidence-backed contradictions reach
// the editor. This prevents false corrections from stale model knowledge
// (e.g. outdated player-club associations).

export type ClaimType =
  | 'player_club'
  | 'manager_club'
  | 'transfer_status'
  | 'injury_status'
  | 'suspension_status'
  | 'league_position'
  | 'recent_result'
  | 'fixture_detail'
  | 'venue'
  | 'kickoff_time'
  | 'general_fact';

export interface ExtractedClaim {
  claimId: string;
  sectionId: string;
  text: string;
  claimType: ClaimType;
}

export type Verdict = 'supported' | 'contradicted' | 'unclear';

export type SourceType = 'official_club' | 'premier_league' | 'trusted_media' | 'other';

export interface FactCheckEvidence {
  title: string;
  url: string;
  sourceType: SourceType;
  publishedAt?: string;
  snippet?: string;
  supports: string;
}

export interface VerifiedClaim {
  claimId: string;
  sectionId: string;
  claim: string;
  claimType: ClaimType;
  verdict: Verdict;
  correction?: string;
  reasoningShort: string;
  confidence: number;
  evidence: FactCheckEvidence[];
}

export interface FactCheckCorrection {
  claim: string;
  correction: string;
  sectionId: string;
  severity: 'high' | 'medium';
  evidence: FactCheckEvidence[];
  confidence: number;
}

export interface FactCheckPipelineResult {
  totalClaims: number;
  supported: number;
  contradicted: number;
  unclear: number;
  corrections: FactCheckCorrection[];
  allResults: VerifiedClaim[];
  rejectedContradictions: Array<{
    claim: VerifiedClaim;
    reason: string;
  }>;
}

/** Claim types where player/manager/squad membership freshness is critical. */
export const TRANSFER_SENSITIVE_CLAIM_TYPES: ReadonlySet<ClaimType> = new Set([
  'player_club',
  'manager_club',
  'transfer_status',
]);

/** Claim types that are high-risk and always need strict verification. */
export const HIGH_RISK_CLAIM_TYPES: ReadonlySet<ClaimType> = new Set([
  'player_club',
  'manager_club',
  'transfer_status',
  'injury_status',
  'suspension_status',
  'recent_result',
  'fixture_detail',
]);
