import { createHash } from 'crypto';
import { simulateFull } from '@/lib/server-simulation';
import { Fixture, SimulationResult, Team } from '@/lib/types';
import { getFixturesData } from '@/lib/live-data';
import { fetchMatchdayEvents, reconcileScores } from '@/lib/espn';
import { getWeeklyPreviewByMatchday } from '@/lib/weekly-preview/cache';
import { WeeklyPreviewPerfectWeekendEntry } from '@/lib/weekly-preview/types';
import { GameOfWeekCandidate } from '@/lib/weekly-preview/types';
import {
  MatchResult,
  ProbabilityShift,
  ProbabilityShiftMetrics,
  PerfectWeekendGrade,
  ResultThatChanged,
  RoundupDossier,
  WEEKLY_ROUNDUP_VERSION,
} from '@/lib/weekly-roundup/types';

const ROUNDUP_SIM_COUNT = 4000;

// ── Pure Computation Functions ──

export async function fetchMatchdayResults(matchday: number): Promise<MatchResult[]> {
  const { data: fixtures } = await getFixturesData();
  return fixtures
    .filter((f) => f.matchday === matchday && f.status === 'FINISHED')
    .map((f) => ({
      fixtureId: f.id,
      homeTeam: f.homeTeam,
      awayTeam: f.awayTeam,
      homeGoals: f.homeScore ?? 0,
      awayGoals: f.awayScore ?? 0,
      matchday: f.matchday,
      status: f.status as 'FINISHED',
    }));
}

export function applyResultsToStandings(
  preRoundTeams: Team[],
  results: MatchResult[]
): Team[] {
  const teams = preRoundTeams.map((t) => ({ ...t }));
  const lookup = new Map(teams.map((t) => [t.abbr, t]));

  for (const result of results) {
    const home = lookup.get(result.homeTeam);
    const away = lookup.get(result.awayTeam);
    if (!home || !away) continue;

    home.played++;
    away.played++;
    home.goalsFor += result.homeGoals;
    home.goalsAgainst += result.awayGoals;
    away.goalsFor += result.awayGoals;
    away.goalsAgainst += result.homeGoals;
    home.goalDifference = home.goalsFor - home.goalsAgainst;
    away.goalDifference = away.goalsFor - away.goalsAgainst;

    if (result.homeGoals > result.awayGoals) {
      home.points += 3;
      home.won++;
      away.lost++;
    } else if (result.homeGoals === result.awayGoals) {
      home.points += 1;
      away.points += 1;
      home.drawn++;
      away.drawn++;
    } else {
      away.points += 3;
      away.won++;
      home.lost++;
    }
  }

  return teams;
}

function extractMetrics(result: SimulationResult): ProbabilityShiftMetrics {
  return {
    championPct: result.championPct,
    top4Pct: result.top4Pct,
    top7Pct: result.top7Pct,
    survivalPct: result.survivalPct,
    avgPosition: result.avgPosition,
    avgPoints: result.avgPoints,
  };
}

export function computeProbabilityShifts(
  preRound: SimulationResult[],
  postRound: SimulationResult[]
): ProbabilityShift[] {
  const postMap = new Map(postRound.map((r) => [r.team, r]));

  return preRound
    .map((pre) => {
      const post = postMap.get(pre.team);
      if (!post) return null;

      const preMetrics = extractMetrics(pre);
      const postMetrics = extractMetrics(post);

      return {
        team: pre.team,
        preRound: preMetrics,
        postRound: postMetrics,
        delta: {
          championPct: Number((postMetrics.championPct - preMetrics.championPct).toFixed(2)),
          top4Pct: Number((postMetrics.top4Pct - preMetrics.top4Pct).toFixed(2)),
          top7Pct: Number((postMetrics.top7Pct - preMetrics.top7Pct).toFixed(2)),
          survivalPct: Number((postMetrics.survivalPct - preMetrics.survivalPct).toFixed(2)),
          avgPosition: Number((postMetrics.avgPosition - preMetrics.avgPosition).toFixed(2)),
          avgPoints: Number((postMetrics.avgPoints - preMetrics.avgPoints).toFixed(2)),
        },
      };
    })
    .filter((shift): shift is ProbabilityShift => shift !== null);
}

export function gradePerfectWeekend(
  perfectWeekend: WeeklyPreviewPerfectWeekendEntry[],
  results: MatchResult[]
): PerfectWeekendGrade[] {
  const resultMap = new Map(results.map((r) => [r.fixtureId, r]));

  return perfectWeekend.map((entry) => {
    const result = resultMap.get(entry.fixtureId);
    let actualResult: 'home' | 'draw' | 'away' = 'draw';
    let actualScore = '?-?';

    if (result) {
      actualScore = `${result.homeGoals}-${result.awayGoals}`;
      if (result.homeGoals > result.awayGoals) actualResult = 'home';
      else if (result.homeGoals < result.awayGoals) actualResult = 'away';
    }

    return {
      fixtureId: entry.fixtureId,
      homeTeam: entry.homeTeam,
      awayTeam: entry.awayTeam,
      predictedResult: entry.result,
      predictedResultLabel: entry.resultLabel,
      actualResult,
      actualScore,
      correct: entry.result === actualResult,
      predictedSwingPp: entry.deltaPp,
    };
  });
}

function pickBiggestDelta(shift: ProbabilityShift): { metric: string; delta: number } {
  const candidates = [
    { metric: 'top7Pct', delta: shift.delta.top7Pct },
    { metric: 'championPct', delta: shift.delta.championPct },
    { metric: 'survivalPct', delta: shift.delta.survivalPct },
    { metric: 'top4Pct', delta: shift.delta.top4Pct },
  ];
  candidates.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  return candidates[0];
}

export function identifyResultThatChanged(
  shifts: ProbabilityShift[],
  results: MatchResult[],
  gameOfWeekShortlist: GameOfWeekCandidate[]
): ResultThatChanged {
  const shiftMap = new Map(shifts.map((s) => [s.team, s]));

  const scored = results.map((result) => {
    const homeShift = shiftMap.get(result.homeTeam);
    const awayShift = shiftMap.get(result.awayTeam);

    // Sum absolute deltas for the two directly involved teams
    let impactScore = 0;
    const topAffected: ResultThatChanged['topAffectedTeams'] = [];

    if (homeShift) {
      impactScore +=
        Math.abs(homeShift.delta.top7Pct) +
        Math.abs(homeShift.delta.championPct) +
        Math.abs(homeShift.delta.survivalPct);
      topAffected.push({ team: result.homeTeam, ...pickBiggestDelta(homeShift) });
    }
    if (awayShift) {
      impactScore +=
        Math.abs(awayShift.delta.top7Pct) +
        Math.abs(awayShift.delta.championPct) +
        Math.abs(awayShift.delta.survivalPct);
      topAffected.push({ team: result.awayTeam, ...pickBiggestDelta(awayShift) });
    }

    // Leverage bonus from Preview's game-of-week scoring
    const leverageBonus =
      gameOfWeekShortlist.find((g) => g.fixtureId === result.fixtureId)?.leverageSpreadPp ?? 0;
    impactScore += leverageBonus;

    // Also add the top 3 league-wide shifts (beyond the two fixture teams)
    const otherShifts = shifts
      .filter((s) => s.team !== result.homeTeam && s.team !== result.awayTeam)
      .map((s) => ({ team: s.team, ...pickBiggestDelta(s) }))
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
      .slice(0, 3);
    topAffected.push(...otherShifts);

    return {
      fixtureId: result.fixtureId,
      homeTeam: result.homeTeam,
      awayTeam: result.awayTeam,
      homeGoals: result.homeGoals,
      awayGoals: result.awayGoals,
      impactScore: Number(impactScore.toFixed(2)),
      topAffectedTeams: topAffected,
    };
  });

  scored.sort((a, b) => b.impactScore - a.impactScore);
  return scored[0];
}

// ── Fixture Update Helper ──

function markFixturesAsFinished(
  allFixtures: Fixture[],
  results: MatchResult[]
): Fixture[] {
  const resultMap = new Map(results.map((r) => [r.fixtureId, r]));

  return allFixtures.map((fixture) => {
    const result = resultMap.get(fixture.id);
    if (!result) return fixture;

    return {
      ...fixture,
      status: 'FINISHED' as const,
      homeScore: result.homeGoals,
      awayScore: result.awayGoals,
    };
  });
}

// ── Full Dossier Assembly ──

export async function buildRoundupDossier(matchday: number): Promise<RoundupDossier> {
  // 1. Load the Preview for this matchday
  const preview = await getWeeklyPreviewByMatchday(matchday, 'NEW');
  if (!preview) {
    throw new Error(
      `No Weekly Preview found for matchday ${matchday}. Generate the Preview first.`
    );
  }

  const preRoundTeams = preview.dossier.teams;
  const preRoundSnapshot = preview.dossier.leagueResults;

  // 2. Fetch actual results
  const results = await fetchMatchdayResults(matchday);
  const warnings: string[] = [];

  const expectedFixtureCount = preview.dossier.nextRoundFixtures.length;
  if (results.length < expectedFixtureCount) {
    warnings.push(
      `Only ${results.length} of ${expectedFixtureCount} matchday fixtures are FINISHED. Roundup may be incomplete.`
    );
  }
  if (results.length === 0) {
    throw new Error(
      `No FINISHED fixtures found for matchday ${matchday}. Wait for results to complete.`
    );
  }

  // 3. Apply results to standings
  const updatedTeams = applyResultsToStandings(preRoundTeams, results);

  // 4. Update fixture list with actual results
  const updatedFixtures = markFixturesAsFinished(preview.dossier.fixtures, results);

  // 4a. Fetch ESPN match events (scorers, assists, cards) and reconcile scores.
  // Football-data.org remains the source of truth for scores; ESPN enriches
  // narrative detail only. Reconciliation surfaces any mismatch as a warning.
  let espnEvents: Awaited<ReturnType<typeof fetchMatchdayEvents>> = [];
  try {
    espnEvents = await fetchMatchdayEvents(matchday, updatedFixtures);
    const reconciliation = reconcileScores(results, espnEvents);
    if (reconciliation.mismatched.length > 0) {
      warnings.push(
        `ESPN score mismatch on ${reconciliation.mismatched.length} fixture(s): ${reconciliation.mismatched.join('; ')}. Trusting football-data.org.`
      );
    }
    if (reconciliation.missingFromESPN.length > 0) {
      warnings.push(
        `${reconciliation.missingFromESPN.length} fixture(s) absent from ESPN: ${reconciliation.missingFromESPN.join('; ')}. Scorers unavailable for these.`
      );
    }
    console.log(
      `[weekly-roundup] ESPN: ${espnEvents.length} events fetched, ${reconciliation.matched} reconciled, ${reconciliation.mismatched.length} mismatched, ${reconciliation.missingFromESPN.length} missing.`
    );
  } catch (error) {
    warnings.push(
      `ESPN fetch failed: ${error instanceof Error ? error.message : String(error)}. Roundup will generate without scorer enrichment.`
    );
  }

  // 5. Run post-round simulation
  const postRoundResults = simulateFull(updatedTeams, updatedFixtures, ROUNDUP_SIM_COUNT);

  // 6. Compute probability shifts
  const probabilityShifts = computeProbabilityShifts(preRoundSnapshot, postRoundResults);

  // 7. Grade perfect weekend
  const perfectWeekendGrades = gradePerfectWeekend(
    preview.dossier.perfectWeekend,
    results
  );
  const correctCount = perfectWeekendGrades.filter((g) => g.correct).length;
  const totalCount = perfectWeekendGrades.length;

  // 8. Identify result that changed everything
  const resultThatChanged = identifyResultThatChanged(
    probabilityShifts,
    results,
    preview.dossier.gameOfWeekShortlist
  );

  // 9. Extract Newcastle-specific data
  const targetClubResult =
    results.find((r) => r.homeTeam === 'NEW' || r.awayTeam === 'NEW') ?? null;

  // Find Newcastle's next SCHEDULED fixture after this matchday for the
  // Deep Dive's Looking Ahead section (post-V1B, this must name the fixture).
  const nextFixture = updatedFixtures
    .filter(
      (f) =>
        f.status === 'SCHEDULED' &&
        f.matchday > matchday &&
        (f.homeTeam === 'NEW' || f.awayTeam === 'NEW')
    )
    .sort((a, b) => a.matchday - b.matchday || a.date.localeCompare(b.date))[0];

  const targetClubNextFixture = nextFixture
    ? {
        fixtureId: nextFixture.id,
        homeTeam: nextFixture.homeTeam,
        awayTeam: nextFixture.awayTeam,
        matchday: nextFixture.matchday,
        date: nextFixture.date,
        isHome: nextFixture.homeTeam === 'NEW',
        opponent: nextFixture.homeTeam === 'NEW' ? nextFixture.awayTeam : nextFixture.homeTeam,
      }
    : null;

  const preNewcastle = preRoundSnapshot.find((r) => r.team === 'NEW');
  const postNewcastle = postRoundResults.find((r) => r.team === 'NEW');
  const targetClubPreTop7Pct = preNewcastle?.top7Pct ?? 0;
  const targetClubPostTop7Pct = postNewcastle?.top7Pct ?? 0;
  const targetClubDeltaTop7Pp = Number(
    (targetClubPostTop7Pct - targetClubPreTop7Pct).toFixed(2)
  );

  // 10. Build data hash
  const dataHash = createHash('sha256')
    .update(
      JSON.stringify({
        version: WEEKLY_ROUNDUP_VERSION,
        matchday,
        results,
        updatedTeams: updatedTeams.map((t) => ({ abbr: t.abbr, points: t.points })),
      })
    )
    .digest('hex')
    .slice(0, 24);

  // 11. Compute rounds remaining
  const roundsRemaining = 38 - matchday;

  // 12. Build previous preview reference
  const topGotwCandidate = preview.dossier.gameOfWeekShortlist[0] ?? null;
  const matchFocusSection = preview.sections.find((s) => s.sectionId === 'match-focus');
  const previousPreview = {
    matchday: preview.matchday,
    perfectWeekend: preview.dossier.perfectWeekend,
    perfectWeekendCumulativeDeltaPp: preview.dossier.perfectWeekendCumulativeDeltaPp,
    gameOfWeekShortlist: preview.dossier.gameOfWeekShortlist,
    gameOfWeekTeams: topGotwCandidate
      ? { home: topGotwCandidate.homeTeam, away: topGotwCandidate.awayTeam }
      : null,
    contestSnapshots: preview.dossier.contestSnapshots,
    clubBaselineTop7Pct: preview.dossier.selectedClubBaseline.top7Pct,
    clubFixtureId: preview.dossier.selectedClubFixture?.id ?? null,
    matchFocusMarkdown: matchFocusSection?.markdown ?? null,
  };

  return {
    version: WEEKLY_ROUNDUP_VERSION,
    generatedAt: Date.now(),
    matchday,
    season: preview.dossier.season,
    club: 'NEW',
    roundsRemaining,
    dataHash,

    teams: updatedTeams,
    preRoundTeams,
    results,

    preRoundSnapshot,
    postRoundResults,
    probabilityShifts,

    previousPreview,

    perfectWeekendGrades,
    perfectWeekendHitRate: totalCount > 0 ? correctCount / totalCount : 0,
    perfectWeekendActualCorrect: correctCount,
    perfectWeekendTotal: totalCount,

    resultThatChanged,
    targetClubResult,
    targetClubNextFixture,
    targetClubPostTop7Pct,
    targetClubPreTop7Pct,
    targetClubDeltaTop7Pp,

    espnEvents,

    // Populated by orchestrator after Phase S
    researchBundle: { matchResearch: [], sources: [] },

    sources: [],
    warnings,
  };
}
