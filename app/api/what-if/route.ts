import { NextRequest, NextResponse } from 'next/server';
import { Team, Fixture, SimulationResult } from '@/lib/types';
import { simulateFull } from '@/lib/server-simulation';
import { agentLoop } from '@/lib/what-if/agent-loop';
import { WHAT_IF_TOOLS, createToolExecutors } from '@/lib/what-if/tools';
import {
  buildDiagnosisPrompt,
  buildHypothesisePrompt,
  buildStressTestPrompt,
  buildSynthesisPrompt,
} from '@/lib/what-if/prompts';
import { CounterfactualScenario, WhatIfAnalysis } from '@/lib/what-if/types';
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
      forceRefresh,
    } = body as {
      action: 'start' | 'diagnose' | 'hypothesise' | 'stress-test' | 'synthesise';
      targetTeam: string;
      targetMetric: keyof SimulationResult;
      teams: Team[];
      fixtures: Fixture[];
      diagnosis?: { squadQualityRank: number; gapToTopSquad: number; keyBottlenecks: string[]; narrativeSummary: string };
      scenarios?: CounterfactualScenario[];
      stressTest?: string;
      forceRefresh?: boolean;
    };

    if (!targetTeam || !targetMetric || !teams || !fixtures) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // ── ACTION: start ──
    if (action === 'start') {
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

      // Run baseline simulation
      const baselineResults = simulateFull(teams, fixtures, 10000);
      const targetResult = baselineResults.find((r) => r.team === targetTeam);
      const baselineOdds = targetResult ? (targetResult[targetMetric] as number) : 0;

      // Get team info
      const team = teams.find((t) => t.abbr === targetTeam);
      const sortedTeams = [...teams].sort((a, b) => b.points - a.points || b.goalDifference - a.goalDifference);
      const position = sortedTeams.findIndex((t) => t.abbr === targetTeam) + 1;
      const gamesRemaining = 38 - (team?.played ?? 0);

      return NextResponse.json({
        cached: false,
        baselineOdds,
        position,
        points: team?.points ?? 0,
        gamesRemaining,
        targetMetricLabel: METRIC_LABELS[targetMetric] ?? targetMetric,
      });
    }

    // Check API key for all AI phases
    if (!OPENROUTER_API_KEY) {
      return NextResponse.json({ error: 'OPENROUTER_API_KEY not configured' }, { status: 500 });
    }

    // ── ACTION: diagnose ──
    if (action === 'diagnose') {
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

      // Diagnosis agent: compare_squads + web_search only
      const diagnosisTools = WHAT_IF_TOOLS.filter((t) =>
        ['compare_squads', 'web_search'].includes(t.function.name)
      );

      const scenarioAccumulator: CounterfactualScenario[] = [];
      const executors = createToolExecutors(teams, fixtures, targetTeam, targetMetric, scenarioAccumulator);

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
      });
    }

    // ── ACTION: hypothesise ──
    if (action === 'hypothesise') {
      if (!diagnosis) {
        return NextResponse.json({ error: 'Missing diagnosis data' }, { status: 400 });
      }

      const baselineResults = simulateFull(teams, fixtures, 10000);
      const targetResult = baselineResults.find((r) => r.team === targetTeam);
      const baselineOdds = targetResult ? (targetResult[targetMetric] as number) : 0;

      const team = teams.find((t) => t.abbr === targetTeam);
      const sortedTeams = [...teams].sort((a, b) => b.points - a.points || b.goalDifference - a.goalDifference);
      const position = sortedTeams.findIndex((t) => t.abbr === targetTeam) + 1;
      const gamesRemaining = 38 - (team?.played ?? 0);
      const teamName = team?.name ?? targetTeam;

      const standingsSummary = sortedTeams
        .map((t, i) => `${i + 1}. ${t.abbr} ${t.points}pts`)
        .join('\n');

      // Find fixture IDs involving the target team
      const teamFixtureIds = fixtures
        .filter((f) => f.status === 'SCHEDULED' && (f.homeTeam === targetTeam || f.awayTeam === targetTeam))
        .map((f) => f.id);

      const scenarioAccumulator: CounterfactualScenario[] = [
        ...(clientScenarios ?? []),
      ];

      const executors = createToolExecutors(teams, fixtures, targetTeam, targetMetric, scenarioAccumulator);

      const prompt = buildHypothesisePrompt({
        teamName,
        teamAbbr: targetTeam,
        targetLabel: METRIC_LABELS[targetMetric] ?? targetMetric,
        targetMetric,
        baselineOdds,
        position,
        points: team?.points ?? 0,
        gamesRemaining,
        standingsSummary,
        diagnosisNarrative: diagnosis.narrativeSummary,
        squadRank: diagnosis.squadQualityRank,
        squadAvg: 0, // Will be filled by compare_squads call
        gapToTop: diagnosis.gapToTopSquad,
        bottlenecks: diagnosis.keyBottlenecks,
        fixtureIds: teamFixtureIds,
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
      });
    }

    // ── ACTION: stress-test ──
    if (action === 'stress-test') {
      const scenarios = clientScenarios ?? [];
      if (scenarios.length === 0) {
        return NextResponse.json({ error: 'No scenarios to stress-test' }, { status: 400 });
      }

      const team = teams.find((t) => t.abbr === targetTeam);
      const teamName = team?.name ?? targetTeam;

      // Stress test agent: web_search only
      const stressTestTools = WHAT_IF_TOOLS.filter((t) => t.function.name === 'web_search');
      const scenarioAccumulator: CounterfactualScenario[] = [];
      const executors = createToolExecutors(teams, fixtures, targetTeam, targetMetric, scenarioAccumulator);

      const prompt = buildStressTestPrompt({
        teamName,
        targetLabel: METRIC_LABELS[targetMetric] ?? targetMetric,
        scenarios: scenarios.slice(0, 5), // Top 5 only
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
      });
    }

    // ── ACTION: synthesise ──
    if (action === 'synthesise') {
      const scenarios = clientScenarios ?? [];
      const stressTestFindings = clientStressTest ?? 'No stress test data available.';

      const team = teams.find((t) => t.abbr === targetTeam);
      const teamName = team?.name ?? targetTeam;

      const baselineResults = simulateFull(teams, fixtures, 10000);
      const targetResult = baselineResults.find((r) => r.team === targetTeam);
      const baselineOdds = targetResult ? (targetResult[targetMetric] as number) : 0;

      const perfectWorld = scenarios.find((s) => s.category === 'perfect_world');
      const perfectWorldOdds = perfectWorld?.simulationResult.modifiedOdds ?? baselineOdds;

      const prompt = buildSynthesisPrompt({
        teamName,
        teamAbbr: targetTeam,
        targetLabel: METRIC_LABELS[targetMetric] ?? targetMetric,
        targetMetric,
        baselineOdds,
        diagnosisNarrative: diagnosis?.narrativeSummary ?? '',
        scenarios,
        stressTestFindings,
        perfectWorldOdds,
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

      const narrative = extractJSON(message.content ?? '');

      // Build final analysis
      const analysis: WhatIfAnalysis = {
        id: `whatif-${targetTeam}-${targetMetric}-${Date.now()}`,
        generatedAt: Date.now(),
        targetTeam,
        targetTeamName: teamName,
        targetMetric,
        targetMetricLabel: METRIC_LABELS[targetMetric] ?? targetMetric,
        baselineOdds,
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
        totalSimulations: scenarios.length + 1,
        totalWebSearches: 0,
        totalLLMCalls: 0,
        wallClockTimeMs: 0,
        costEstimate: 0,
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
      });
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (error) {
    console.error('[WhatIf] Error:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
