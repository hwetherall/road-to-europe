import { randomUUID } from 'crypto';
import { callOpenRouter } from '@/lib/openrouter';
import { buildRoundupDossier } from '@/lib/weekly-roundup/dossier';
import { buildRoundupResearchBundle } from '@/lib/weekly-roundup/research';
import { upsertWeeklyRoundupDraft } from '@/lib/weekly-roundup/cache';
import {
  buildRoundupSectionSystemPrompt,
  buildRoundupSectionUserPrompt,
  buildRoundupEditorPrompt,
} from '@/lib/weekly-roundup/prompts';
import {
  validateRoundupSections,
  validateRoundupSingleSection,
} from '@/lib/weekly-roundup/validators';
import {
  PerfectWeekendGrade,
  ProbabilityShift,
  WEEKLY_ROUNDUP_SECTION_ORDER,
  WEEKLY_ROUNDUP_VERSION,
  RoundupDraft,
  RoundupSectionArtifact,
  WeeklyRoundupSectionId,
} from '@/lib/weekly-roundup/types';

const SECTION_MODEL = 'anthropic/claude-sonnet-4-6';
const EDITOR_MODEL = 'anthropic/claude-opus-4-6';

// ── Parsing Helpers ──

function parseSection(content: string): RoundupSectionArtifact {
  const cleaned = content.trim();
  const fenced = cleaned.match(/```json\s*([\s\S]*?)\s*```/);
  return JSON.parse((fenced ? fenced[1] : cleaned).trim()) as RoundupSectionArtifact;
}

function parseJsonPayload<T>(content: string): T {
  const cleaned = content.trim();
  const fenced = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = (fenced ? fenced[1] : cleaned).trim();

  try {
    return JSON.parse(candidate) as T;
  } catch {
    const objectMatch = candidate.match(/\{[\s\S]*\}/);
    if (objectMatch) {
      return JSON.parse(objectMatch[0]) as T;
    }
    throw new SyntaxError(`Unable to parse JSON payload: ${cleaned.slice(0, 200)}`);
  }
}

// ── Markdown Assembly ──

function buildFinalMarkdown(sections: RoundupSectionArtifact[]): string {
  return sections
    .map((section, index) => `## ${index + 1}. ${section.headline}\n\n${section.markdown}`)
    .join('\n\n');
}

// ── Shift Table Injection ──

function pct(value: number): string {
  return `${value.toFixed(1)}%`;
}

function pp(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}pp`;
}

type ShiftTableSpec = {
  label: string;
  preLabel: string;
  postLabel: string;
  preValue: (s: ProbabilityShift) => number;
  postValue: (s: ProbabilityShift) => number;
  deltaValue: (s: ProbabilityShift) => number;
  filter: (s: ProbabilityShift) => boolean;
};

function buildSingleShiftTable(shifts: ProbabilityShift[], spec: ShiftTableSpec): string {
  const filtered = shifts
    .filter(spec.filter)
    .slice()
    .sort((a, b) => Math.abs(spec.deltaValue(b)) - Math.abs(spec.deltaValue(a)));

  if (filtered.length === 0) return '';

  const header = `| Team | ${spec.preLabel} | ${spec.postLabel} | \u0394 |`;
  const divider = '|------|-----------|------------|-----|';
  const rows = filtered.map(
    (s) =>
      `| ${s.team} | ${pct(spec.preValue(s))} | ${pct(spec.postValue(s))} | ${pp(spec.deltaValue(s))} |`
  );

  return `${spec.label}\n\n${header}\n${divider}\n${rows.join('\n')}`;
}

function buildShiftTablesMarkdown(shifts: ProbabilityShift[]): string {
  const titleSpec: ShiftTableSpec = {
    label: '\ud83c\udfc6 Title Race',
    preLabel: 'Pre Title',
    postLabel: 'Post Title',
    preValue: (s) => s.preRound.championPct,
    postValue: (s) => s.postRound.championPct,
    deltaValue: (s) => s.delta.championPct,
    filter: (s) =>
      Math.abs(s.delta.championPct) > 0.5 ||
      s.preRound.championPct > 5 ||
      s.postRound.championPct > 5,
  };

  const europeSpec: ShiftTableSpec = {
    label: '\ud83c\uddea\ud83c\uddfa European Places',
    preLabel: 'Pre Top 7',
    postLabel: 'Post Top 7',
    preValue: (s) => s.preRound.top7Pct,
    postValue: (s) => s.postRound.top7Pct,
    deltaValue: (s) => s.delta.top7Pct,
    filter: (s) =>
      // Exclude teams already guaranteed top-7 (both pre and post round to 100.0%)
      // \u2014 they add no signal. Symmetric to the relegation filter\u2019s 0.0% \u2192 0.0% drop.
      (s.preRound.top7Pct < 99.5 || s.postRound.top7Pct < 99.5) &&
      // AND must have meaningful movement OR be in the live European picture
      (Math.abs(s.delta.top7Pct) > 1.0 ||
        s.preRound.top7Pct > 5 ||
        s.postRound.top7Pct > 5),
  };

  const relegationSpec: ShiftTableSpec = {
    label: '\u2b07\ufe0f Relegation Battle',
    preLabel: 'Pre Survival',
    postLabel: 'Post Survival',
    preValue: (s) => s.preRound.survivalPct,
    postValue: (s) => s.postRound.survivalPct,
    deltaValue: (s) => s.delta.survivalPct,
    filter: (s) =>
      // Must have non-trivial survival probability in at least one snapshot
      // (drops teams sitting at 0.0% \u2192 0.0% \u2014 already-doomed dead weight)
      (s.preRound.survivalPct > 0.5 || s.postRound.survivalPct > 0.5) &&
      // AND must have meaningful movement OR be in genuine danger
      // (drops teams at 100% \u2192 100% \u2014 never in danger)
      (Math.abs(s.delta.survivalPct) > 0.5 ||
        s.preRound.survivalPct < 95 ||
        s.postRound.survivalPct < 95),
  };

  const tables = [
    buildSingleShiftTable(shifts, titleSpec),
    buildSingleShiftTable(shifts, europeSpec),
    buildSingleShiftTable(shifts, relegationSpec),
  ].filter((t) => t.length > 0);

  if (tables.length === 0) return '';
  return `\n\n${tables.join('\n\n')}`;
}

function injectShiftTable(
  sections: RoundupSectionArtifact[],
  shifts: ProbabilityShift[]
): RoundupSectionArtifact[] {
  const tableMarkdown = buildShiftTablesMarkdown(shifts);
  if (!tableMarkdown) return sections;

  return sections.map((section) => {
    if (section.sectionId !== 'the-shift') return section;
    return {
      ...section,
      markdown: section.markdown + tableMarkdown,
    };
  });
}

// ── Perfect Weekend Table Injection ──

function buildPerfectWeekendTableMarkdown(grades: PerfectWeekendGrade[]): string {
  if (grades.length === 0) return '';

  const header = '| Fixture | Newcastle Needed | Actual | \u2713/\u2717 | Predicted Swing |';
  const divider = '|---------|-----------------|--------|-----|-----------------|';

  const rows = grades.map((g) => {
    const fixture = `${g.homeTeam} vs ${g.awayTeam}`;
    const needed = g.predictedResultLabel;
    const actual = `${g.homeTeam} ${g.actualScore} ${g.awayTeam}`;
    const tick = g.correct ? '\u2713' : '\u2717';
    const swing = pp(g.predictedSwingPp);
    return `| ${fixture} | ${needed} | ${actual} | ${tick} | ${swing} |`;
  });

  return `\n\n${header}\n${divider}\n${rows.join('\n')}`;
}

function injectPerfectWeekendTable(
  sections: RoundupSectionArtifact[],
  grades: PerfectWeekendGrade[]
): RoundupSectionArtifact[] {
  const tableMarkdown = buildPerfectWeekendTableMarkdown(grades);
  if (!tableMarkdown) return sections;

  return sections.map((section) => {
    if (section.sectionId !== 'perfect-weekend') return section;
    return {
      ...section,
      markdown: section.markdown + tableMarkdown,
    };
  });
}

// ── Section Agent ──

async function runRoundupSectionAgent(
  sectionId: WeeklyRoundupSectionId,
  dossier: Awaited<ReturnType<typeof buildRoundupDossier>>,
  previousSections: RoundupSectionArtifact[]
): Promise<RoundupSectionArtifact> {
  let retryNote: string | undefined;

  for (let attempt = 0; attempt < 3; attempt++) {
    const message = await callOpenRouter(
      [
        { role: 'system', content: buildRoundupSectionSystemPrompt(sectionId) },
        {
          role: 'user',
          content: buildRoundupSectionUserPrompt({ dossier, sectionId, previousSections, retryNote }),
        },
      ],
      {
        model: SECTION_MODEL,
        maxTokens: 22000,
      }
    );

    const section = parseSection(message.content ?? '');

    try {
      validateRoundupSingleSection(dossier, section);
      return section;
    } catch (error) {
      retryNote = `Your previous output failed validation: ${
        error instanceof Error ? error.message : String(error)
      }. Rewrite the section and ensure sourceRefs are included for newcastle-deep-dive and rapid-round sections.`;
      if (attempt === 2) throw error;
    }
  }

  throw new Error(`Unable to generate valid section for ${sectionId}.`);
}

// ── Main Orchestrator ──

export async function generateWeeklyRoundupDraft(input: {
  matchday: number;
}): Promise<{ persisted: boolean; draft: RoundupDraft }> {
  const startTime = Date.now();

  // ── Phase R: Results + Simulation ──
  console.log(`[weekly-roundup] Phase R: building dossier for matchday ${input.matchday}...`);
  const dossier = await buildRoundupDossier(input.matchday);
  console.log(
    `[weekly-roundup] Phase R complete: ${dossier.results.length} results, ${dossier.probabilityShifts.length} shifts`
  );

  // ── Phase S: Research ──
  console.log('[weekly-roundup] Phase S: building research bundle...');
  const researchBundle = await buildRoundupResearchBundle(dossier);
  dossier.researchBundle = researchBundle;
  dossier.sources = researchBundle.sources;
  console.log(
    `[weekly-roundup] Phase S complete: ${researchBundle.matchResearch.length} match reports, ${researchBundle.sources.length} sources`
  );

  // ── Phase W: Writing ──
  console.log('[weekly-roundup] Phase W: generating sections...');
  const sectionsById = new Map<WeeklyRoundupSectionId, RoundupSectionArtifact>();
  let llmCalls = 0;

  // Wave A (parallel): 3 sections with no dependencies
  const waveAIds: WeeklyRoundupSectionId[] = [
    'three-races',
    'newcastle-deep-dive',
    'rapid-round',
  ];

  const waveA = await Promise.all(
    waveAIds.map(async (sectionId) => {
      const section = await runRoundupSectionAgent(sectionId, dossier, []);
      llmCalls++;
      return section;
    })
  );
  waveA.forEach((s) => sectionsById.set(s.sectionId, s));
  console.log('[weekly-roundup] Wave A complete (3 sections)');

  // Wave B (sequential, sees Wave A): perfect-weekend
  const perfectWeekend = await runRoundupSectionAgent('perfect-weekend', dossier, waveA);
  llmCalls++;
  sectionsById.set(perfectWeekend.sectionId, perfectWeekend);
  console.log('[weekly-roundup] Wave B complete (perfect-weekend)');

  // Wave C (sequential, sees all): the-shift
  const theShift = await runRoundupSectionAgent('the-shift', dossier, [...waveA, perfectWeekend]);
  llmCalls++;
  sectionsById.set(theShift.sectionId, theShift);
  console.log('[weekly-roundup] Wave C complete (the-shift)');

  // Order sections
  const orderedSections = WEEKLY_ROUNDUP_SECTION_ORDER.map((id) => {
    const s = sectionsById.get(id);
    if (!s) throw new Error(`Missing section artifact for ${id}.`);
    return s;
  });

  // Editor pass
  console.log('[weekly-roundup] Running editor pass...');
  const editorMessage = await callOpenRouter(
    [
      { role: 'system', content: 'You are a precise JSON-only editor. Output strict JSON only.' },
      { role: 'user', content: buildRoundupEditorPrompt({ dossier, sections: orderedSections }) },
    ],
    {
      model: EDITOR_MODEL,
      maxTokens: 300000,
    }
  );
  llmCalls++;

  let finalSections = orderedSections;
  try {
    const editorPayload = parseJsonPayload<{
      sections?: RoundupSectionArtifact[];
    }>(editorMessage.content ?? '{}');
    const editorSections = editorPayload.sections ?? orderedSections;
    validateRoundupSections(dossier, editorSections);
    finalSections = editorSections;
    console.log('[weekly-roundup] Editor pass accepted');
  } catch (error) {
    console.warn(
      '[weekly-roundup] Editor output failed validation, falling back to section-agent output:',
      error instanceof Error ? error.message : error
    );
  }

  // Inject programmatic tables (rendered server-side for accuracy)
  finalSections = injectShiftTable(finalSections, dossier.probabilityShifts);
  finalSections = injectPerfectWeekendTable(finalSections, dossier.perfectWeekendGrades);

  // Assemble draft
  const wallClockTimeMs = Date.now() - startTime;
  const draft: RoundupDraft = {
    id: randomUUID(),
    version: WEEKLY_ROUNDUP_VERSION,
    season: dossier.season,
    matchday: dossier.matchday,
    club: dossier.club,
    status: 'draft',
    generatedAt: Date.now(),
    markdown: buildFinalMarkdown(finalSections),
    dossier,
    sections: finalSections,
    sources: dossier.sources,
    warnings: dossier.warnings,
    metadata: {
      llmCalls,
      webSearches: researchBundle.sources.length,
      editorCalls: 1,
      model: `sections=${SECTION_MODEL}, editor=${EDITOR_MODEL}`,
      wallClockTimeMs,
    },
  };

  console.log(
    `[weekly-roundup] Draft assembled: ${llmCalls} LLM calls, ${researchBundle.sources.length} searches, ${wallClockTimeMs}ms`
  );

  const persisted = await upsertWeeklyRoundupDraft(draft);
  return persisted;
}
