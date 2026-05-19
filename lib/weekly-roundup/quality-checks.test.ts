import { runRoundupQualityChecks } from '@/lib/weekly-roundup/quality-checks';
import {
  ProbabilityShift,
  RoundupDossier,
  RoundupSectionArtifact,
} from '@/lib/weekly-roundup/types';
import { Team } from '@/lib/types';

function makeShift(team: string, championPct: number, top7Pct = 0): ProbabilityShift {
  return {
    team,
    preRound: {
      championPct,
      top4Pct: 0,
      top7Pct,
      survivalPct: 100,
      avgPosition: 1,
      avgPoints: 80,
    },
    postRound: {
      championPct,
      top4Pct: 0,
      top7Pct,
      survivalPct: 100,
      avgPosition: 1,
      avgPoints: 80,
    },
    delta: {
      championPct: 0,
      top4Pct: 0,
      top7Pct: 0,
      survivalPct: 0,
      avgPosition: 0,
      avgPoints: 0,
    },
  };
}

function makeDossier(overrides: Partial<RoundupDossier> = {}): RoundupDossier {
  return {
    teams: [
      { abbr: 'MCI', name: 'Manchester City' },
      { abbr: 'ARS', name: 'Arsenal' },
      { abbr: 'NEW', name: 'Newcastle United' },
    ] as Team[],
    probabilityShifts: [makeShift('MCI', 45.7), makeShift('ARS', 54.3)],
    targetClubDeltaTop7Pp: -50,
    ...overrides,
  } as RoundupDossier;
}

function makeSection(markdown: string): RoundupSectionArtifact {
  return {
    sectionId: 'three-races',
    headline: 'Three Races',
    markdown,
    sourceRefs: [],
    handoffNotes: [],
    meta: {},
  };
}

describe('weekly roundup quality checks', () => {
  it('flags favourite language when another title rival has a higher probability', () => {
    const issues = runRoundupQualityChecks(makeDossier(), [
      makeSection('City emerge from the matchday as favourites at 45.7%. Arsenal now sit at 54.3%.'),
    ]);

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      severity: 'high',
      category: 'logical_contradiction',
      sectionId: 'three-races',
    });
    expect(issues[0].explanation).toContain('ARS has the higher post-round probability');
  });

  it('does not flag favourite language for the actual probability leader', () => {
    const issues = runRoundupQualityChecks(makeDossier(), [
      makeSection('City jumped to 45.7%, but Arsenal remain favourites at 54.3%.'),
    ]);

    expect(issues).toHaveLength(0);
  });

  it('flags actual swing prose that disagrees with the target club top-seven delta', () => {
    const issues = runRoundupQualityChecks(makeDossier(), [
      makeSection('If every ideal result had landed, Newcastle were looking at +4.0pp. The actual swing was -0.5pp.'),
    ]);

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      severity: 'high',
      category: 'numeric_consistency',
    });
    expect(issues[0].explanation).toContain("-50.0pp");
  });
});
