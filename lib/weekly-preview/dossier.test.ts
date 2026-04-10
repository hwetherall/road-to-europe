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
      {
        title: 'News 2',
        summary: 'Summary 2',
        relevantTeams: ['Newcastle United'],
        sourceRefIds: ['research-2'],
      },
      {
        title: 'News 3',
        summary: 'Summary 3',
        relevantTeams: ['Newcastle United'],
        sourceRefIds: ['research-3'],
      },
    ],
    clubFactSheet: {
      clubNews: ['Club note'],
      injuryUpdates: ['Injury note'],
      squadUpdates: ['Squad note'],
      opponentUpdates: ['Opponent note'],
      squadEdgeNotes: ['Edge note'],
    },
    sources: [
      { id: 'research-1', title: 'Source 1', url: '', provider: 'serper' },
      { id: 'research-2', title: 'Source 2', url: '', provider: 'serper' },
      { id: 'research-3', title: 'Source 3', url: '', provider: 'serper' },
    ],
    gameOfWeekResearch: ['Tactical research'],
    approvedStorylines: ['Leverage matters'],
  })),
}));

vi.mock('@/lib/what-if/squad-quality', () => ({
  computeSquadProfile: vi.fn(async (abbr: string) => ({
    teamName: abbr === 'NEW' ? 'Newcastle United' : abbr,
    teamAbbr: abbr,
    averageOverall: 80,
    averageStartingXI: abbr === 'NEW' ? 81.2 : 80.1,
    depthScore: 78.5,
    weakestPositionGroup: 'full-back',
    weakestPositionAvg: 75.1,
    strongestPositionGroup: 'central-mid',
    strongestPositionAvg: 82.3,
    players: [],
    totalSquadValue: 1000000,
  })),
}));

import {
  buildWeeklyPreviewDossier,
  evaluatePerfectWeekendOptionsForFixture,
} from '@/lib/weekly-preview/dossier';

describe('weekly preview dossier', () => {
  it('is deterministic for the same snapshot', async () => {
    const a = await buildWeeklyPreviewDossier();
    const b = await buildWeeklyPreviewDossier();

    expect(a.dataHash).toBe(b.dataHash);
    expect(a.matchday).toBe(b.matchday);
    expect(a.gameOfWeekShortlist).toEqual(b.gameOfWeekShortlist);
    expect(a.perfectWeekend).toEqual(b.perfectWeekend);
    expect(a.selectedClubBaseline.top7Pct).toBe(b.selectedClubBaseline.top7Pct);
  });

  it('selects the maximizing outcome for each perfect-weekend fixture', async () => {
    const dossier = await buildWeeklyPreviewDossier();
    const baselineTop7 = dossier.selectedClubBaseline.top7Pct;

    for (const entry of dossier.perfectWeekend) {
      const fixture = dossier.nextRoundFixtures.find((item) => item.id === entry.fixtureId);
      expect(fixture).toBeDefined();
      const options = evaluatePerfectWeekendOptionsForFixture({
        teams: dossier.teams,
        fixtures: dossier.fixtures,
        fixture: fixture!,
        baselineTop7Pct: baselineTop7,
        seedBase: dossier.dataHash,
      });
      const maxDelta = Math.max(...options.map((option) => option.deltaPp));
      expect(entry.deltaPp).toBe(maxDelta);
    }
  });

  it('builds a top-3 game-of-the-week shortlist', async () => {
    const dossier = await buildWeeklyPreviewDossier();
    expect(dossier.gameOfWeekShortlist.length).toBeLessThanOrEqual(3);
    expect(dossier.gameOfWeekShortlist.length).toBeGreaterThan(0);
  });
});
