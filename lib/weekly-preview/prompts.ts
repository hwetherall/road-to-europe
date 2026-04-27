import type { FactCheckCorrection } from '@/lib/weekly-preview/fact-check-types';
import {
  WEEKLY_PREVIEW_SECTION_ORDER,
  WeeklyPreviewDossier,
  WeeklyPreviewSectionArtifact,
  WeeklyPreviewSectionId,
} from '@/lib/weekly-preview/types';

export function buildSectionSystemPrompt(sectionId: WeeklyPreviewSectionId): string {
  return `You are KeepWatch's ${sectionId} section agent.

Rules:
- Output strict JSON only.
- Never invent facts, injuries, or numbers.
- Only use numbers from the allowedNumericClaims list, and reproduce their formatted strings exactly.
- Keep the tone sharp, editorial, and football-literate.
- Write only your assigned section.

Critical rules:
- NEVER include source reference IDs like [research-1] or [research-5] in the markdown text. Those IDs belong ONLY in the sourceRefs JSON array -- they are internal tracking, not reader-facing citations.
- CROSS-REFERENCE injuries: if a player appears in the clubFactSheet.injuryUpdates, do NOT describe them as available, starting, or part of the expected XI anywhere in the markdown. Injured players must be discussed as absent.
- DO NOT restate facts that prior sections (in handoffNotes) have already established. Treat the reader as having read everything above your section. If a stat has already been introduced, reference it without repeating the number.
- The dossier provides roundsRemaining -- use that exact number. Never calculate rounds remaining yourself.
- Prefer concrete, specific details over vague hedging. If research does not provide a specific player name, injury type, or verifiable detail, omit the claim entirely rather than writing vague prose about unnamed players or unquantifiable impacts.
- Be concise. Every sentence should earn its place by adding new information or a new angle. Cut padding and rhetorical filler.`;
}

function serializedContext(previousSections: WeeklyPreviewSectionArtifact[]) {
  if (previousSections.length === 0) return '[]';
  return JSON.stringify(
    previousSections.map((section) => ({
      sectionId: section.sectionId,
      headline: section.headline,
      markdown: section.markdown,
      handoffNotes: section.handoffNotes,
    })),
    null,
    2
  );
}

function sectionSpecificInstructions(sectionId: WeeklyPreviewSectionId): string {
  switch (sectionId) {
    case 'overview':
      return [
        'Write the opening thesis only. No fresh reporting. 2-3 paragraphs max.',
        'State the Newcastle baseline probability ONCE here -- this is the canonical introduction of that number. Downstream sections must not repeat it.',
        'Use roundsRemaining from the dossier for the number of rounds left.',
      ].join('\n');
    case 'three-contests':
      return [
        'Cover title, Europe, and survival as three subsections. Use only simulation-backed numbers.',
        'This is where contest-specific stats (title odds, survival odds, leverage spreads) are established. Present each contest key numbers once -- later sections should not restate them.',
        'When discussing European qualification leverage, name the fixtures and their spreads but do not repeat the Newcastle baseline (it was already stated in the overview).',
      ].join('\n');
    case 'hot-news':
      return [
        'Select the strongest news items from the hotNewsCandidates -- but ONLY include an item if the research provides specific, concrete details (named players, specific injury types, verifiable facts).',
        'Drop any item where the research is too vague to name specifics. It is better to have 1-2 strong items than 3 weak ones.',
        'Set meta.itemCount to the number you actually include.',
        'Never reference unnamed players (e.g. "a 35m player") -- if you do not have a name, do not include the story.',
      ].join('\n');
    case 'game-of-the-week':
      return [
        'Choose from the gameOfWeekShortlist based on LEVERAGE DATA, not Newcastle sentiment. The game of the week should be the fixture with the highest combined stakes across all three contests (title, Europe, survival).',
        'If Newcastle own fixture is not the top pick, that is fine -- Newcastle match gets its own dedicated section (match-focus). Explain why the chosen fixture matters for Newcastle European race as well.',
        'CRITICAL: cross-reference injuryUpdates before writing about any player. If a player is injured, describe the gap they leave, not their expected contribution.',
      ].join('\n');
    case 'club-focus':
      return [
        'This section owns NEWCASTLE INTERNALLY -- the squad, the shape, the personnel decisions. Do not discuss the opponent here.',
        'Cover: (1) who is out and why, (2) what tactical shape the absences force, (3) who steps in and what changes about tempo/style, (4) the likely starting XI.',
        'Focus on current-season form and roles, not raw EA ratings. "Tonali has been the midfield anchor all season" beats "Tonali is rated 86."',
        'Do NOT repeat the baseline probability or leverage numbers from earlier sections.',
        'Do NOT preview the opponent -- that belongs entirely in match-focus.',
      ].join('\n');
    case 'match-focus':
      return [
        'This section owns THE OPPONENT and THE MATCHUP. Do not re-describe Newcastle injuries or squad composition -- club-focus already covered that.',
        'Split into Opportunities and Risks, framed entirely around the opponent:',
        'OPPORTUNITIES: Where does the opponent have weaknesses Newcastle can exploit? Use opponent-specific details -- their defensive vulnerabilities, tactical tendencies, recent results that reveal patterns.',
        'RISKS: How will the opponent target Newcastle? Frame through the opponent attacking approach, not by restating Newcastle absences. "Palace will commit bodies forward on set pieces to overload the box" rather than "Botman and Thiaw lack composure."',
        'Reference Newcastle injuries with a single brief nod ("with the reshuffled backline, as covered above") then move on to how the opponent exploits it.',
        'Use specific, verifiable details: recent match results, tactical tendencies, head-to-head angles. Prefer "Mateta scored in their 3-0 Conference League win over Fiorentina" over "Mateta has 82 shooting."',
        'Verify squad data: only discuss players who actually play for that club.',
      ].join('\n');
    case 'perfect-weekend':
      return [
        'List every fixture in the next round with the optimal Newcastle result and the top-7 swing. Use a markdown table.',
        'IMPORTANT: Include the cumulative total -- the perfectWeekendCumulativeDeltaPp claim gives the exact number if every result falls Newcastle way. State the resulting probability explicitly (baseline + cumulative delta).',
        'Set meta.fixtureCount.',
      ].join('\n');
    case 'summary':
      return [
        'Close the preview in 3-5 sentences. Do NOT restate the baseline probability, the injury list, or any statistic already covered.',
        'Synthesise one key takeaway the reader should carry into the weekend. What is the single most important thing to watch? End with forward momentum, not repetition.',
      ].join('\n');
    default:
      return '';
  }
}

export function buildSectionUserPrompt(input: {
  dossier: WeeklyPreviewDossier;
  sectionId: WeeklyPreviewSectionId;
  previousSections: WeeklyPreviewSectionArtifact[];
  retryNote?: string;
}): string {
  const { dossier, sectionId, previousSections, retryNote } = input;

  return `Section order:
${WEEKLY_PREVIEW_SECTION_ORDER.join(' -> ')}

Current section:
${sectionId}

Shared dossier:
${JSON.stringify(
  {
    club: dossier.club,
    season: dossier.season,
    matchday: dossier.matchday,
    roundsRemaining: dossier.roundsRemaining,
    selectedClubBaseline: {
      top7Pct: dossier.selectedClubBaseline.top7Pct,
      avgPoints: dossier.selectedClubBaseline.avgPoints,
      avgPosition: dossier.selectedClubBaseline.avgPosition,
    },
    contestSnapshots: dossier.contestSnapshots,
    hotNewsCandidates: dossier.hotNewsCandidates,
    gameOfWeekShortlist: dossier.gameOfWeekShortlist,
    gameOfWeekResearch: dossier.gameOfWeekResearch,
    clubFactSheet: dossier.clubFactSheet,
    squadProfiles: dossier.squadProfiles,
    selectedClubFixture: dossier.selectedClubFixture,
    perfectWeekend: dossier.perfectWeekend,
    perfectWeekendCumulativeDeltaPp: dossier.perfectWeekendCumulativeDeltaPp,
    approvedStorylines: dossier.approvedStorylines,
    warnings: dossier.warnings,
    sources: dossier.sources,
  },
  null,
  2
)}

Allowed numeric claims:
${JSON.stringify(dossier.allowedNumericClaimsBySection[sectionId] ?? [], null, 2)}

Prior section outputs:
${serializedContext(previousSections)}

Return JSON in this shape:
{
  "sectionId": "${sectionId}",
  "headline": "string",
  "markdown": "string",
  "factsUsed": ["string"],
  "newFacts": ["string"],
  "numericClaimIds": ["claim-id"],
  "sourceRefs": ["source-id"],
  "handoffNotes": ["string"],
  "meta": { "itemCount": 0, "fixtureCount": 0 }
}

Additional section instructions:
${sectionSpecificInstructions(sectionId)}
${retryNote ? `\n\nRetry correction:\n${retryNote}` : ''}
`;
}

export function buildFinalEditorPrompt(input: {
  dossier: WeeklyPreviewDossier;
  sections: WeeklyPreviewSectionArtifact[];
  factCheckCorrections?: FactCheckCorrection[];
}): string {
  const injuryUpdates = input.dossier.clubFactSheet?.injuryUpdates ?? [];
  const corrections = input.factCheckCorrections ?? [];

  let factCheckBlock = '';
  if (corrections.length > 0) {
    const correctionDetails = corrections.map((c) => {
      const evidenceSummary = c.evidence
        .map((e) => `  - [${e.sourceType}] ${e.title}: ${e.supports} (${e.url})`)
        .join('\n');
      return `• Section "${c.sectionId}" (severity: ${c.severity}, confidence: ${c.confidence.toFixed(2)}):\n  Claim: ${c.claim}\n  Correction: ${c.correction}\n  Evidence:\n${evidenceSummary}`;
    });

    factCheckBlock = `\n0. FACT-CHECK CORRECTIONS (HIGHEST PRIORITY): A claim-level fact-checker has identified the following errors, each backed by live web evidence. Fix ALL of them by rewriting the affected passages:\n\n${correctionDetails.join('\n\n')}\n`;
  }

  return `You are KeepWatch's final editor. Your job is to catch and fix specific quality issues.

CHECK FOR THESE ISSUES AND FIX THEM:
${factCheckBlock}
1. CONSISTENCY: Cross-reference injury updates below against all section markdown. If any section describes an injured player as available, starting, or contributing on the pitch, rewrite that passage to reflect their absence.

Injury updates from research:
${JSON.stringify(injuryUpdates, null, 2)}

2. REPETITION: The Newcastle baseline probability should appear in at most 2 sections (overview and one other). If it appears more often, remove the repetitions from later sections -- rephrase to reference it without restating the number. Similarly, if the same injury news appears in more than 2 sections, trim the later mentions to brief references.

3. SOURCE REFS IN TEXT: Remove any [research-N] patterns from the markdown. These are internal IDs, not reader-facing citations.

4. VAGUENESS: Remove or rewrite sentences that reference unnamed players (e.g. "a 35m player"), unverifiable rumours, or hedged claims with no concrete detail.

5. ROUNDS REMAINING: The dossier says roundsRemaining = ${input.dossier.roundsRemaining}. Fix any section that states a different number.

Rules:
- Do not add new facts or new analysis.
- Do not change any number or formatted percentage string.
- Preserve section order, section ids, and all JSON fields (factsUsed, numericClaimIds, sourceRefs, handoffNotes, meta).
- CRITICAL: NEVER modify or empty the sourceRefs arrays. Check #3 above ("SOURCE REFS IN TEXT") means remove [research-N] patterns from the markdown field only — the sourceRefs JSON array must remain exactly as provided.
- Output strict JSON as { "sections": WeeklyPreviewSectionArtifact[] }.
- You MUST output ALL 8 sections in full, even those you did not edit.

Sections to edit:
${JSON.stringify(input.sections, null, 2)}`;
}
