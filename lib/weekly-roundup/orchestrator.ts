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

function buildShiftTableMarkdown(shifts: ProbabilityShift[]): string {
  // Filter to teams with meaningful movement (|delta| > 0.5pp in any tracked metric)
  const significant = shifts.filter(
    (s) =>
      Math.abs(s.delta.championPct) > 0.5 ||
      Math.abs(s.delta.top4Pct) > 0.5 ||
      Math.abs(s.delta.top7Pct) > 0.5 ||
      Math.abs(s.delta.survivalPct) > 0.5
  );

  if (significant.length === 0) return '';

  // Sort by total absolute movement
  significant.sort((a, b) => {
    const aTotal =
      Math.abs(a.delta.top7Pct) + Math.abs(a.delta.championPct) + Math.abs(a.delta.survivalPct);
    const bTotal =
      Math.abs(b.delta.top7Pct) + Math.abs(b.delta.championPct) + Math.abs(b.delta.survivalPct);
    return bTotal - aTotal;
  });

  const header =
    '| Team | Pre Top 7 | Post Top 7 | \u0394 | Pre Survival | Post Survival | \u0394 |';
  const divider =
    '|------|-----------|------------|-----|-------------|--------------|-----|';

  const rows = significant.map(
    (s) =>
      `| ${s.team} | ${pct(s.preRound.top7Pct)} | ${pct(s.postRound.top7Pct)} | ${pp(s.delta.top7Pct)} | ${pct(s.preRound.survivalPct)} | ${pct(s.postRound.survivalPct)} | ${pp(s.delta.survivalPct)} |`
  );

  return `\n\n${header}\n${divider}\n${rows.join('\n')}`;
}

function injectShiftTable(
  sections: RoundupSectionArtifact[],
  shifts: ProbabilityShift[]
): RoundupSectionArtifact[] {
  const tableMarkdown = buildShiftTableMarkdown(shifts);
  if (!tableMarkdown) return sections;

  return sections.map((section) => {
    if (section.sectionId !== 'the-shift') return section;
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
      }. Rewrite the section and ensure sourceRefs are included for deep-dive, result-that-changed, and rapid-round sections.`;
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

  // Wave A (parallel): 4 sections with no dependencies
  const waveAIds: WeeklyRoundupSectionId[] = [
    'three-races',
    'newcastle-deep-dive',
    'result-that-changed',
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
  console.log('[weekly-roundup] Wave A complete (4 sections)');

  // Wave B (sequential, sees Wave A): preview-scorecard
  const scorecard = await runRoundupSectionAgent('preview-scorecard', dossier, waveA);
  llmCalls++;
  sectionsById.set(scorecard.sectionId, scorecard);
  console.log('[weekly-roundup] Wave B complete (preview-scorecard)');

  // Wave C (sequential, sees all): the-shift
  const theShift = await runRoundupSectionAgent('the-shift', dossier, [...waveA, scorecard]);
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

  // Inject the programmatic shift table into the-shift section
  finalSections = injectShiftTable(finalSections, dossier.probabilityShifts);

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
