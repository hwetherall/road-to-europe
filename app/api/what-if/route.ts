import { NextRequest, NextResponse } from 'next/server';
import { Team, Fixture, SimulationResult } from '@/lib/types';
import { simulateFull } from '@/lib/server-simulation';
import { simulateFullSeason } from '@/lib/what-if/full-season-sim';
import { agentLoop } from '@/lib/what-if/agent-loop';
import { WHAT_IF_TOOLS, createToolExecutors, FullSeasonBaseline } from '@/lib/what-if/tools';
import {
  buildDiagnosisPrompt,
  buildHypothesisePrompt,
  buildStressTestPrompt,
  buildSynthesisPrompt,
  buildSquadContext,
} from '@/lib/what-if/prompts';
import {
  CounterfactualScenario,
  WhatIfAnalysis,
  WHAT_IF_ANALYSIS_VERSION,
  WhatIfSearchTraceEntry,
} from '@/lib/what-if/types';
import {
  createWhatIfScenarioKey,
  getCachedWhatIfAnalysis,
  isWhatIfCacheConfigured,
  upsertWhatIfCache,
} from '@/lib/what-if/what-if-cache';

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

// ── Metric Labels ──

const METRIC_LABELS: Record<string, string> = {
  championPct: 'League Champions',
  top4Pct: 'Top 4 (Champions League)',
  top5Pct: 'Top 5',
  top6Pct: 'Top 6 (Europa League)',
  top7Pct: 'Top 7 (Any Europe)',
  relegationPct: 'Relegation',
  survivalPct: 'Survival',
};

function determinePragmaticMetric(position: number): string {
  if (position >= 15) return 'survivalPct';
  if (position >= 8) return 'top10';
  return 'top7Pct';
}

function readPragmaticMetric(result: SimulationResult | undefined, metric: string): number {
  if (!result) return 0;
  if (metric === 'survivalPct') return result.survivalPct;
  if (metric === 'top10') {
    return result.positionDistribution.slice(0, 10).reduce((a, b) => a + b, 0)
      / result.positionDistribution.reduce((a, b) => a + b, 0) * 100;
  }
  return (result as unknown as Record<string, number>)[metric] ?? 0;
}

const PRAGMATIC_METRIC_LABELS: Record<string, string> = {
  survivalPct: 'Premier League survival',
  top10: 'a top-10 finish',
  top7Pct: 'European qualification',
  top4Pct: 'Champions League qualification',
};

interface PhaseStats {
  webSearches: number;
  llmCalls: number;
  simulationCalls: number;
  wallClockMs: number;
  searchTrail: WhatIfSearchTraceEntry[];
}

const EMPTY_PHASE_STATS: PhaseStats = {
  webSearches: 0,
  llmCalls: 0,
  simulationCalls: 0,
  wallClockMs: 0,
  searchTrail: [],
};

// ── Helper: parse JSON from LLM output ──

function extractJSON(content: string): Record<string, unknown> | null {
  const match = content.match(/```json\s*([\s\S]*?)\s*```/);
  const jsonStr = match ? match[1] : content;
  try {
    return JSON.parse(jsonStr.trim());
  } catch {
    // Try to find JSON object in the content
    const objMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (objMatch) {
      try {
        return JSON.parse(objMatch[0]);
      } catch {
        return null;
      }
    }
    return null;
  }
}

// ── Compute full-season baseline once ──

function computeFullSeasonBaseline(
  teams: Team[],
  fixtures: Fixture[],
  targetTeam: string,
  targetMetric: keyof SimulationResult
): FullSeasonBaseline {
  const results = simulateFullSeason({
    teams,
    fixtures,
    modifications: [],
    numSims: 10000,
  });
  const targetResult = results.find((r) => r.team === targetTeam);
  return {
    targetMetricPct: targetResult ? (targetResult[targetMetric] as number) : 0,
    expectedPoints: targetResult?.avgPoints ?? 0,
    expectedPosition: targetResult?.avgPosition ?? 0,
  };
}

// ── Main Handler ──

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      action,
      targetTeam,
      targetMetric,
      teams,
      fixtures,
      // Phase-specific data passed from client
      diagnosis,
      scenarios: clientScenarios,
      stressTest: clientStressTest,
      pipelineStats,
      forceRefresh,
    } = body as {
      action: 'start' | 'diagnose' | 'hypothesise' | 'stress-test' | 'synthesise';
      targetTeam: string;
      targetMetric: keyof SimulationResult;
      teams: Team[];
      fixtures: Fixture[];
      diagnosis?: {
        squadQualityRank: number;
        gapToTopSquad: number;
        keyBottlenecks: string[];
        narrativeSummary: string;
        departedPlayers?: { name: string; to: string; fee: string; overall: number; position: string }[];
      };
      scenarios?: CounterfactualScenario[];
      stressTest?: string;
      pipelineStats?: PhaseStats;
      forceRefresh?: boolean;
    };

    if (!targetTeam || !targetMetric || !teams || !fixtures) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // ── ACTION: start ──
    if (action === 'start') {
      const startedAt = Date.now();
      // Check cache
      if (!forceRefresh && isWhatIfCacheConfigured()) {
        const scenarioKey = createWhatIfScenarioKey({ targetTeam, targetMetric, teams, fixtures });
        const cached = await getCachedWhatIfAnalysis({ scenarioKey, targetTeam, targetMetric });
        if (cached) {
          return NextResponse.json({
            cached: true,
            analysis: cached.analysis,
            cacheMatchType: cached.cacheMatchType,
            cachedAt: cached.generatedAt,
          });
        }
      }

      // Run baseline simulation (remaining-games, for current-season odds display)
      const baselineResults = simulateFull(teams, fixtures, 10000);
      const targetResult = baselineResults.find((r) => r.team === targetTeam);
      const baselineOdds = targetResult ? (targetResult[targetMetric] as number) : 0;

      // Also compute full-season baseline for the What-If pipeline
      const fullSeasonBaseline = computeFullSeasonBaseline(teams, fixtures, targetTeam, targetMetric);

      // Get team info
      const team = teams.find((t) => t.abbr === targetTeam);
      const sortedTeams = [...teams].sort((a, b) => b.points - a.points || b.goalDifference - a.goalDifference);
      const position = sortedTeams.findIndex((t) => t.abbr === targetTeam) + 1;
      const gamesRemaining = 38 - (team?.played ?? 0);

      // Pre-compute squad context
      const teamName = team?.name ?? targetTeam;
      const squadContext = await buildSquadContext(teamName);

      return NextResponse.json({
        cached: false,
        baselineOdds,
        fullSeasonBaseline,
        squadContext,
        position,
        points: team?.points ?? 0,
        gamesRemaining,
        targetMetricLabel: METRIC_LABELS[targetMetric] ?? targetMetric,
        stats: {
          ...EMPTY_PHASE_STATS,
          wallClockMs: Date.now() - startedAt,
        },
      });
    }

    // Check API key for all AI phases
    if (!OPENROUTER_API_KEY) {
      return NextResponse.json({ error: 'OPENROUTER_API_KEY not configured' }, { status: 500 });
    }

    // ── ACTION: diagnose ──
    if (action === 'diagnose') {
      const startedAt = Date.now();
      const baselineResults = simulateFull(teams, fixtures, 10000);
      const targetResult = baselineResults.find((r) => r.team === targetTeam);
      const baselineOdds = targetResult ? (targetResult[targetMetric] as number) : 0;

      const team = teams.find((t) => t.abbr === targetTeam);
      const sortedTeams = [...teams].sort((a, b) => b.points - a.points || b.goalDifference - a.goalDifference);
      const position = sortedTeams.findIndex((t) => t.abbr === targetTeam) + 1;
      const gamesRemaining = 38 - (team?.played ?? 0);

      const standingsSummary = sortedTeams
        .map((t, i) => `${i + 1}. ${t.abbr} ${t.points}pts (GD ${t.goalDifference > 0 ? '+' : ''}${t.goalDifference})`)
        .join('\n');

      const teamName = team?.name ?? targetTeam;

      // Pre-compute squad context for diagnosis
      const squadContext = await buildSquadContext(teamName);

      // Diagnosis agent: compare_squads + web_search only
      const diagnosisTools = WHAT_IF_TOOLS.filter((t) =>
        ['compare_squads', 'web_search'].includes(t.function.name)
      );

      const scenarioAccumulator: CounterfactualScenario[] = [];
      const searchTrail: WhatIfSearchTraceEntry[] = [];
      const executors = createToolExecutors(
        teams,
        fixtures,
        targetTeam,
        targetMetric,
        scenarioAccumulator,
        undefined,
        searchTrail,
        'diagnose'
      );

      const prompt = buildDiagnosisPrompt({
        teamName,
        teamAbbr: targetTeam,
        targetLabel: METRIC_LABELS[targetMetric] ?? targetMetric,
        targetMetric,
        baselineOdds,
        position,
        points: team?.points ?? 0,
        gamesRemaining,
        standingsSummary,
        teams,
        fixtures,
        squadContext,
      });

      const result = await agentLoop({
        systemPrompt: prompt.system,
        userPrompt: prompt.user,
        tools: diagnosisTools,
        toolExecutors: executors,
        maxRounds: 8,
        maxTokens: 4000,
      });

      const parsed = extractJSON(result.finalContent);
      const stats: PhaseStats = {
        webSearches: result.toolCallLog.filter((call) => call.toolName === 'web_search').length,
        llmCalls: result.llmCalls,
        simulationCalls: result.toolCallLog.filter((call) => call.toolName === 'run_simulation').length,
        wallClockMs: Date.now() - startedAt,
        searchTrail,
      };

      return NextResponse.json({
        phase: 'diagnose',
        status: 'complete',
        diagnosis: parsed ?? {
          squadQualityRank: 0,
          gapToTopSquad: 0,
          keyBottlenecks: ['Unable to parse diagnosis'],
          narrativeSummary: result.finalContent,
        },
        toolCalls: result.toolCallLog.length,
        rounds: result.rounds,
        stats,
      });
    }

    // ── ACTION: hypothesise ──
    if (action === 'hypothesise') {
      const startedAt = Date.now();
      if (!diagnosis) {
        return NextResponse.json({ error: 'Missing diagnosis data' }, { status: 400 });
      }

      // Compute full-season baseline (cached for this phase)
      const fullSeasonBaseline = computeFullSeasonBaseline(teams, fixtures, targetTeam, targetMetric);

      const team = teams.find((t) => t.abbr === targetTeam);
      const sortedTeams = [...teams].sort((a, b) => b.points - a.points || b.goalDifference - a.goalDifference);
      const position = sortedTeams.findIndex((t) => t.abbr === targetTeam) + 1;
      const gamesRemaining = 38 - (team?.played ?? 0);
      const teamName = team?.name ?? targetTeam;

      const standingsSummary = sortedTeams
        .map((t, i) => `${i + 1}. ${t.abbr} ${t.points}pts`)
        .join('\n');

      const fixtureCatalog = fixtures
        .filter((f) => f.status === 'SCHEDULED')
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((f) => {
          const tags: string[] = [];
          if (f.homeTeam === targetTeam || f.awayTeam === targetTeam) {
            tags.push('target team');
          }
          return `${f.id}: ${f.homeTeam} vs ${f.awayTeam}${tags.length > 0 ? ` [${tags.join(', ')}]` : ''}`;
        })
        .join('\n');

      // Pre-compute squad context
      const squadContext = await buildSquadContext(teamName);

      const scenarioAccumulator: CounterfactualScenario[] = [
        ...(clientScenarios ?? []),
      ];

      const searchTrail: WhatIfSearchTraceEntry[] = [];
      const executors = createToolExecutors(
        teams,
        fixtures,
        targetTeam,
        targetMetric,
        scenarioAccumulator,
        fullSeasonBaseline,
        searchTrail,
        'hypothesise'
      );

      const prompt = buildHypothesisePrompt({
        teamName,
        teamAbbr: targetTeam,
        targetLabel: METRIC_LABELS[targetMetric] ?? targetMetric,
        targetMetric,
        baselineOdds: fullSeasonBaseline.targetMetricPct,
        position,
        points: team?.points ?? 0,
        gamesRemaining,
        standingsSummary,
        diagnosisNarrative: diagnosis.narrativeSummary,
        squadRank: diagnosis.squadQualityRank,
        squadAvg: 0, // Will be filled by compare_squads call
        gapToTop: diagnosis.gapToTopSquad,
        bottlenecks: diagnosis.keyBottlenecks,
        fixtureCatalog,
        teams,
        fixtures,
        squadContext,
        departedPlayers: diagnosis.departedPlayers,
        baselineExpectedPoints: fullSeasonBaseline.expectedPoints,
      });

      const result = await agentLoop({
        systemPrompt: prompt.system,
        userPrompt: prompt.user,
        tools: WHAT_IF_TOOLS,
        toolExecutors: executors,
        maxRounds: 40,
        maxTokens: 4000,
      });

      return NextResponse.json({
        phase: 'hypothesise',
        status: 'complete',
        scenarios: scenarioAccumulator,
        toolCalls: result.toolCallLog.length,
        rounds: result.rounds,
        summary: extractJSON(result.finalContent),
        stats: {
          webSearches: result.toolCallLog.filter((call) => call.toolName === 'web_search').length,
          llmCalls: result.llmCalls,
          simulationCalls: result.toolCallLog.filter((call) => call.toolName === 'run_simulation').length,
          wallClockMs: Date.now() - startedAt,
          searchTrail,
        },
      });
    }

    // ── ACTION: stress-test ──
    if (action === 'stress-test') {
      const startedAt = Date.now();
      const scenarios = clientScenarios ?? [];
      if (scenarios.length === 0) {
        return NextResponse.json({ error: 'No scenarios to stress-test' }, { status: 400 });
      }

      const team = teams.find((t) => t.abbr === targetTeam);
      const teamName = team?.name ?? targetTeam;

      // Pre-compute squad context
      const squadContext = await buildSquadContext(teamName);

      // Stress test agent: web_search only
      const stressTestTools = WHAT_IF_TOOLS.filter((t) => t.function.name === 'web_search');
      const scenarioAccumulator: CounterfactualScenario[] = [];
      const searchTrail: WhatIfSearchTraceEntry[] = [];
      const executors = createToolExecutors(
        teams,
        fixtures,
        targetTeam,
        targetMetric,
        scenarioAccumulator,
        undefined,
        searchTrail,
        'stress-test'
      );

      const prompt = buildStressTestPrompt({
        teamName,
        targetLabel: METRIC_LABELS[targetMetric] ?? targetMetric,
        scenarios: scenarios.slice(0, 5), // Top 5 only
        teams,
        fixtures,
        squadContext,
        departedPlayers: diagnosis?.departedPlayers,
      });

      const result = await agentLoop({
        systemPrompt: prompt.system,
        userPrompt: prompt.user,
        tools: stressTestTools,
        toolExecutors: executors,
        maxRounds: 15,
        maxTokens: 4000,
      });

      return NextResponse.json({
        phase: 'stress_test',
        status: 'complete',
        stressTest: result.finalContent,
        parsed: extractJSON(result.finalContent),
        toolCalls: result.toolCallLog.length,
        rounds: result.rounds,
        stats: {
          webSearches: result.toolCallLog.filter((call) => call.toolName === 'web_search').length,
          llmCalls: result.llmCalls,
          simulationCalls: result.toolCallLog.filter((call) => call.toolName === 'run_simulation').length,
          wallClockMs: Date.now() - startedAt,
          searchTrail,
        },
      });
    }

    // ── ACTION: synthesise ──
    if (action === 'synthesise') {
      const startedAt = Date.now();
      const scenarios = clientScenarios ?? [];
      const stressTestFindings = clientStressTest ?? 'No stress test data available.';

      const team = teams.find((t) => t.abbr === targetTeam);
      const teamName = team?.name ?? targetTeam;

      // Use full-season baseline for synthesis context
      const fullSeasonBaseline = computeFullSeasonBaseline(teams, fixtures, targetTeam, targetMetric);
      const baselineOdds = fullSeasonBaseline.targetMetricPct;

      const perfectWorld = scenarios.find((s) => s.category === 'perfect_world');
      const perfectWorldOdds = perfectWorld?.simulationResult.modifiedOdds ?? baselineOdds;

      const sortedTeams = [...teams].sort((a, b) => b.points - a.points || b.goalDifference - a.goalDifference);
      const currentPosition = sortedTeams.findIndex((t) => t.abbr === targetTeam) + 1;

      // ── Compute pragmatic redirect numbers ──
      const bestRealistic = scenarios
        .filter(s => s.category !== 'perfect_world' && s.plausibility.score >= 15)
        .sort((a, b) => b.simulationResult.delta * b.plausibility.score
                       - a.simulationResult.delta * a.plausibility.score)[0];

      const pragmaticMetric = determinePragmaticMetric(currentPosition);

      let pragmaticSimResult: {
        metric: string;
        metricLabel: string;
        baselineValue: number;
        modifiedValue: number;
        scenarioTitle: string;
        baselineExpectedPoints: number;
        modifiedExpectedPoints: number;
        baselineExpectedPosition: number;
        modifiedExpectedPosition: number;
      } | null = null;

      if (bestRealistic && pragmaticMetric !== targetMetric) {
        const pragmaticResults = simulateFullSeason({
          teams,
          fixtures,
          modifications: bestRealistic.modifications.map(m => ({
            teamAbbr: m.teamAbbr ?? '',
            homeWinDelta: m.homeWinDelta ?? 0,
            awayWinDelta: m.awayWinDelta ?? 0,
            drawDelta: m.drawDelta ?? 0,
          })),
          numSims: 10000,
        });

        const pragmaticTarget = pragmaticResults.find(r => r.team === targetTeam);
        const baselineResultsForPragmatic = simulateFullSeason({
          teams,
          fixtures,
          modifications: [],
          numSims: 10000,
        });
        const baselineForPragmatic = baselineResultsForPragmatic.find(r => r.team === targetTeam);

        pragmaticSimResult = {
          metric: pragmaticMetric,
          metricLabel: PRAGMATIC_METRIC_LABELS[pragmaticMetric] ?? pragmaticMetric,
          baselineValue: readPragmaticMetric(baselineForPragmatic, pragmaticMetric),
          modifiedValue: readPragmaticMetric(pragmaticTarget, pragmaticMetric),
          scenarioTitle: bestRealistic.title,
          baselineExpectedPoints: baselineForPragmatic?.avgPoints ?? 0,
          modifiedExpectedPoints: pragmaticTarget?.avgPoints ?? 0,
          baselineExpectedPosition: baselineForPragmatic?.avgPosition ?? 0,
          modifiedExpectedPosition: pragmaticTarget?.avgPosition ?? 0,
        };
      }

      const prompt = buildSynthesisPrompt({
        teamName,
        targetLabel: METRIC_LABELS[targetMetric] ?? targetMetric,
        targetMetric,
        baselineOdds,
        baselineExpectedPoints: fullSeasonBaseline.expectedPoints,
        baselineExpectedPosition: fullSeasonBaseline.expectedPosition,
        currentPosition,
        diagnosisNarrative: diagnosis?.narrativeSummary ?? '',
        scenarios,
        stressTestFindings,
        perfectWorldOdds,
        departedPlayers: diagnosis?.departedPlayers,
        pragmaticSimResult,
        teams,
        fixtures,
      });

      // Synthesis doesn't need tools
      const { callOpenRouter } = await import('@/lib/openrouter');
      const message = await callOpenRouter(
        [
          { role: 'system', content: prompt.system },
          { role: 'user', content: prompt.user },
        ],
        { maxTokens: 6000 }
      );

      const combinedStats: PhaseStats = {
        webSearches: pipelineStats?.webSearches ?? 0,
        llmCalls: (pipelineStats?.llmCalls ?? 0) + 1,
        simulationCalls: pipelineStats?.simulationCalls ?? 0,
        wallClockMs: (pipelineStats?.wallClockMs ?? 0) + (Date.now() - startedAt),
        searchTrail: pipelineStats?.searchTrail ?? [],
      };

      const narrative = extractJSON(message.content ?? '');

      // Build final analysis
      const analysis: WhatIfAnalysis = {
        id: `whatif-${targetTeam}-${targetMetric}-${Date.now()}`,
        version: WHAT_IF_ANALYSIS_VERSION,
        generatedAt: Date.now(),
        targetTeam,
        targetTeamName: teamName,
        targetMetric,
        targetMetricLabel: METRIC_LABELS[targetMetric] ?? targetMetric,
        baselineOdds,
        baselineExpectedPoints: fullSeasonBaseline.expectedPoints,
        baselineExpectedPosition: fullSeasonBaseline.expectedPosition,
        diagnosis: diagnosis ?? {
          squadQualityRank: 0,
          gapToTopSquad: 0,
          keyBottlenecks: [],
          narrativeSummary: '',
        },
        scenarios,
        perfectWorld: perfectWorld ?? scenarios[0],
        stressTest: {
          feasibleScenarios: scenarios.filter((s) => s.plausibility.score >= 30),
          infeasibleReasons: {},
        },
        narrative: {
          perfectWorldSection: (narrative?.perfectWorldSection as string) ?? '',
          realityCheckSection: (narrative?.realityCheckSection as string) ?? '',
          pragmaticPathSection: (narrative?.pragmaticPathSection as string) ?? '',
          longTermPerspective: (narrative?.longTermPerspective as string) ?? '',
          bottomLine: (narrative?.bottomLine as string) ?? '',
        },
        totalIterations: scenarios.length,
        totalSimulations: combinedStats.simulationCalls,
        totalWebSearches: combinedStats.webSearches,
        totalLLMCalls: combinedStats.llmCalls,
        wallClockTimeMs: combinedStats.wallClockMs,
        costEstimate: Math.round(
          (combinedStats.llmCalls * 0.025 + combinedStats.webSearches * 0.005) * 100
        ) / 100,
        searchTrail: combinedStats.searchTrail,
      };

      // Cache the result
      if (isWhatIfCacheConfigured()) {
        const scenarioKey = createWhatIfScenarioKey({ targetTeam, targetMetric, teams, fixtures });
        const gamesPlayed = team?.played ?? 0;
        const gameweek = gamesPlayed; // Approximate gameweek from games played

        await upsertWhatIfCache({
          scenarioKey,
          targetTeam,
          targetMetric,
          gameweek,
          analysis,
        });
      }

      return NextResponse.json({
        phase: 'synthesise',
        status: 'complete',
        analysis,
        stats: {
          ...combinedStats,
        },
      });
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (error) {
    console.error('[WhatIf] Error:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
