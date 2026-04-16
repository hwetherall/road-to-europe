import {
  WEEKLY_ROUNDUP_SECTION_ORDER,
  RoundupDossier,
  RoundupSectionArtifact,
} from '@/lib/weekly-roundup/types';

function extractSourceRefLeaks(markdown: string): string[] {
  return markdown.match(/\[(?:roundup-)?research-\d+\]/g) ?? [];
}

export function validateRoundupSections(
  dossier: RoundupDossier,
  sections: RoundupSectionArtifact[]
): void {
  if (sections.length !== WEEKLY_ROUNDUP_SECTION_ORDER.length) {
    throw new Error(
      `Weekly roundup must contain exactly ${WEEKLY_ROUNDUP_SECTION_ORDER.length} sections, got ${sections.length}.`
    );
  }

  sections.forEach((section, index) => {
    const expectedId = WEEKLY_ROUNDUP_SECTION_ORDER[index];
    if (section.sectionId !== expectedId) {
      throw new Error(
        `Section order invalid at position ${index + 1}: expected ${expectedId}, got ${section.sectionId}.`
      );
    }

    const sourceLeaks = extractSourceRefLeaks(section.markdown);
    if (sourceLeaks.length > 0) {
      throw new Error(
        `Section ${section.sectionId} contains source reference IDs in markdown text (${sourceLeaks.join(', ')}). These belong only in the sourceRefs JSON array.`
      );
    }
  });

  // rapid-round must have fixtureCount set
  const rapidRound = sections.find((s) => s.sectionId === 'rapid-round');
  if (rapidRound && (rapidRound.meta?.fixtureCount === undefined || rapidRound.meta.fixtureCount === null)) {
    throw new Error('rapid-round section must have meta.fixtureCount set.');
  }

  // Sections requiring source refs
  const requiredSources = ['newcastle-deep-dive', 'result-that-changed', 'rapid-round'] as const;
  for (const sectionId of requiredSources) {
    const section = sections.find((s) => s.sectionId === sectionId);
    if (section && section.sourceRefs.length === 0) {
      throw new Error(`Section ${sectionId} requires at least one source reference.`);
    }
  }
}

export function validateRoundupSingleSection(
  dossier: RoundupDossier,
  section: RoundupSectionArtifact
): void {
  const placeholders: RoundupSectionArtifact[] = WEEKLY_ROUNDUP_SECTION_ORDER.map((id) => ({
    sectionId: id,
    headline: 'placeholder',
    markdown: '',
    sourceRefs: id === 'newcastle-deep-dive' || id === 'result-that-changed' || id === 'rapid-round'
      ? ['placeholder']
      : [],
    handoffNotes: [],
    meta: id === 'rapid-round' ? { fixtureCount: 0 } : {},
  }));

  validateRoundupSections(
    dossier,
    placeholders.map((entry) => (entry.sectionId === section.sectionId ? section : entry))
  );
}
