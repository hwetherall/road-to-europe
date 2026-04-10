import { buildWeeklyPreviewDossier } from '@/lib/weekly-preview/dossier';
import { validateSections } from '@/lib/weekly-preview/validators';
import { WeeklyPreviewSectionArtifact } from '@/lib/weekly-preview/types';

vi.mock('@/lib/live-data', () => ({
  getLiveSnapshot: vi.fn(async () => {
    const { HARDCODED_STANDINGS, KNOWN_FIXTURES } = await import('@/lib/constants');
    return {
      teams: HARDCODED_STANDINGS,
      fixtures: KNOWN_FIXTURES,
      standingsSource: 'hardcoded',
      fixturesSource: 'hardcoded',
      oddsSource: 'live',
      oddsCoverage: {
        matchedFixtures: KNOWN_FIXTURES.length,
        totalScheduledFixtures: KNOWN_FIXTURES.length,
        nextRoundMatchedFixtures: 5,
        nextRoundScheduledFixtures: 5,
      },
    };
  }),
}));

vi.mock('@/lib/weekly-preview/research', () => ({
  buildResearchBundle: vi.fn(async () => ({
    hotNewsCandidates: [
      {
        title: 'News 1',
        summary: 'Summary 1',
        relevantTeams: ['Newcastle United'],
        sourceRefIds: ['research-1'],
      },
    ],
    clubFactSheet: {
      clubNews: ['Club note'],
      injuryUpdates: ['Injury note'],
      squadUpdates: ['Squad note'],
      opponentUpdates: ['Opponent note'],
      squadEdgeNotes: ['Edge note'],
    },
    sources: [{ id: 'research-1', title: 'Source 1', url: '', provider: 'serper' }],
    gameOfWeekResearch: ['Tactical research'],
    approvedStorylines: ['Leverage matters'],
  })),
}));

vi.mock('@/lib/what-if/squad-quality', () => ({
  computeSquadProfile: vi.fn(async (abbr: string) => ({
    teamName: abbr,
    teamAbbr: abbr,
    averageOverall: 80,
    averageStartingXI: 80,
    depthScore: 79,
    weakestPositionGroup: 'full-back',
    weakestPositionAvg: 75,
    strongestPositionGroup: 'central-mid',
    strongestPositionAvg: 82,
    players: [],
    totalSquadValue: 1000000,
  })),
}));

function makeSection(
  sectionId: WeeklyPreviewSectionArtifact['sectionId'],
  markdown: string,
  numericClaimIds: string[],
  sourceRefs: string[] = ['research-1']
): WeeklyPreviewSectionArtifact {
  return {
    sectionId,
    headline: sectionId,
    markdown,
    factsUsed: [],
    newFacts: [],
    numericClaimIds,
    sourceRefs,
    handoffNotes: [],
    meta: sectionId === 'hot-news' ? { itemCount: 1 } : {},
  };
}

describe('weekly preview validators', () => {
  it('accepts declared numbers and ordered sections', async () => {
    const dossier = await buildWeeklyPreviewDossier();

    const sections = [
      makeSection('overview', `Overview at ${dossier.allowedNumericClaimsBySection.overview[0].formatted}.`, ['newcastle-top7-baseline'], []),
      makeSection(
        'three-contests',
        `Three contests at ${dossier.allowedNumericClaimsBySection['three-contests'][0].formatted}.`,
        ['title-leader-champion']
      ),
      makeSection('hot-news', `Hot news worth ${dossier.allowedNumericClaimsBySection['hot-news'][0].formatted}.`, ['hot-news-impact-1']),
      makeSection('game-of-the-week', `Game swing ${dossier.allowedNumericClaimsBySection['game-of-the-week'][1].formatted}.`, ['gotw-spread']),
      makeSection('club-focus', `Club baseline ${dossier.allowedNumericClaimsBySection['club-focus'][0].formatted}.`, ['club-focus-top7']),
      makeSection('match-focus', `Match upside ${dossier.allowedNumericClaimsBySection['match-focus'][0].formatted}.`, ['match-focus-best-delta']),
      makeSection('perfect-weekend', `Best case ${dossier.allowedNumericClaimsBySection['perfect-weekend'][0].formatted} and ${dossier.allowedNumericClaimsBySection['perfect-weekend'][1].formatted}.`, [dossier.allowedNumericClaimsBySection['perfect-weekend'][0].id, dossier.allowedNumericClaimsBySection['perfect-weekend'][1].id]),
      makeSection('summary', `Summary closes on ${dossier.allowedNumericClaimsBySection.summary[0].formatted}.`, ['newcastle-top7-baseline'], []),
    ];

    expect(() => validateSections(dossier, sections)).not.toThrow();
  });

  it('rejects undeclared numeric tokens', async () => {
    const dossier = await buildWeeklyPreviewDossier();

    const sections = [
      makeSection('overview', 'Overview at 99.9%.', [] , []),
      makeSection('three-contests', 'Three contests.', [], ['research-1']),
      makeSection('hot-news', 'Hot news.', [], ['research-1']),
      makeSection('game-of-the-week', 'Game.', [], ['research-1']),
      makeSection('club-focus', 'Club.', [], ['research-1']),
      makeSection('match-focus', 'Match.', [], ['research-1']),
      makeSection('perfect-weekend', 'Perfect.', [], ['research-1']),
      makeSection('summary', 'Summary.', [], []),
    ];

    expect(() => validateSections(dossier, sections)).toThrow(/undeclared numeric token/i);
  });
});
