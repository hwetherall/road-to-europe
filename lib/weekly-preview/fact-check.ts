// ── Claim-Level Fact-Check Pipeline ──
//
// Why claim-level web verification instead of a monolithic fact-check pass:
//
// The old approach sent all sections to a single LLM call with a deprecated
// web plugin. The model relied heavily on its own (stale) memory rather than
// doing structured web verification, producing false corrections — e.g.
// flagging Yoane Wissa as a Brentford player when he had already transferred
// to Newcastle. By extracting atomic claims and verifying each one against
// live web sources with evidence thresholds, we ensure corrections are only
// applied when backed by current, authoritative evidence.

import { callOpenRouter } from '@/lib/openrouter';
import {
  CLAIM_EXTRACTION_SYSTEM_PROMPT,
  CLAIM_VERIFICATION_SYSTEM_PROMPT,
  buildClaimExtractionUserPrompt,
  buildClaimVerificationUserPrompt,
} from '@/lib/weekly-preview/fact-check-prompts';
import {
  CLAIM_EXTRACTION_SCHEMA,
  CLAIM_VERIFICATION_SCHEMA,
} from '@/lib/weekly-preview/fact-check-schemas';
import type {
  ExtractedClaim,
  FactCheckCorrection,
  FactCheckEvidence,
  FactCheckPipelineResult,
  VerifiedClaim,
} from '@/lib/weekly-preview/fact-check-types';
import {
  HIGH_RISK_CLAIM_TYPES,
  TRANSFER_SENSITIVE_CLAIM_TYPES,
} from '@/lib/weekly-preview/fact-check-types';
import type { WeeklyPreviewSectionArtifact } from '@/lib/weekly-preview/types';

const EXTRACTION_MODEL = 'google/gemini-3.1-flash-lite-preview';
const VERIFICATION_MODEL = 'google/gemini-3.1-flash-lite-preview';

function parseJsonPayload<T>(content: string): T {
  const cleaned = content.trim();
  const fenced = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = (fenced ? fenced[1] : cleaned).trim();
  try {
    return JSON.parse(candidate) as T;
  } catch {
    const objectOrArray = candidate.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    if (objectOrArray) return JSON.parse(objectOrArray[0]) as T;
    throw new SyntaxError(`Unable to parse JSON payload: ${cleaned.slice(0, 200)}`);
  }
}

const VERIFICATION_BATCH_SIZE = 5;
const VERIFICATION_CONCURRENCY = 3;

// ────────────────────────────────────────────────────────────────
// Claim Extraction
// ────────────────────────────────────────────────────────────────

export async function extractAtomicClaims(
  sections: WeeklyPreviewSectionArtifact[]
): Promise<ExtractedClaim[]> {
  const message = await callOpenRouter(
    [
      { role: 'system', content: CLAIM_EXTRACTION_SYSTEM_PROMPT },
      { role: 'user', content: buildClaimExtractionUserPrompt(sections) },
    ],
    {
      model: EXTRACTION_MODEL,
      maxTokens: 8000,
      responseFormat: CLAIM_EXTRACTION_SCHEMA,
    }
  );

  const parsed = parseJsonPayload<{ claims?: ExtractedClaim[] }>(message.content ?? '{}');
  return parsed.claims ?? [];
}

// ────────────────────────────────────────────────────────────────
// Claim Verification
// ────────────────────────────────────────────────────────────────

export async function verifyClaim(
  claim: ExtractedClaim
): Promise<VerifiedClaim> {
  const message = await callOpenRouter(
    [
      { role: 'system', content: CLAIM_VERIFICATION_SYSTEM_PROMPT },
      { role: 'user', content: buildClaimVerificationUserPrompt([claim]) },
    ],
    {
      model: VERIFICATION_MODEL,
      maxTokens: 4000,
      tools: [{ type: 'openrouter:web_search' }],
      responseFormat: CLAIM_VERIFICATION_SCHEMA,
    }
  );

  const parsed = parseJsonPayload<{ results?: VerifiedClaim[] }>(message.content ?? '{}');
  const result = parsed.results?.[0];

  if (!result) {
    return {
      claimId: claim.claimId,
      sectionId: claim.sectionId,
      claim: claim.text,
      claimType: claim.claimType,
      verdict: 'unclear',
      reasoningShort: 'Verification returned no result.',
      confidence: 0,
      evidence: [],
    };
  }

  return result;
}

async function verifyBatch(
  claims: ExtractedClaim[]
): Promise<VerifiedClaim[]> {
  if (claims.length === 0) return [];

  if (claims.length === 1) {
    return [await verifyClaim(claims[0])];
  }

  const message = await callOpenRouter(
    [
      { role: 'system', content: CLAIM_VERIFICATION_SYSTEM_PROMPT },
      { role: 'user', content: buildClaimVerificationUserPrompt(claims) },
    ],
    {
      model: VERIFICATION_MODEL,
      maxTokens: 4000 * claims.length,
      tools: [{ type: 'openrouter:web_search' }],
      responseFormat: CLAIM_VERIFICATION_SCHEMA,
    }
  );

  const parsed = parseJsonPayload<{ results?: VerifiedClaim[] }>(message.content ?? '{}');
  const results = parsed.results ?? [];

  const resultMap = new Map(results.map((r) => [r.claimId, r]));
  return claims.map((claim) => {
    const existing = resultMap.get(claim.claimId);
    if (existing) return existing;
    return {
      claimId: claim.claimId,
      sectionId: claim.sectionId,
      claim: claim.text,
      claimType: claim.claimType,
      verdict: 'unclear' as const,
      reasoningShort: 'Verification did not return a result for this claim.',
      confidence: 0,
      evidence: [],
    };
  });
}

export async function verifyClaims(
  claims: ExtractedClaim[]
): Promise<VerifiedClaim[]> {
  if (claims.length === 0) return [];

  const batches: ExtractedClaim[][] = [];
  for (let i = 0; i < claims.length; i += VERIFICATION_BATCH_SIZE) {
    batches.push(claims.slice(i, i + VERIFICATION_BATCH_SIZE));
  }

  const allResults: VerifiedClaim[] = [];

  for (let i = 0; i < batches.length; i += VERIFICATION_CONCURRENCY) {
    const concurrentBatches = batches.slice(i, i + VERIFICATION_CONCURRENCY);
    const batchResults = await Promise.all(
      concurrentBatches.map((batch) => verifyBatch(batch))
    );
    allResults.push(...batchResults.flat());
  }

  return allResults;
}

// ────────────────────────────────────────────────────────────────
// Evidence Threshold Logic
// ────────────────────────────────────────────────────────────────

function countEvidenceByType(evidence: FactCheckEvidence[]) {
  let officialClub = 0;
  let premierLeague = 0;
  let trustedMedia = 0;
  let other = 0;

  for (const e of evidence) {
    switch (e.sourceType) {
      case 'official_club':
        officialClub++;
        break;
      case 'premier_league':
        premierLeague++;
        break;
      case 'trusted_media':
        trustedMedia++;
        break;
      default:
        other++;
        break;
    }
  }

  return { officialClub, premierLeague, trustedMedia, other };
}

/**
 * Determines whether a contradicted claim has strong enough evidence
 * to be passed to the editor as a correction.
 *
 * Minimum rule:
 * - At least one official_club or premier_league source, OR
 * - At least two trusted_media sources with no conflicting official source
 */
export function hasStrongEvidence(result: VerifiedClaim): boolean {
  if (result.verdict !== 'contradicted') return false;
  if (result.confidence < 0.7) return false;
  if (result.evidence.length === 0) return false;

  const counts = countEvidenceByType(result.evidence);

  if (counts.officialClub >= 1 || counts.premierLeague >= 1) {
    return true;
  }

  if (counts.trustedMedia >= 2) {
    return true;
  }

  return false;
}

/**
 * Returns the reason a contradicted claim was rejected, or null if it passes.
 */
export function rejectionReason(result: VerifiedClaim): string | null {
  if (result.verdict !== 'contradicted') return null;

  if (result.confidence < 0.7) {
    return `Low confidence (${result.confidence.toFixed(2)}): below 0.7 threshold.`;
  }

  if (result.evidence.length === 0) {
    return 'No evidence provided for contradiction.';
  }

  const counts = countEvidenceByType(result.evidence);

  if (
    counts.officialClub === 0 &&
    counts.premierLeague === 0 &&
    counts.trustedMedia < 2
  ) {
    return `Insufficient authoritative evidence: ${counts.officialClub} official, ${counts.premierLeague} PL, ${counts.trustedMedia} trusted media.`;
  }

  return null;
}

// ────────────────────────────────────────────────────────────────
// Correction Selection
// ────────────────────────────────────────────────────────────────

export function selectFactCheckCorrections(
  results: VerifiedClaim[]
): {
  corrections: FactCheckCorrection[];
  rejected: Array<{ claim: VerifiedClaim; reason: string }>;
} {
  const corrections: FactCheckCorrection[] = [];
  const rejected: Array<{ claim: VerifiedClaim; reason: string }> = [];

  for (const result of results) {
    if (result.verdict !== 'contradicted') continue;
    if (!result.correction) {
      rejected.push({ claim: result, reason: 'Contradicted but no correction text provided.' });
      continue;
    }

    const reason = rejectionReason(result);
    if (reason) {
      rejected.push({ claim: result, reason });
      continue;
    }

    if (!hasStrongEvidence(result)) {
      rejected.push({ claim: result, reason: 'Did not pass hasStrongEvidence check.' });
      continue;
    }

    const isHighRisk = HIGH_RISK_CLAIM_TYPES.has(result.claimType);
    const isTransferSensitive = TRANSFER_SENSITIVE_CLAIM_TYPES.has(result.claimType);

    corrections.push({
      claim: result.claim,
      correction: result.correction,
      sectionId: result.sectionId,
      severity: isHighRisk || isTransferSensitive ? 'high' : 'medium',
      evidence: result.evidence,
      confidence: result.confidence,
    });
  }

  return { corrections, rejected };
}

// ────────────────────────────────────────────────────────────────
// Pipeline Orchestrator
// ────────────────────────────────────────────────────────────────

export async function runFactCheckPipeline(
  sections: WeeklyPreviewSectionArtifact[]
): Promise<FactCheckPipelineResult> {
  console.log('[fact-check] Starting claim-level fact-check pipeline...');

  // Step 1: Extract atomic claims
  let claims: ExtractedClaim[];
  try {
    claims = await extractAtomicClaims(sections);
    console.log(`[fact-check] Extracted ${claims.length} atomic claims.`);
  } catch (error) {
    console.error(
      '[fact-check] Claim extraction failed:',
      error instanceof Error ? error.message : error
    );
    return emptyResult();
  }

  if (claims.length === 0) {
    console.log('[fact-check] No claims to verify.');
    return emptyResult();
  }

  // Prioritize high-risk claims; skip low-value general_fact claims to save cost
  const highRiskClaims = claims.filter((c) => HIGH_RISK_CLAIM_TYPES.has(c.claimType));
  const otherClaims = claims.filter(
    (c) => !HIGH_RISK_CLAIM_TYPES.has(c.claimType) && c.claimType !== 'general_fact'
  );
  const claimsToVerify = [...highRiskClaims, ...otherClaims];
  const skippedCount = claims.length - claimsToVerify.length;

  if (skippedCount > 0) {
    console.log(
      `[fact-check] Skipping ${skippedCount} low-risk general_fact claims.`
    );
  }
  console.log(
    `[fact-check] Verifying ${claimsToVerify.length} claims (${highRiskClaims.length} high-risk, ${otherClaims.length} other).`
  );

  // Step 2: Verify claims
  let allResults: VerifiedClaim[];
  try {
    allResults = await verifyClaims(claimsToVerify);
  } catch (error) {
    console.error(
      '[fact-check] Claim verification failed:',
      error instanceof Error ? error.message : error
    );
    return emptyResult();
  }

  const supported = allResults.filter((r) => r.verdict === 'supported').length;
  const contradicted = allResults.filter((r) => r.verdict === 'contradicted').length;
  const unclear = allResults.filter((r) => r.verdict === 'unclear').length;

  console.log(
    `[fact-check] Verification complete: ${supported} supported, ${contradicted} contradicted, ${unclear} unclear.`
  );

  // Step 3: Apply evidence thresholds and select corrections
  const { corrections, rejected } = selectFactCheckCorrections(allResults);

  if (rejected.length > 0) {
    console.log(
      `[fact-check] Rejected ${rejected.length} contradictions for insufficient evidence:`
    );
    for (const { claim, reason } of rejected) {
      console.log(`  - ${claim.claimId} ("${claim.claim.slice(0, 80)}"): ${reason}`);
    }
  }

  if (corrections.length > 0) {
    console.log(
      `[fact-check] Accepted ${corrections.length} correction(s):`,
      corrections.map(
        (c) =>
          `${c.sectionId}: "${c.claim.slice(0, 60)}" -> "${c.correction.slice(0, 60)}" (confidence: ${c.confidence.toFixed(2)}, evidence: ${c.evidence.length})`
      )
    );
  } else {
    console.log('[fact-check] No corrections to apply.');
  }

  return {
    totalClaims: claims.length,
    supported,
    contradicted,
    unclear,
    corrections,
    allResults,
    rejectedContradictions: rejected,
  };
}

function emptyResult(): FactCheckPipelineResult {
  return {
    totalClaims: 0,
    supported: 0,
    contradicted: 0,
    unclear: 0,
    corrections: [],
    allResults: [],
    rejectedContradictions: [],
  };
}
