import {
  WEEKLY_ROUNDUP_SECTION_ORDER,
  RoundupDossier,
  RoundupSectionArtifact,
  WeeklyRoundupSectionId,
} from '@/lib/weekly-roundup/types';

export function buildRoundupSectionSystemPrompt(sectionId: WeeklyRoundupSectionId): string {
  return `You are KeepWatch's Weekly Roundup ${sectionId} section agent.

Rules:
- Output strict JSON only.
- Never invent facts, scores, scorers, or match events. Only use information provided in the dossier and research data.
- You are writing about events that HAVE HAPPENED. Use past tense for match events. Use present tense for table positions and probability states ("Newcastle now sit at 11.2%").
- Keep the tone sharp, editorial, and football-literate — Sky Sports Monday Night Football energy.
- Write only your assigned section.

Critical rules:
- NEVER include source reference IDs like [roundup-research-1] in the markdown text. Those IDs belong ONLY in the sourceRefs JSON array.
- NEVER use "as we predicted" or "as the model expected" language. The Preview is not a prediction engine — it is a probability framework. Say "the simulation flagged this as the highest-leverage fixture" not "we predicted this would be important."
- When referencing the Preview's predictions, be specific: "The Preview identified Crystal Palace vs Newcastle as a +5.4pp swing. The actual swing was +3.1pp — the direction was right, the magnitude overstated." Do not vaguely say "as predicted" or "as expected."
- Goal scorers are extracted from match reports, not from a verified statistical source. Use them in narrative but do not build statistical claims around them.
- DO NOT restate facts that prior sections (in handoffNotes) have already established.
- The dossier provides roundsRemaining — use that exact number.
- Target ~2,500 words total across all 6 sections. Be concise.
- One punchy line per section maximum. The Roundup should feel measured, not breathless.
- Be concise. Every sentence should earn its place.`;
}

function serializedContext(previousSections: RoundupSectionArtifact[]) {
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

function sectionSpecificInstructions(sectionId: WeeklyRoundupSectionId): string {
  switch (sectionId) {
    case 'the-shift':
      return [
        'Write a 2-3 sentence framing paragraph ONLY. Do NOT reproduce the data table — it will be injected separately.',
        'Name the single biggest mover in each race (title, Europe, relegation).',
        'State the matchday number and rounds remaining.',
        'One sentence on overall volatility ("a quiet round for the title, chaos at the bottom").',
        'The data table will be appended to your markdown automatically — do not create one.',
      ].join('\n');
    case 'preview-scorecard':
      return [
        'Grade the Preview Perfect Weekend table. State how many of the optimal results actually landed.',
        'Grade the Game of the Week pick — was it the right call? Did the leverage materialise as the Preview flagged?',
        'Name the single largest actual probability swing this round and whether the Preview anticipated it.',
        'Tone: honest, not defensive. If the model got things wrong, say so directly. Credibility comes from transparency.',
        'Reference specific numbers from the Preview (baseline, predicted swings) and compare to actuals.',
      ].join('\n');
    case 'three-races':
      return [
        'Cover title, Europe, and survival as three subsections, each 2-4 paragraphs.',
        'Use probability numbers, not just results, to tell the story. Reference pre-round and post-round figures.',
        'Reference the target club (Newcastle) position in the European race even though the deep dive covers it separately.',
        'European qualification should typically get the most space — it is the most volatile race.',
        'For relegation, the writing can be slightly more dramatic (but calibrated). Name who moved into/out of danger.',
      ].join('\n');
    case 'newcastle-deep-dive':
      return [
        'Cover in 4-5 paragraphs:',
        '(1) Result and match narrative — score, scorers from research, the shape of the game. Did the Preview tactical predictions play out?',
        '(2) Probability impact — pre-round number, post-round number, delta. Compare to what the Preview predicted the swing would be.',
        '(3) Season context — where does this leave Newcastle with N rounds remaining? Is the European race alive, narrowing, or over?',
        '(4) Looking ahead — one or two sentences on the next fixture.',
        'Be specific and opinionated. Not "Newcastle played well" — instead name the player and the mechanism.',
        'Do not restate facts already established in three-races.',
      ].join('\n');
    case 'result-that-changed':
      return [
        'State the result and why it matters — which races it impacted.',
        'Name 2-3 teams whose odds shifted significantly because of this one result. Use the topAffectedTeams data.',
        'Explain the cascade mechanism — why one result ripples through the table.',
        'Keep to 2-3 paragraphs.',
      ].join('\n');
    case 'rapid-round':
      return [
        'Cover every fixture NOT deep-dived in the newcastle-deep-dive or result-that-changed sections.',
        'Order by descending probability impact, not kick-off time.',
        'Format: **Home X-X Away** (scorers if available from research) — 1-2 sentence commentary.',
        'Set meta.fixtureCount to the number of fixtures covered.',
        'Punchy and economical. Think live-blog captions, not analysis.',
      ].join('\n');
    default:
      return '';
  }
}

function buildDossierSlice(dossier: RoundupDossier, sectionId: WeeklyRoundupSectionId) {
  const base = {
    club: dossier.club,
    season: dossier.season,
    matchday: dossier.matchday,
    roundsRemaining: dossier.roundsRemaining,
  };

  // Filter shifts to those with meaningful movement
  const significantShifts = dossier.probabilityShifts.filter(
    (s) =>
      Math.abs(s.delta.championPct) > 0.5 ||
      Math.abs(s.delta.top4Pct) > 0.5 ||
      Math.abs(s.delta.top7Pct) > 0.5 ||
      Math.abs(s.delta.survivalPct) > 0.5
  );

  switch (sectionId) {
    case 'the-shift':
      return {
        ...base,
        probabilityShifts: significantShifts,
        results: dossier.results.map((r) => ({
          homeTeam: r.homeTeam,
          awayTeam: r.awayTeam,
          homeGoals: r.homeGoals,
          awayGoals: r.awayGoals,
        })),
      };

    case 'preview-scorecard':
      return {
        ...base,
        perfectWeekendGrades: dossier.perfectWeekendGrades,
        perfectWeekendHitRate: dossier.perfectWeekendHitRate,
        perfectWeekendActualCorrect: dossier.perfectWeekendActualCorrect,
        perfectWeekendTotal: dossier.perfectWeekendTotal,
        previousPreview: {
          gameOfWeekTeams: dossier.previousPreview.gameOfWeekTeams,
          clubBaselineTop7Pct: dossier.previousPreview.clubBaselineTop7Pct,
          perfectWeekendCumulativeDeltaPp: dossier.previousPreview.perfectWeekendCumulativeDeltaPp,
          contestSnapshots: dossier.previousPreview.contestSnapshots,
        },
        targetClubPreTop7Pct: dossier.targetClubPreTop7Pct,
        targetClubPostTop7Pct: dossier.targetClubPostTop7Pct,
        targetClubDeltaTop7Pp: dossier.targetClubDeltaTop7Pp,
        resultThatChanged: {
          homeTeam: dossier.resultThatChanged.homeTeam,
          awayTeam: dossier.resultThatChanged.awayTeam,
          homeGoals: dossier.resultThatChanged.homeGoals,
          awayGoals: dossier.resultThatChanged.awayGoals,
          impactScore: dossier.resultThatChanged.impactScore,
        },
      };

    case 'three-races':
      return {
        ...base,
        probabilityShifts: significantShifts,
        results: dossier.results.map((r) => ({
          homeTeam: r.homeTeam,
          awayTeam: r.awayTeam,
          homeGoals: r.homeGoals,
          awayGoals: r.awayGoals,
        })),
        targetClubPreTop7Pct: dossier.targetClubPreTop7Pct,
        targetClubPostTop7Pct: dossier.targetClubPostTop7Pct,
        targetClubDeltaTop7Pp: dossier.targetClubDeltaTop7Pp,
        matchResearch: dossier.researchBundle.matchResearch
          .filter((r) => r.tier === 'deep' || significantShifts.some(
            (s) => s.team === r.homeTeam || s.team === r.awayTeam
          ))
          .map((r) => ({ homeTeam: r.homeTeam, awayTeam: r.awayTeam, score: r.score, narrativeHook: r.narrativeHook })),
      };

    case 'newcastle-deep-dive':
      return {
        ...base,
        targetClubResult: dossier.targetClubResult,
        targetClubPreTop7Pct: dossier.targetClubPreTop7Pct,
        targetClubPostTop7Pct: dossier.targetClubPostTop7Pct,
        targetClubDeltaTop7Pp: dossier.targetClubDeltaTop7Pp,
        previousPreview: {
          clubBaselineTop7Pct: dossier.previousPreview.clubBaselineTop7Pct,
          clubFixtureId: dossier.previousPreview.clubFixtureId,
          contestSnapshots: { europe: dossier.previousPreview.contestSnapshots.europe },
        },
        matchResearch: dossier.researchBundle.matchResearch.filter(
          (r) => r.homeTeam === 'NEW' || r.awayTeam === 'NEW'
        ),
      };

    case 'result-that-changed':
      return {
        ...base,
        resultThatChanged: dossier.resultThatChanged,
        matchResearch: dossier.researchBundle.matchResearch.filter(
          (r) => r.fixtureId === dossier.resultThatChanged.fixtureId
        ),
        relevantShifts: dossier.probabilityShifts.filter((s) =>
          dossier.resultThatChanged.topAffectedTeams.some((t) => t.team === s.team)
        ),
      };

    case 'rapid-round': {
      // Exclude fixtures covered in deep dives
      const deepDiveFixtureIds = new Set<string>();
      if (dossier.targetClubResult) deepDiveFixtureIds.add(dossier.targetClubResult.fixtureId);
      deepDiveFixtureIds.add(dossier.resultThatChanged.fixtureId);

      const rapidResults = dossier.results
        .filter((r) => !deepDiveFixtureIds.has(r.fixtureId))
        .map((r) => {
          const research = dossier.researchBundle.matchResearch.find(
            (mr) => mr.fixtureId === r.fixtureId
          );
          const homeShift = dossier.probabilityShifts.find((s) => s.team === r.homeTeam);
          const awayShift = dossier.probabilityShifts.find((s) => s.team === r.awayTeam);
          const impact =
            (homeShift ? Math.abs(homeShift.delta.top7Pct) + Math.abs(homeShift.delta.survivalPct) : 0) +
            (awayShift ? Math.abs(awayShift.delta.top7Pct) + Math.abs(awayShift.delta.survivalPct) : 0);

          return {
            homeTeam: r.homeTeam,
            awayTeam: r.awayTeam,
            homeGoals: r.homeGoals,
            awayGoals: r.awayGoals,
            impact,
            narrativeHook: research?.narrativeHook ?? '',
            scorers: research?.scorers ?? 'scorers not confirmed',
            sourceRefIds: research?.sourceRefIds ?? [],
          };
        })
        .sort((a, b) => b.impact - a.impact);

      return { ...base, fixtures: rapidResults };
    }

    default:
      return base;
  }
}

export function buildRoundupSectionUserPrompt(input: {
  dossier: RoundupDossier;
  sectionId: WeeklyRoundupSectionId;
  previousSections: RoundupSectionArtifact[];
  retryNote?: string;
}): string {
  const { dossier, sectionId, previousSections, retryNote } = input;

  return `Section order:
${WEEKLY_ROUNDUP_SECTION_ORDER.join(' -> ')}

Current section:
${sectionId}

Dossier data for this section:
${JSON.stringify(buildDossierSlice(dossier, sectionId), null, 2)}

Prior section outputs:
${serializedContext(previousSections)}

Return JSON in this shape:
{
  "sectionId": "${sectionId}",
  "headline": "string",
  "markdown": "string",
  "sourceRefs": ["source-id"],
  "handoffNotes": ["string"],
  "meta": { "fixtureCount": 0, "hitRate": 0 }
}

Additional section instructions:
${sectionSpecificInstructions(sectionId)}
${retryNote ? `\n\nRetry correction:\n${retryNote}` : ''}
`;
}

export function buildRoundupEditorPrompt(input: {
  dossier: RoundupDossier;
  sections: RoundupSectionArtifact[];
}): string {
  const resultsSummary = input.dossier.results.map(
    (r) => `${r.homeTeam} ${r.homeGoals}-${r.awayGoals} ${r.awayTeam}`
  );

  return `You are KeepWatch's Weekly Roundup editor. Your job is to catch and fix specific quality issues.

CHECK FOR THESE ISSUES AND FIX THEM:

1. TENSE CONSISTENCY: Match events must use past tense. Table positions and probability states must use present tense. Fix any mismatches.

2. REPETITION: Newcastle's probability figures should appear in at most 2 sections. If the same number appears in more than 2 sections, remove the repetition from later sections.

3. SOURCE REFS IN TEXT: Remove any [roundup-research-N] patterns from the markdown. These are internal IDs, not reader-facing citations.

4. ROUNDS REMAINING: The dossier says roundsRemaining = ${input.dossier.roundsRemaining}. Fix any section that states a different number.

5. SCORE ACCURACY: Cross-reference all scores mentioned in the markdown against these actual results:
${resultsSummary.join('\n')}
Fix any incorrect scores.

6. PREDICTION LANGUAGE: Remove any instances of "as we predicted", "as expected", "the model expected". Replace with simulation-framework language ("the simulation flagged", "the Preview identified").

Rules:
- Do not add new facts or new analysis.
- Preserve section order, section ids, and all JSON fields.
- Output strict JSON as { "sections": RoundupSectionArtifact[] }.
- You MUST output ALL 6 sections in full, even those you did not edit.

Sections to edit:
${JSON.stringify(input.sections, null, 2)}`;
}
