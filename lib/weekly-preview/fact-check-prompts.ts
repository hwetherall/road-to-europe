// ── Fact-Check Prompts ──

import type { ExtractedClaim } from '@/lib/weekly-preview/fact-check-types';
import type { WeeklyPreviewSectionArtifact } from '@/lib/weekly-preview/types';

// ────────────────────────────────────────────────────────────────
// Claim Extraction
// ────────────────────────────────────────────────────────────────

export const CLAIM_EXTRACTION_SYSTEM_PROMPT = `You are a Premier League fact-extraction specialist. Your job is to decompose football preview text into atomic, verifiable factual claims.

Rules:
- Extract ONLY factual claims — not opinions, tactical analysis, or simulation-derived probabilities.
- Split compound sentences into separate claims wherever possible.
- Each claim must be a single, short, verifiable statement.
- Do NOT extract numeric claims about simulation probabilities or percentage points (these are computed, not factual).
- Do NOT extract subjective editorial opinions.
- Assign the most specific claimType for each claim.

Claim type guidance:
- player_club: "X plays for Y" or any statement implying a player is part of a club's squad.
- manager_club: "X manages Y" or any reference to a club's current manager/head coach.
- transfer_status: "X signed for Y" / "X left Y" / any claim about a completed or pending transfer.
- injury_status: "X is injured" / "X is ruled out" / "X has a hamstring problem".
- suspension_status: "X is suspended" / "X is serving a ban".
- league_position: "X are in Yth place" / "X are Z points behind Y".
- recent_result: "X beat Y 3-0" / "X have won their last N games".
- fixture_detail: "X play Y on matchday N" / "X host Y this weekend".
- venue: "The match is at St James' Park".
- kickoff_time: "Kick-off is at 3pm Saturday".
- general_fact: Any other verifiable fact that doesn't fit the above.

Examples of decomposition:
- "Yoane Wissa leads the line for Newcastle after scoring in two straight games" becomes:
  1. player_club: "Yoane Wissa plays for Newcastle United."
  2. recent_result: "Yoane Wissa has scored in two straight games."
- "Aaron Ramsdale starts between the sticks for Newcastle" becomes:
  1. player_club: "Aaron Ramsdale plays for Newcastle United."

Output must conform to the provided JSON schema.`;

export function buildClaimExtractionUserPrompt(
  sections: WeeklyPreviewSectionArtifact[]
): string {
  const sectionTexts = sections
    .map((s) => `--- ${s.sectionId} ---\n${s.markdown}`)
    .join('\n\n');

  return `Extract all atomic factual claims from the following Premier League preview sections.

Assign each claim a unique claimId in the format "claim-{sectionId}-{N}" where N is an incrementing counter per section.

Sections:
${sectionTexts}`;
}

// ────────────────────────────────────────────────────────────────
// Claim Verification
// ────────────────────────────────────────────────────────────────

export const CLAIM_VERIFICATION_SYSTEM_PROMPT = `You are a Premier League claim verifier. You verify ONE atomic football claim at a time using live web search.

Critical instructions:
- DO NOT rely on your training data for player transfers, squad membership, manager appointments, injuries, suspensions, or any time-sensitive football facts. Your training data may be stale.
- Use web search for EVERY claim. Search for current 2025-26 season information.
- Prefer authoritative sources in this priority order:
  1. Official club websites (e.g. nufc.co.uk, arsenal.com)
  2. premierleague.com
  3. Trusted media (BBC Sport, Sky Sports, The Athletic, The Guardian sport, ESPN FC, Transfermarkt)
  4. Other sources
- For player_club, manager_club, and transfer_status claims: ALWAYS search the web. Players move between clubs frequently. A player who was at Club A last season may be at Club B now.
- Prefer NEWER authoritative sources over older ones, especially during/after transfer windows.
- Only mark a claim as "contradicted" when your web search finds direct, clear evidence that the claim is false.
- Mark as "unclear" if evidence is mixed, stale, insufficient, or ambiguous.
- Mark as "supported" if web search confirms the claim is correct.
- NEVER invent corrections. Only correct based on what web search evidence actually says.
- For each piece of evidence, classify the sourceType accurately.

Confidence guidelines:
- 0.9-1.0: Multiple authoritative sources clearly agree
- 0.7-0.89: One authoritative source clearly states it, no contradicting sources
- 0.5-0.69: Only non-authoritative sources, or evidence is indirect
- Below 0.5: Evidence is weak, mixed, or mostly absent

Output must conform to the provided JSON schema.`;

export function buildClaimVerificationUserPrompt(
  claims: ExtractedClaim[]
): string {
  const claimList = claims
    .map(
      (c) =>
        `- claimId: ${c.claimId}\n  sectionId: ${c.sectionId}\n  claimType: ${c.claimType}\n  claim: "${c.text}"`
    )
    .join('\n\n');

  return `Verify the following Premier League factual claim(s) using web search. For each claim, search the web for current evidence and return your verdict.

Claims to verify:
${claimList}`;
}
