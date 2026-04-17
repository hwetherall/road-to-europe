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
- Target ~2,500 words total across all 5 sections. Be concise.
- One punchy line per section maximum. The Roundup should feel measured, not breathless.
- Be concise. Every sentence should earn its place.

MATCHDAY TIMING: Premier League matchdays span multiple days — typically Friday through Monday. NEVER say "in one afternoon", "on the same day", "on a single Saturday" or similar phrasing unless ALL relevant matches genuinely occurred on the same date. Use "across the weekend", "over the matchday", or "in the space of four days" instead. Check the fixture dates in the data before making temporal claims.

NO INTERNAL LANGUAGE: NEVER reference the system's internal data structures, variable names, or pipeline terminology. The reader does not know what a "dossier", "research bundle", "simulation snapshot", "probability shift array", or "tracked club" is. Describe everything in plain football language.

BAD: "Wolves don't appear in the probability dossier as a tracked club"
GOOD: "Wolves look virtually certain to go down"

BAD: "The shift data shows a -5.4pp delta"
GOOD: "Newcastle's European odds fell by 5.4 percentage points"

CROSS-SECTION REDUNDANCY RULE:
Each major probability number should be STATED WITH FULL CONTEXT in exactly one section. Other sections may reference the CONSEQUENCE without repeating the exact figure.

Ownership:
- Target club's pre/post/delta probability (full pre → post context) → Newcastle Deep Dive ONLY
- Other clubs' probability shifts (full pre → post context) → Three Races ONLY
- Perfect Weekend cumulative swing (ideal vs actual) → Perfect Weekend ONLY
- Title race shifts → Three Races ONLY
- Relegation shifts → Three Races ONLY

The Shift overview may name a club as a mover with its delta (e.g. "Newcastle -5.6pp") but should NOT restate the full pre/post context — the tables show that.

Example of what to AVOID:
  Three Races: "Newcastle's top-7 odds fell from 7.8% to 2.2%"
  Deep Dive: "Newcastle's top-7 odds fell from 7.8% to 2.2%"

Example of what to DO:
  Three Races: "Newcastle's European hopes are covered in full below, but in the context of the race, they've been swallowed by the surge from beneath."
  Deep Dive: "Before the round, Newcastle sat at 7.8% for a top-seven finish. The defeat dropped that to 2.2%."`;
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
        'Write a 2-3 sentence framing paragraph ONLY. Do NOT reproduce any data table — three programmatically rendered tables (Title / European / Relegation) will be appended to your markdown automatically.',
        'Name the single biggest mover in each race (one sentence each).',
        'State the matchday number and rounds remaining.',
        'Do NOT write more than 3 sentences. The tables below carry the detail.',
        'No prose framing of the tables themselves — the Three Races section that follows provides all narrative context.',
      ].join('\n');
    case 'perfect-weekend':
      return [
        'PURPOSE: This section compares the Preview\u2019s Perfect Weekend table \u2014 the IDEAL combination of results for Newcastle\u2019s European hopes \u2014 against what actually happened. It is NOT about whether the model "predicted" results correctly. The Perfect Weekend is a wish list, not a prediction.',
        'A programmatic table will be appended to your markdown automatically with columns: Fixture | Newcastle Needed | Actual | \u2713/\u2717 | Predicted Swing. Do NOT write your own table.',
        'Write 2-3 sentences of commentary BEFORE the table will be appended:',
        '  (a) State how many of the N ideal results landed (use perfectWeekendActualCorrect / perfectWeekendTotal).',
        '  (b) Highlight the most damaging miss \u2014 the fixture where the gap between ideal and actual hurt Newcastle most. Use the largest predictedSwingPp on a missed fixture.',
        '  (c) State the cumulative impact: maximum possible swing if everything landed (perfectWeekendCumulativeDeltaPp from the previousPreview) vs the actual top-7 swing for Newcastle (targetClubDeltaTop7Pp).',
        'Frame as: "Newcastle needed X. They got Y. The gap cost them Z." Do NOT frame as "the model predicted X."',
        'Tone: matter-of-fact. No defensiveness. The model does not need to apologise for results going the wrong way.',
        'Do NOT mention "Game of the Week" \u2014 it has no place in this section.',
        '',
        'COMMENTARY FOCUS: Focus on the GAP between ideal and actual cumulative swing. Do NOT restate individual fixture deltas that the table itself displays or that the deep dive covers. Example of the right altitude: "Newcastle needed +8.4pp across the weekend. They got -5.6pp. The gap is 14 percentage points of lost ground." Then stop \u2014 do not walk through each fixture again.',
      ].join('\n');
    case 'three-races':
      return [
        'Cover title, Europe, and survival as three subsections.',
        'Use probability numbers, not just results, to tell the story. Reference pre-round and post-round figures.',
        'Reference the target club (Newcastle) position in the European race at a high level, but do NOT restate the target club\u2019s full pre/post/delta figure \u2014 that belongs exclusively to the deep dive. A single brief mention of direction (e.g. "Newcastle were swallowed from beneath") is enough.',
        'European qualification is the most volatile race but must still be disciplined.',
        'For relegation, the writing can be slightly more dramatic (but calibrated). Name who moved into/out of danger.',
        '',
        'LENGTH GUIDANCE:',
        '- Title Race: 1-2 paragraphs (the race is usually the least complex).',
        '- European Race: 2-3 paragraphs MAXIMUM. Cover the 4-5 biggest movers by name with full pre/post figures. Other teams must be grouped in a single passing sentence (e.g. "Brighton (+10.7pp), Sunderland (+10.2pp), and Bournemouth (+7.9pp) all gained ground") rather than each getting an individual sentence.',
        '- Relegation: 2-3 paragraphs.',
        '- Total Three Races section: ~600-800 words. If you go over 800, cut the European section first \u2014 it tends to sprawl because there are more teams involved.',
        '',
        'CASCADE MECHANISMS: When a single result had cascading effects across multiple teams in a race, explain the MECHANISM \u2014 how the result transmitted through the standings to affect teams that weren\u2019t even playing. This is the most valuable analytical contribution you can make. Example: "Brentford\u2019s draw with Everton didn\u2019t just cost Brentford 2 points \u2014 it compressed the European places enough that Chelsea\u2019s margin above the cutoff shrank by 12.7pp without Chelsea touching a ball."',
        'Use the resultThatChanged data and relevantShifts data to identify the highest-cascade result. Do NOT dedicate more than one paragraph to any single cascade. Weave it into the race narrative rather than stopping the section to explain it separately.',
      ].join('\n');
    case 'newcastle-deep-dive':
      return [
        'Structure the section as:',
        '(1) MATCH NARRATIVE FIRST \u2014 score, scorers, the shape of the game, key moments, how the game flowed. START with the football, not the probability. The matchResearch entry for Newcastle\u2019s match includes a goals[] array from ESPN with scorer, assist, minute, isPenalty, isOwnGoal \u2014 use it. If scorersVerified is TRUE, you may cite scorers and minutes directly. If FALSE, describe the match without naming scorers rather than guessing.',
        '(2) MANDATORY PREVIEW CALLBACK \u2014 The Weekly Preview made specific tactical predictions about this match. The full Preview match-focus markdown is provided in previousPreview.matchFocusMarkdown. You MUST reference at least 3 specific tactical claims from it and grade each one. For each:',
        '   - State what the Preview predicted (briefly, 1 sentence)',
        '   - State what actually happened (1-2 sentences)',
        '   - Grade it: was the prediction borne out, partially correct, or wrong?',
        '   Examples of good grading:',
        '   - "The Preview identified Gordon vs Sosa as the key channel. Gordon was Newcastle\u2019s most dangerous player in the first half, drawing Glasner into an early positional adjustment \u2014 the prediction landed."',
        '   - "The Preview flagged Mateta as the central danger. He was quiet for 88 minutes, then converted the stoppage-time penalty that killed the match. The threat was right; the mechanism was unexpected."',
        '(3) PROBABILITY IMPACT \u2014 pre-round number, post-round number, delta. Compare to what the Preview predicted the swing would be.',
        '(4) LOOKING AHEAD \u2014 EXACTLY 1-2 sentences. You MUST name the next fixture by the opponent\u2019s name and venue (home/away), drawn from targetClubNextFixture in the data. Do NOT write vague phrasing like "Newcastle\u2019s next assignment" or "the next match" \u2014 name the opponent. Do NOT repeat the probability figure or restate the season verdict \u2014 the probability impact section has already delivered that. This is a bridge to next week\u2019s Preview, not a summary of this week\u2019s damage.',
        '   GOOD: "Next up: Newcastle host Burnley on Saturday \u2014 a fixture that should yield three points but can\u2019t undo what Selhurst Park took."',
        '   BAD (vague): "Newcastle\u2019s next assignment will give us a clearer picture of whether this squad has the character to keep pushing."',
        '   BAD (probability restatement): "With six games left and odds at 2.2%, Newcastle need a miracle. The margin for error is gone."',
        '   If targetClubNextFixture is null (no upcoming fixture in the data), fall back to "Six rounds remain" framing without fabricating an opponent.',
        'Be specific and opinionated. Not "Newcastle played well" \u2014 instead name the player and the mechanism.',
        'Do not restate facts already established in three-races.',
      ].join('\n');
    case 'rapid-round':
      return [
        'Cover every fixture NOT covered in the newcastle-deep-dive section.',
        'Order by descending probability impact, not kick-off time.',
        'Format: **Home X-X Away** (scorers if available from research) \u2014 1-2 sentence commentary.',
        'Set meta.fixtureCount to the number of fixtures covered.',
        'Punchy and economical. Think live-blog captions, not analysis.',
        '',
        'SCORER HANDLING: Each fixture carries a scorersVerified boolean. If scorersVerified is TRUE, the scorers field contains a verified list from ESPN (e.g. "Salah 45\u2019, Ngumoha 33\u2019"). You MUST name the scorers \u2014 either in parentheses after the score ("Liverpool 2-0 Fulham (Ngumoha 33\u2019, Salah 45\u2019)") OR by name within the commentary sentence ("Salah and Ngumoha struck in the first half"). DO NOT cite anonymous minutes like "goals at 43 and 89 minutes" when scorer names are verified \u2014 that is a regression. You may drop minutes from the parenthetical if it reads cleaner. If scorersVerified is FALSE, OMIT the parentheses entirely and do NOT reference goal minutes or scorer names \u2014 do NOT guess from research summaries. Do NOT fabricate. Do NOT write "(Unknown)", "(scorers not confirmed)", or any placeholder. Penalties and own goals are tagged in the scorer string as "pen" or "OG" \u2014 preserve those tags.',
        '',
        'LEAGUE POSITION CONTEXT: Each fixture in your data includes both teams\u2019 current league positions and points. Use this to calibrate your commentary. Do NOT describe a top-4 team\u2019s season as "dismal" or "disappointing" \u2014 check the standings before making seasonal judgments. A team in 4th is having a good season even if they lose one match. A team in 18th losing is a crisis. Calibrate accordingly.',
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

    case 'perfect-weekend':
      return {
        ...base,
        perfectWeekendGrades: dossier.perfectWeekendGrades,
        perfectWeekendHitRate: dossier.perfectWeekendHitRate,
        perfectWeekendActualCorrect: dossier.perfectWeekendActualCorrect,
        perfectWeekendTotal: dossier.perfectWeekendTotal,
        previousPreview: {
          clubBaselineTop7Pct: dossier.previousPreview.clubBaselineTop7Pct,
          perfectWeekendCumulativeDeltaPp: dossier.previousPreview.perfectWeekendCumulativeDeltaPp,
        },
        targetClubPreTop7Pct: dossier.targetClubPreTop7Pct,
        targetClubPostTop7Pct: dossier.targetClubPostTop7Pct,
        targetClubDeltaTop7Pp: dossier.targetClubDeltaTop7Pp,
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
        resultThatChanged: dossier.resultThatChanged,
        relevantShifts: dossier.probabilityShifts.filter((s) =>
          dossier.resultThatChanged.topAffectedTeams.some((t) => t.team === s.team)
        ),
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
        targetClubNextFixture: dossier.targetClubNextFixture,
        targetClubPreTop7Pct: dossier.targetClubPreTop7Pct,
        targetClubPostTop7Pct: dossier.targetClubPostTop7Pct,
        targetClubDeltaTop7Pp: dossier.targetClubDeltaTop7Pp,
        previousPreview: {
          clubBaselineTop7Pct: dossier.previousPreview.clubBaselineTop7Pct,
          clubFixtureId: dossier.previousPreview.clubFixtureId,
          contestSnapshots: { europe: dossier.previousPreview.contestSnapshots.europe },
          matchFocusMarkdown: dossier.previousPreview.matchFocusMarkdown,
        },
        matchResearch: dossier.researchBundle.matchResearch.filter(
          (r) => r.homeTeam === 'NEW' || r.awayTeam === 'NEW'
        ),
      };

    case 'rapid-round': {
      // Exclude fixtures covered in the Newcastle deep dive
      const deepDiveFixtureIds = new Set<string>();
      if (dossier.targetClubResult) deepDiveFixtureIds.add(dossier.targetClubResult.fixtureId);

      // Compute current league positions from updated standings
      const ranked = [...dossier.teams].sort((a, b) => {
        if (b.points !== a.points) return b.points - a.points;
        if (b.goalDifference !== a.goalDifference) return b.goalDifference - a.goalDifference;
        return b.goalsFor - a.goalsFor;
      });
      const positionMap = new Map<string, { position: number; points: number }>();
      ranked.forEach((t, idx) => {
        positionMap.set(t.abbr, { position: idx + 1, points: t.points });
      });

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

          const homePos = positionMap.get(r.homeTeam);
          const awayPos = positionMap.get(r.awayTeam);

          return {
            homeTeam: r.homeTeam,
            awayTeam: r.awayTeam,
            homeGoals: r.homeGoals,
            awayGoals: r.awayGoals,
            homePosition: homePos?.position ?? null,
            homePoints: homePos?.points ?? null,
            awayPosition: awayPos?.position ?? null,
            awayPoints: awayPos?.points ?? null,
            impact,
            narrativeHook: research?.narrativeHook ?? '',
            scorers: research?.scorers ?? '',
            scorersVerified: research?.scorersVerified ?? false,
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

CRITICAL: You MUST preserve ALL sourceRefs entries on every section exactly as they appear in the input. Do not remove, renumber, or modify the sourceRefs JSON arrays. The sourceRefs array on newcastle-deep-dive and rapid-round in particular MUST contain at least one entry \u2014 if you drop them, validation will fail and your edits will be discarded.

CHECK FOR THESE ISSUES AND FIX THEM:

1. TENSE CONSISTENCY: Match events must use past tense. Table positions and probability states must use present tense. Fix any mismatches.

2. REPETITION: Newcastle's probability figures should appear in at most 2 sections. If the same number appears in more than 2 sections, remove the repetition from later sections.

3. SOURCE REFS IN TEXT: Remove any [roundup-research-N] patterns from the markdown. These are internal IDs, not reader-facing citations. (BUT keep the sourceRefs JSON array intact \u2014 only strip the bracketed IDs from the prose.)

4. ROUNDS REMAINING: The dossier says roundsRemaining = ${input.dossier.roundsRemaining}. Fix any section that states a different number.

5. SCORE ACCURACY: Cross-reference all scores mentioned in the markdown against these actual results:
${resultsSummary.join('\n')}
Fix any incorrect scores.

6. PREDICTION LANGUAGE: Remove any instances of "as we predicted", "as expected", "the model expected". Replace with simulation-framework language ("the simulation flagged", "the Preview identified").

7. TEMPORAL ACCURACY: Remove any phrasing like "in one afternoon", "on the same day", "on a single Saturday" unless ALL relevant matches actually occurred on that date. Premier League matchdays span Friday\u2013Monday. Use "across the weekend" or "over the matchday" instead.

8. INTERNAL LANGUAGE: Remove any references to "dossier", "research bundle", "simulation snapshot", "probability shift array", "tracked club" or other internal pipeline terminology. The reader does not know what these mean. Use plain football language.

9. ANONYMOUS MINUTES IN RAPID ROUND: If a Rapid Round entry cites goal minutes without naming the scorer (e.g. "goals at 43 and 89 minutes", "Sunderland's goal arriving in the 61st minute", "Forest's goal coming on 38 minutes"), check the fixture's scorers field in the research data. If scorersVerified is TRUE for that fixture, REWRITE the entry to name the scorer(s) \u2014 either in parentheses after the score or by name in the commentary. Anonymous-minute phrasing is a regression when scorer names are verified. If scorersVerified is FALSE, strip the minute references too \u2014 don\u2019t cite half the match event without the player.

Rules:
- Do not add new facts or new analysis.
- Preserve section order, section ids, sourceRefs arrays, handoffNotes, and all other JSON fields.
- Output strict JSON as { "sections": RoundupSectionArtifact[] }.
- You MUST output ALL 5 sections in full, even those you did not edit.

Sections to edit:
${JSON.stringify(input.sections, null, 2)}`;
}
