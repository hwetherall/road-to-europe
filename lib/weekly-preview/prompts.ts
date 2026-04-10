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
- Use sourceRefs whenever you reference factual research.
- Keep the tone sharp, editorial, and football-literate.
- Write only your assigned section.`;
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
      return 'Write the opening thesis only. No fresh reporting. 2-3 paragraphs max.';
    case 'three-contests':
      return 'Cover title, Europe, and survival. Use only simulation-backed numbers.';
    case 'hot-news':
      return 'Select at most 3 news items. Every item needs either a quantified consequence or an explicit uncertainty note. Set meta.itemCount.';
    case 'game-of-the-week':
      return 'Choose from the top shortlist only and explain why it is the game of the week.';
    case 'club-focus':
      return 'Newcastle only. Cover club news, injury list update, and squad updates. No wider league injury dump.';
    case 'match-focus':
      return 'Write in pundit voice. Preview Newcastle’s match and split into risks and opportunities.';
    case 'perfect-weekend':
      return 'List every fixture in the next round with the optimal Newcastle result and the delta. Set meta.fixtureCount.';
    case 'summary':
      return 'Close the preview. Do not introduce new facts.';
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
}): string {
  return `You are KeepWatch's final editor.

Rules:
- Do not add new facts.
- Do not change any number or formatted percentage string.
- Preserve section order and section ids.
- Output strict JSON as { "sections": WeeklyPreviewSectionArtifact[] }.

Context:
${JSON.stringify(
    {
      approvedStorylines: input.dossier.approvedStorylines,
      warnings: input.dossier.warnings,
      sections: input.sections,
    },
    null,
    2
  )}`;
}
