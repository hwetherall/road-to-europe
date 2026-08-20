vi.mock('@/lib/live-data', () => ({
  getLiveSnapshot: vi.fn(async () => {
    // Last season's data, used here purely as a static test fixture.
    const { FALLBACK_STANDINGS_2025_26: teams, FALLBACK_FIXTURES_2025_26: fixtures } =
      await import('@/lib/constants');
    return {
      teams,
      fixtures,
      standingsSource: 'live',
      fixturesSource: 'live',
      oddsSource: 'live',
      oddsCoverage: {
        matchedFixtures: fixtures.length,
        totalScheduledFixtures: fixtures.length,
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

import { buildPerfectWeekend, buildWeeklyPreviewDossier } from '@/lib/weekly-preview/dossier';

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

    // Measuring one fixture alone must reproduce the entry from the full-round
    // scan exactly. That holds only because every candidate is patched onto the
    // same shared baseline season, so it checks the pairing as well as the
    // choice of best outcome.
    for (const entry of dossier.perfectWeekend) {
      const fixture = dossier.nextRoundFixtures.find((item) => item.id === entry.fixtureId);
      expect(fixture).toBeDefined();

      const isolated = buildPerfectWeekend({
        teams: dossier.teams,
        fixtures: dossier.fixtures,
        nextRoundFixtures: [fixture!],
        club: 'NEW',
      });

      expect(isolated.entries).toHaveLength(1);
      expect(isolated.entries[0]).toEqual(entry);
    }
  }, 60_000);

  it('suppresses the perfect-weekend table when nothing clears its noise floor', async () => {
    const dossier = await buildWeeklyPreviewDossier();

    // Either at least one entry is measurable, or the table is marked
    // unreportable. It must never be reportable with nothing measurable in it.
    const anyMeasurable = dossier.perfectWeekend.some((e) => !e.belowNoiseFloor);
    expect(dossier.perfectWeekendIsReportable).toBe(anyMeasurable);

    // Every entry carries its own error bar.
    for (const entry of dossier.perfectWeekend) {
      expect(entry.sePp).toBeGreaterThanOrEqual(0);
      expect(entry.noiseFloorPp).toBeCloseTo(entry.sePp * 2, 2);
      expect(entry.belowNoiseFloor).toBe(Math.abs(entry.deltaPp) <= entry.noiseFloorPp);
    }
  }, 60_000);

  it('builds a top-3 game-of-the-week shortlist', async () => {
    const dossier = await buildWeeklyPreviewDossier();
    expect(dossier.gameOfWeekShortlist.length).toBeLessThanOrEqual(3);
    expect(dossier.gameOfWeekShortlist.length).toBeGreaterThan(0);
  });
});
