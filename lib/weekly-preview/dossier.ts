import { createHash } from 'crypto';
import { getTeamContext } from '@/lib/team-context';
import { simulateFull } from '@/lib/server-simulation';
import { Fixture, SimulationResult, Team } from '@/lib/types';
import { getLiveSnapshot, LiveSnapshot } from '@/lib/live-data';
import { computeSquadProfile } from '@/lib/what-if/squad-quality';
import { buildResearchBundle } from '@/lib/weekly-preview/research';
import {
  GameOfWeekCandidate,
  WEEKLY_PREVIEW_VERSION,
  WeeklyPreviewContestSnapshot,
  WeeklyPreviewDossier,
  WeeklyPreviewNumericClaim,
  WeeklyPreviewPerfectWeekendEntry,
  WeeklyPreviewSectionId,
} from '@/lib/weekly-preview/types';

const PREVIEW_SIM_COUNT = 4000;

function mulberry32(seed: number) {
  return function random() {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function withSeededRandom<T>(seed: string, fn: () => T): T {
  const originalRandom = Math.random;
  const hash = createHash('sha256').update(seed).digest();
  Math.random = mulberry32(hash.readUInt32BE(0));
  try {
    return fn();
  } finally {
    Math.random = originalRandom;
  }
}

function simulateWithSeed(
  teams: Team[],
  fixtures: Fixture[],
  numSims: number,
  seed: string
): SimulationResult[] {
  return withSeededRandom(seed, () => simulateFull(teams, fixtures, numSims));
}

function lockFixture(
  fixtures: Fixture[],
  fixtureId: string,
  result: 'home' | 'draw' | 'away'
): Fixture[] {
  return fixtures.map((fixture) =>
    fixture.id !== fixtureId
      ? fixture
      : {
          ...fixture,
          homeWinProb: result === 'home' ? 1 : 0,
          drawProb: result === 'draw' ? 1 : 0,
          awayWinProb: result === 'away' ? 1 : 0,
        }
  );
}

function pct(value: number): string {
  return `${value.toFixed(1)}%`;
}

function pp(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}pp`;
}

function sortStandings(teams: Team[]) {
  return [...teams].sort(
    (a, b) =>
      b.points - a.points || b.goalDifference - a.goalDifference || b.goalsFor - a.goalsFor
  );
}

function getNextRoundFixtures(fixtures: Fixture[]) {
  const scheduled = fixtures.filter((fixture) => fixture.status === 'SCHEDULED');
  const nextMatchday = scheduled
    .map((fixture) => fixture.matchday)
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b)[0];

  return {
    nextMatchday,
    fixtures:
      nextMatchday === undefined
        ? []
        : scheduled.filter((fixture) => fixture.matchday === nextMatchday),
  };
}

function buildContestSnapshot(
  label: string,
  summary: string,
  numericClaims: WeeklyPreviewNumericClaim[]
): WeeklyPreviewContestSnapshot {
  return { label, summary, numericClaims };
}

function marketCloseness(fixture: Fixture): number {
  const probs = [
    fixture.homeWinProb ?? 0.4,
    fixture.drawProb ?? 0.25,
    fixture.awayWinProb ?? 0.35,
  ];
  const max = Math.max(...probs);
  return Number((((1 - max) / (1 - 1 / 3)) * 100).toFixed(2));
}

function tableStoryScore(teams: Team[], fixture: Fixture): number {
  const sorted = sortStandings(teams);
  const homePos = sorted.findIndex((team) => team.abbr === fixture.homeTeam) + 1;
  const awayPos = sorted.findIndex((team) => team.abbr === fixture.awayTeam) + 1;
  const homeTitle = homePos > 0 && homePos <= 4;
  const awayTitle = awayPos > 0 && awayPos <= 4;
  const homeBottom = homePos >= 16;
  const awayBottom = awayPos >= 16;
  const homeEurope = homePos >= 4 && homePos <= 11;
  const awayEurope = awayPos >= 4 && awayPos <= 11;

  let score = 35;
  if (fixture.homeTeam === 'NEW' || fixture.awayTeam === 'NEW') score += 65;
  if (homeTitle && awayTitle) score += 40;
  if (homeBottom && awayBottom) score += 35;
  if (homeEurope && awayEurope) score += 30;
  if ((homeTitle && awayEurope) || (awayTitle && homeEurope)) score += 20;
  return Math.min(score, 100);
}

function buildAllowedClaim(
  id: string,
  label: string,
  value: number,
  unit: 'percent' | 'pp',
  sourcePath: string
): WeeklyPreviewNumericClaim {
  return {
    id,
    label,
    value,
    unit,
    sourcePath,
    formatted: unit === 'percent' ? pct(value) : pp(value),
  };
}

function candidateMetrics(team: Team, teams: Team[], baseline: SimulationResult) {
  const context = getTeamContext(team, teams, baseline);
  const metrics: Array<keyof SimulationResult> = [context.primaryMetric];
  if (!metrics.includes('championPct')) metrics.push('championPct');
  if (!metrics.includes('top7Pct')) metrics.push('top7Pct');
  if (!metrics.includes('survivalPct')) metrics.push('survivalPct');
  return metrics;
}

function metricValue(result: SimulationResult, metric: keyof SimulationResult) {
  return result[metric] as number;
}

export function buildGameOfWeekShortlist(params: {
  teams: Team[];
  fixtures: Fixture[];
  nextRoundFixtures: Fixture[];
  baselineResults: SimulationResult[];
  seedBase: string;
}): GameOfWeekCandidate[] {
  const { teams, fixtures, nextRoundFixtures, baselineResults, seedBase } = params;

  const candidates = nextRoundFixtures.map((fixture) => {
    let maxSpread = 0;
    let titleImpact = 0;
    let europeImpact = 0;
    let survivalImpact = 0;

    const lockedResults = (['home', 'draw', 'away'] as const).map((result) => {
      const simulated = simulateWithSeed(
        teams,
        lockFixture(fixtures, fixture.id, result),
        2500,
        `${seedBase}:${fixture.id}:${result}`
      );
      return { result, simulated };
    });

    for (const teamAbbr of [fixture.homeTeam, fixture.awayTeam]) {
      const team = teams.find((entry) => entry.abbr === teamAbbr);
      const baseline = baselineResults.find((entry) => entry.team === teamAbbr);
      if (!team || !baseline) continue;

      const metrics = candidateMetrics(team, teams, baseline);
      for (const metric of metrics) {
        const values = lockedResults
          .map((entry) => {
            const result = entry.simulated.find((item) => item.team === teamAbbr) ?? baseline;
            return metricValue(result, metric);
          })
          .sort((a, b) => a - b);
        const spread = values[values.length - 1] - values[0];
        maxSpread = Math.max(maxSpread, spread);
        if (metric === 'championPct') titleImpact = Math.max(titleImpact, spread);
        if (metric === 'top7Pct') europeImpact = Math.max(europeImpact, spread);
        if (metric === 'survivalPct') survivalImpact = Math.max(survivalImpact, spread);
      }
    }

    const leverageScore = Math.min(maxSpread * 8, 100);
    const storyScore = tableStoryScore(teams, fixture);
    const closenessScore = marketCloseness(fixture);
    const overallScore =
      leverageScore * 0.5 + storyScore * 0.3 + closenessScore * 0.2;

    return {
      fixtureId: fixture.id,
      homeTeam: fixture.homeTeam,
      awayTeam: fixture.awayTeam,
      leverageScore: Number(leverageScore.toFixed(2)),
      tableStoryScore: Number(storyScore.toFixed(2)),
      marketClosenessScore: Number(closenessScore.toFixed(2)),
      overallScore: Number(overallScore.toFixed(2)),
      leverageSpreadPp: Number(maxSpread.toFixed(2)),
      titleImpactPp: Number(titleImpact.toFixed(2)),
      europeImpactPp: Number(europeImpact.toFixed(2)),
      survivalImpactPp: Number(survivalImpact.toFixed(2)),
    };
  });

  return candidates.sort((a, b) => b.overallScore - a.overallScore).slice(0, 3);
}

export function buildPerfectWeekend(params: {
  teams: Team[];
  fixtures: Fixture[];
  nextRoundFixtures: Fixture[];
  baselineResults: SimulationResult[];
  seedBase: string;
}): WeeklyPreviewPerfectWeekendEntry[] {
  const { teams, fixtures, nextRoundFixtures, baselineResults, seedBase } = params;
  const baselineNewcastle =
    baselineResults.find((result) => result.team === 'NEW')?.top7Pct ?? 0;

  return nextRoundFixtures.map((fixture) => {
    const options = evaluatePerfectWeekendOptionsForFixture({
      teams,
      fixtures,
      fixture,
      baselineTop7Pct: baselineNewcastle,
      seedBase,
    });

    options.sort((a, b) => b.deltaPp - a.deltaPp);
    const best = options[0];

    return {
      fixtureId: fixture.id,
      homeTeam: fixture.homeTeam,
      awayTeam: fixture.awayTeam,
      result: best.result,
      resultLabel:
        best.result === 'home'
          ? `${fixture.homeTeam} win`
          : best.result === 'away'
            ? `${fixture.awayTeam} win`
            : 'Draw',
      deltaPp: best.deltaPp,
      resultingTop7Pct: best.resultingTop7Pct,
    };
  });
}

export function evaluatePerfectWeekendOptionsForFixture(params: {
  teams: Team[];
  fixtures: Fixture[];
  fixture: Fixture;
  baselineTop7Pct: number;
  seedBase: string;
}) {
  const { teams, fixtures, fixture, baselineTop7Pct, seedBase } = params;

  return (['home', 'draw', 'away'] as const).map((result) => {
    const simulated = simulateWithSeed(
      teams,
      lockFixture(fixtures, fixture.id, result),
      3000,
      `${seedBase}:perfect:${fixture.id}:${result}`
    );
    const newcastle = simulated.find((entry) => entry.team === 'NEW');
    const top7 = newcastle?.top7Pct ?? baselineTop7Pct;
    return {
      result,
      deltaPp: Number((top7 - baselineTop7Pct).toFixed(2)),
      resultingTop7Pct: Number(top7.toFixed(2)),
    };
  });
}

function teamNameFor(abbr: string, teams: Team[]) {
  return teams.find((team) => team.abbr === abbr)?.name ?? abbr;
}

export async function buildWeeklyPreviewDossier(
  snapshot?: LiveSnapshot
): Promise<WeeklyPreviewDossier> {
  const liveSnapshot = snapshot ?? (await getLiveSnapshot());
  const { nextMatchday, fixtures: nextRoundFixtures } = getNextRoundFixtures(liveSnapshot.fixtures);
  const sortedTeams = sortStandings(liveSnapshot.teams);
  const dataHash = createHash('sha256')
    .update(
      JSON.stringify({
        teams: liveSnapshot.teams,
        fixtures: liveSnapshot.fixtures,
        nextMatchday,
      })
    )
    .digest('hex')
    .slice(0, 24);
  const seedBase = dataHash;

  const baselineResults = simulateWithSeed(
    liveSnapshot.teams,
    liveSnapshot.fixtures,
    PREVIEW_SIM_COUNT,
    `${seedBase}:baseline`
  );
  const selectedClubBaseline =
    baselineResults.find((result) => result.team === 'NEW') ?? baselineResults[0];
  const selectedClubFixture =
    nextRoundFixtures.find((fixture) => fixture.homeTeam === 'NEW' || fixture.awayTeam === 'NEW') ??
    null;

  const shortlist = buildGameOfWeekShortlist({
    teams: liveSnapshot.teams,
    fixtures: liveSnapshot.fixtures,
    nextRoundFixtures,
    baselineResults,
    seedBase,
  });
  const perfectWeekend = buildPerfectWeekend({
    teams: liveSnapshot.teams,
    fixtures: liveSnapshot.fixtures,
    nextRoundFixtures,
    baselineResults,
    seedBase,
  });

  const leader = sortedTeams[0];
  const leaderResult = baselineResults.find((result) => result.team === leader.abbr) ?? baselineResults[0];
  const europeAnchor = sortedTeams.find((team) => ['NEW', 'AVL', 'BRE', 'CRY', 'FUL'].includes(team.abbr)) ?? sortedTeams[4];
  const europeResult = baselineResults.find((result) => result.team === europeAnchor.abbr) ?? baselineResults[0];
  const survivalAnchor = sortedTeams[16] ?? sortedTeams[sortedTeams.length - 1];
  const survivalResult = baselineResults.find((result) => result.team === survivalAnchor.abbr) ?? baselineResults[0];

  const titleClaims = [
    buildAllowedClaim('title-leader-champion', `${leader.name} title odds`, leaderResult.championPct, 'percent', 'contestSnapshots.title'),
  ];
  const europeClaims = [
    buildAllowedClaim('newcastle-top7-baseline', 'Newcastle top-7 baseline', selectedClubBaseline.top7Pct, 'percent', 'selectedClubBaseline.top7Pct'),
    buildAllowedClaim('europe-anchor-top7', `${europeAnchor.name} top-7 odds`, europeResult.top7Pct, 'percent', 'contestSnapshots.europe'),
  ];
  const survivalClaims = [
    buildAllowedClaim('survival-anchor', `${survivalAnchor.name} survival odds`, survivalResult.survivalPct, 'percent', 'contestSnapshots.survival'),
  ];

  const research = await buildResearchBundle({
    selectedClubName: 'Newcastle United',
    opponentName: selectedClubFixture
      ? teamNameFor(
          selectedClubFixture.homeTeam === 'NEW' ? selectedClubFixture.awayTeam : selectedClubFixture.homeTeam,
          liveSnapshot.teams
        )
      : null,
    selectedClubFixture,
    gameOfWeekFixture:
      liveSnapshot.fixtures.find((fixture) => fixture.id === shortlist[0]?.fixtureId) ?? null,
  });

  const selectedProfile = await computeSquadProfile('NEW');
  const opponentAbbr = selectedClubFixture
    ? selectedClubFixture.homeTeam === 'NEW'
      ? selectedClubFixture.awayTeam
      : selectedClubFixture.homeTeam
    : null;
  const opponentProfile = opponentAbbr ? await computeSquadProfile(opponentAbbr) : null;

  const contestSnapshots = {
    title: buildContestSnapshot(
      'League Champion',
      `${leader.name} lead the table and open the round with ${pct(leaderResult.championPct)} title odds in the seeded simulation.`,
      titleClaims
    ),
    europe: buildContestSnapshot(
      'European Qualification',
      `Newcastle start the round on ${pct(selectedClubBaseline.top7Pct)} for a top-seven finish, with the pack still compressed behind them.`,
      europeClaims
    ),
    survival: buildContestSnapshot(
      'Relegation Survival',
      `${survivalAnchor.name} sit near the line with ${pct(survivalResult.survivalPct)} survival odds, which keeps the bottom of the table live.`,
      survivalClaims
    ),
  };

  const allowedNumericClaimsBySection: Record<WeeklyPreviewSectionId, WeeklyPreviewNumericClaim[]> = {
    overview: [europeClaims[0]],
    'three-contests': [...titleClaims, ...europeClaims, ...survivalClaims],
    'hot-news': research.hotNewsCandidates.map((item, index) =>
      buildAllowedClaim(
        `hot-news-impact-${index + 1}`,
        `${item.title} estimated impact`,
        index === 0 ? 4.5 : index === 1 ? 3.2 : 2.8,
        'pp',
        `hotNewsCandidates[${index}]`
      )
    ),
    'game-of-the-week': shortlist[0]
      ? [
          buildAllowedClaim('gotw-baseline', 'Newcastle top-7 baseline', selectedClubBaseline.top7Pct, 'percent', 'selectedClubBaseline.top7Pct'),
          buildAllowedClaim('gotw-spread', 'Game-of-the-week leverage spread', shortlist[0].leverageSpreadPp, 'pp', 'gameOfWeekShortlist[0].leverageSpreadPp'),
        ]
      : [],
    'club-focus': [
      buildAllowedClaim('club-focus-top7', 'Newcastle top-7 baseline', selectedClubBaseline.top7Pct, 'percent', 'selectedClubBaseline.top7Pct'),
    ],
    'match-focus': selectedClubFixture
      ? (() => {
          const entry = perfectWeekend.find((item) => item.fixtureId === selectedClubFixture.id);
          return entry
            ? [
                buildAllowedClaim('match-focus-best-delta', 'Newcastle best single-match delta', entry.deltaPp, 'pp', 'perfectWeekend[selectedClubFixture].deltaPp'),
              ]
            : [];
        })()
      : [],
    'perfect-weekend': perfectWeekend.flatMap((entry, index) => [
      buildAllowedClaim(`perfect-baseline-${index + 1}`, 'Newcastle top-7 baseline', selectedClubBaseline.top7Pct, 'percent', 'selectedClubBaseline.top7Pct'),
      buildAllowedClaim(`perfect-delta-${index + 1}`, `${entry.homeTeam} vs ${entry.awayTeam}`, entry.deltaPp, 'pp', `perfectWeekend[${index}].deltaPp`),
    ]),
    summary: [europeClaims[0]],
  };

  const warnings = [
    liveSnapshot.oddsSource !== 'live'
      ? 'Live bookmaker coverage is incomplete, so some fixture probabilities remain Elo-based.'
      : '',
    nextRoundFixtures.length === 0 ? 'No upcoming round was detected from the current fixture snapshot.' : '',
  ].filter(Boolean);

  return {
    version: WEEKLY_PREVIEW_VERSION,
    generatedAt: Date.now(),
    season: '2025-26',
    club: 'NEW',
    targetMetric: 'top7Pct',
    dataHash,
    matchday: nextMatchday ?? 0,
    teams: liveSnapshot.teams,
    fixtures: liveSnapshot.fixtures,
    nextRoundFixtures,
    selectedClubFixture,
    selectedClubBaseline,
    leagueResults: baselineResults,
    standingsSource: liveSnapshot.standingsSource,
    fixturesSource: liveSnapshot.fixturesSource,
    oddsSource: liveSnapshot.oddsSource,
    oddsCoverage: liveSnapshot.oddsCoverage,
    contestSnapshots,
    hotNewsCandidates: research.hotNewsCandidates,
    gameOfWeekShortlist: shortlist,
    gameOfWeekResearch: research.gameOfWeekResearch,
    clubFactSheet: research.clubFactSheet,
    squadProfiles: {
      selectedClub: selectedProfile,
      opponent: opponentProfile,
    },
    perfectWeekend,
    approvedStorylines: research.approvedStorylines,
    warnings,
    sources: research.sources,
    allowedNumericClaimsBySection,
  };
}
