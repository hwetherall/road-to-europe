import {
  WEEKLY_PREVIEW_SECTION_ORDER,
  WeeklyPreviewDossier,
  WeeklyPreviewSectionArtifact,
} from '@/lib/weekly-preview/types';

function extractPercentTokens(markdown: string): string[] {
  return markdown.match(/[+-]?\d+(?:\.\d+)?(?:%|pp)/g) ?? [];
}

function extractSourceRefLeaks(markdown: string): string[] {
  return markdown.match(/\[research-\d+\]/g) ?? [];
}

export function validatePerfectWeekend(dossier: WeeklyPreviewDossier): void {
  const fixtureIds = new Set(dossier.nextRoundFixtures.map((fixture) => fixture.id));
  if (dossier.perfectWeekend.length !== fixtureIds.size) {
    throw new Error('Perfect weekend matrix does not cover every fixture in the next round.');
  }

  const covered = new Set(dossier.perfectWeekend.map((entry) => entry.fixtureId));
  if (covered.size !== dossier.perfectWeekend.length) {
    throw new Error('Perfect weekend matrix contains duplicate fixtures.');
  }

  for (const fixtureId of fixtureIds) {
    if (!covered.has(fixtureId)) {
      throw new Error(`Perfect weekend matrix is missing fixture ${fixtureId}.`);
    }
  }
}

export function validateSections(
  dossier: WeeklyPreviewDossier,
  sections: WeeklyPreviewSectionArtifact[]
): void {
  if (sections.length !== WEEKLY_PREVIEW_SECTION_ORDER.length) {
    throw new Error('Weekly preview must contain exactly 8 sections.');
  }

  sections.forEach((section, index) => {
    const expectedId = WEEKLY_PREVIEW_SECTION_ORDER[index];
    if (section.sectionId !== expectedId) {
      throw new Error(`Section order invalid at position ${index + 1}: expected ${expectedId}.`);
    }

    const allowedClaims = dossier.allowedNumericClaimsBySection[section.sectionId] ?? [];
    const allowedById = new Map(allowedClaims.map((claim) => [claim.id, claim]));

    for (const claimId of section.numericClaimIds) {
      if (!allowedById.has(claimId)) {
        throw new Error(`Section ${section.sectionId} used unknown numeric claim ${claimId}.`);
      }
    }

    const allowedTokens = new Set(
      section.numericClaimIds
        .map((claimId) => allowedById.get(claimId)?.formatted)
        .filter((value): value is string => Boolean(value))
    );

    const tokens = extractPercentTokens(section.markdown);
    for (const token of tokens) {
      if (!allowedTokens.has(token)) {
        throw new Error(`Section ${section.sectionId} contains undeclared numeric token ${token}.`);
      }
    }

    const sourceLeaks = extractSourceRefLeaks(section.markdown);
    if (sourceLeaks.length > 0) {
      throw new Error(
        `Section ${section.sectionId} contains source reference IDs in markdown text (${sourceLeaks.join(', ')}). These belong only in the sourceRefs JSON array, not in reader-facing text.`
      );
    }
  });

  const hotNews = sections.find((section) => section.sectionId === 'hot-news');
  if ((hotNews?.meta?.itemCount ?? 0) > 3) {
    throw new Error('Hot news section contains more than 3 items.');
  }

  const requiredSources = ['hot-news', 'game-of-the-week', 'club-focus', 'match-focus'] as const;
  for (const sectionId of requiredSources) {
    const section = sections.find((entry) => entry.sectionId === sectionId);
    if (!section || section.sourceRefs.length === 0) {
      throw new Error(`Section ${sectionId} requires at least one source reference.`);
    }
  }
}

export function validateSingleSection(
  dossier: WeeklyPreviewDossier,
  section: WeeklyPreviewSectionArtifact
): void {
  const placeholders: WeeklyPreviewSectionArtifact[] = [
    {
      sectionId: 'overview',
      headline: 'placeholder',
      markdown: '',
      factsUsed: [],
      newFacts: [],
      numericClaimIds: [],
      sourceRefs: [],
      handoffNotes: [],
      meta: {},
    },
    {
      sectionId: 'three-contests',
      headline: 'placeholder',
      markdown: '',
      factsUsed: [],
      newFacts: [],
      numericClaimIds: [],
      sourceRefs: ['placeholder'],
      handoffNotes: [],
      meta: {},
    },
    {
      sectionId: 'hot-news',
      headline: 'placeholder',
      markdown: '',
      factsUsed: [],
      newFacts: [],
      numericClaimIds: [],
      sourceRefs: ['placeholder'],
      handoffNotes: [],
      meta: { itemCount: 0 },
    },
    {
      sectionId: 'game-of-the-week',
      headline: 'placeholder',
      markdown: '',
      factsUsed: [],
      newFacts: [],
      numericClaimIds: [],
      sourceRefs: ['placeholder'],
      handoffNotes: [],
      meta: {},
    },
    {
      sectionId: 'club-focus',
      headline: 'placeholder',
      markdown: '',
      factsUsed: [],
      newFacts: [],
      numericClaimIds: [],
      sourceRefs: ['placeholder'],
      handoffNotes: [],
      meta: {},
    },
    {
      sectionId: 'match-focus',
      headline: 'placeholder',
      markdown: '',
      factsUsed: [],
      newFacts: [],
      numericClaimIds: [],
      sourceRefs: ['placeholder'],
      handoffNotes: [],
      meta: {},
    },
    {
      sectionId: 'perfect-weekend',
      headline: 'placeholder',
      markdown: '',
      factsUsed: [],
      newFacts: [],
      numericClaimIds: [],
      sourceRefs: [],
      handoffNotes: [],
      meta: { fixtureCount: 0 },
    },
    {
      sectionId: 'summary',
      headline: 'placeholder',
      markdown: '',
      factsUsed: [],
      newFacts: [],
      numericClaimIds: [],
      sourceRefs: [],
      handoffNotes: [],
      meta: {},
    },
  ];

  validateSections(
    dossier,
    placeholders.map((entry) => (entry.sectionId === section.sectionId ? section : entry))
  );
}
