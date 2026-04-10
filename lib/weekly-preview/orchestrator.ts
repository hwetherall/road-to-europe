import { randomUUID } from 'crypto';
import { callOpenRouter } from '@/lib/openrouter';
import { buildWeeklyPreviewDossier } from '@/lib/weekly-preview/dossier';
import { upsertWeeklyPreviewDraft } from '@/lib/weekly-preview/cache';
import { buildFinalEditorPrompt, buildSectionSystemPrompt, buildSectionUserPrompt } from '@/lib/weekly-preview/prompts';
import { validatePerfectWeekend, validateSections, validateSingleSection } from '@/lib/weekly-preview/validators';
import {
  WEEKLY_PREVIEW_SECTION_ORDER,
  WEEKLY_PREVIEW_VERSION,
  WeeklyPreviewDraft,
  WeeklyPreviewSectionArtifact,
  WeeklyPreviewSectionId,
} from '@/lib/weekly-preview/types';

const DEFAULT_MODEL = 'anthropic/claude-opus-4.6';

function parseSection(content: string): WeeklyPreviewSectionArtifact {
  const cleaned = content.trim();
  const fenced = cleaned.match(/```json\s*([\s\S]*?)\s*```/);
  return JSON.parse((fenced ? fenced[1] : cleaned).trim()) as WeeklyPreviewSectionArtifact;
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

function buildFinalMarkdown(sections: WeeklyPreviewSectionArtifact[]): string {
  return sections
    .map((section, index) => `## ${index + 1}. ${section.headline}\n\n${section.markdown}`)
    .join('\n\n');
}

async function runSectionAgent(
  sectionId: WeeklyPreviewSectionId,
  dossier: Awaited<ReturnType<typeof buildWeeklyPreviewDossier>>,
  previousSections: WeeklyPreviewSectionArtifact[]
): Promise<WeeklyPreviewSectionArtifact> {
  let retryNote: string | undefined;

  for (let attempt = 0; attempt < 3; attempt++) {
    const message = await callOpenRouter(
      [
        { role: 'system', content: buildSectionSystemPrompt(sectionId) },
        {
          role: 'user',
          content: buildSectionUserPrompt({ dossier, sectionId, previousSections, retryNote }),
        },
      ],
      {
        model: DEFAULT_MODEL,
        maxTokens: 2200,
      }
    );

    const section = parseSection(message.content ?? '');

    try {
      validateSingleSection(dossier, section);
      return section;
    } catch (error) {
      retryNote = `Your previous output failed validation: ${
        error instanceof Error ? error.message : String(error)
      }. Rewrite the section and use only the explicitly allowed numeric claims and required source refs.`;
      if (attempt === 2) throw error;
    }
  }

  throw new Error(`Unable to generate valid section for ${sectionId}.`);
}

export async function generateWeeklyPreviewDraft(input?: {
  scheduledFor?: Date;
}): Promise<{ persisted: boolean; draft: WeeklyPreviewDraft }> {
  const dossier = await buildWeeklyPreviewDossier();
  validatePerfectWeekend(dossier);

  const sectionsById = new Map<WeeklyPreviewSectionId, WeeklyPreviewSectionArtifact>();
  let llmCalls = 0;

  const waveAIds = [
    'three-contests',
    'hot-news',
    'game-of-the-week',
    'club-focus',
    'perfect-weekend',
  ] as const;

  const waveA = await Promise.all(
    waveAIds.map(async (sectionId) => {
      const section = await runSectionAgent(sectionId, dossier, []);
      llmCalls++;
      return section;
    })
  );
  waveA.forEach((section) => sectionsById.set(section.sectionId, section));

  const matchFocus = await runSectionAgent('match-focus', dossier, waveA);
  llmCalls++;
  sectionsById.set(matchFocus.sectionId, matchFocus);

  const overview = await runSectionAgent('overview', dossier, [...waveA, matchFocus]);
  llmCalls++;
  sectionsById.set(overview.sectionId, overview);

  const summary = await runSectionAgent('summary', dossier, [overview, ...waveA, matchFocus]);
  llmCalls++;
  sectionsById.set(summary.sectionId, summary);

  const orderedSections = WEEKLY_PREVIEW_SECTION_ORDER.map((sectionId) => {
    const section = sectionsById.get(sectionId);
    if (!section) throw new Error(`Missing section artifact for ${sectionId}.`);
    return section;
  });

  const editorMessage = await callOpenRouter(
    [
      { role: 'system', content: 'You are a precise JSON-only editor.' },
      { role: 'user', content: buildFinalEditorPrompt({ dossier, sections: orderedSections }) },
    ],
    {
      model: DEFAULT_MODEL,
      maxTokens: 3200,
    }
  );
  llmCalls++;

  let finalSections = orderedSections;
  try {
    const editorPayload = parseJsonPayload<{
      sections?: WeeklyPreviewSectionArtifact[];
    }>(editorMessage.content ?? '{}');
    finalSections = editorPayload.sections ?? orderedSections;
  } catch (error) {
    console.warn(
      '[weekly-preview] final editor parse failed, falling back to section-agent output:',
      error instanceof Error ? error.message : error
    );
  }
  validateSections(dossier, finalSections);

  const draft: WeeklyPreviewDraft = {
    id: randomUUID(),
    version: WEEKLY_PREVIEW_VERSION,
    season: dossier.season,
    matchday: dossier.matchday,
    club: dossier.club,
    status: 'draft',
    generatedAt: Date.now(),
    scheduledFor: (input?.scheduledFor ?? new Date()).toISOString(),
    markdown: buildFinalMarkdown(finalSections),
    dossier,
    sections: finalSections,
    sources: dossier.sources,
    warnings: dossier.warnings,
    metadata: {
      llmCalls,
      sectionAgentCalls: 8,
      editorCalls: 1,
      model: DEFAULT_MODEL,
    },
  };

  const persisted = await upsertWeeklyPreviewDraft(draft);
  return persisted;
}
