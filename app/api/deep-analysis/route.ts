import { NextRequest, NextResponse } from 'next/server';
import { pathSearch } from '@/lib/path-search';
import {
  Team,
  Fixture,
  PathSearchConfig,
  PathSearchResult,
  DeepAnalysis,
  SensitivityResult,
  CandidatePath,
} from '@/lib/types';

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const TAVILY_API_KEY = process.env.TAVILY_API_KEY;

// ── Search Execution (reused from chat route) ──

async function executeWebSearch(query: string): Promise<string> {
  if (TAVILY_API_KEY) {
    try {
      const response = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: TAVILY_API_KEY,
          query,
          search_depth: 'basic',
          max_results: 5,
          include_answer: true,
        }),
      });
      if (response.ok) {
        const data = await response.json();
        const parts: string[] = [];
        if (data.answer) parts.push(`Summary: ${data.answer}`);
        if (data.results?.length) {
          const snippets = data.results
            .slice(0, 3)
            .map((r: { title?: string; content?: string; url?: string }) => {
              const content = r.content?.slice(0, 250) ?? '';
              return `- ${r.title ?? 'Result'}: ${content}${r.url ? ` [${r.url}]` : ''}`;
            })
            .join('\n');
          parts.push(`\nTop results:\n${snippets}`);
        }
        return parts.join('\n') || 'No results found.';
      }
    } catch (e) {
      console.error('Tavily search failed:', e);
    }
  }
  return '[Search unavailable — no TAVILY_API_KEY configured.]';
}

// ── OpenRouter Call ──

interface OpenRouterMessage {
  role: string;
  content?: string;
  tool_calls?: Array<{
    id: string;
    type: string;
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

const TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'web_search',
      description:
        'Search the web for current football information. Use this to verify claims about current squads, form, injuries, tactics, results.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search query. Include current year/season for recency.',
          },
        },
        required: ['query'],
      },
    },
  },
];

async function callOpenRouter(
  messages: OpenRouterMessage[],
  tools?: typeof TOOLS
): Promise<OpenRouterMessage> {
  const body: Record<string, unknown> = {
    model: 'anthropic/claude-opus-4.6',
    messages,
    max_tokens: 4000,
  };
  if (tools && tools.length > 0) body.tools = tools;

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error('OpenRouter error:', error);
    throw new Error(`OpenRouter API error: ${response.status}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message ?? { role: 'assistant', content: '' };
}

// ── Narrative Agent ──

function formatOptimalPath(path: CandidatePath): string {
  return path.locks
    .map(
      (l) =>
        `  - ${l.homeTeam} vs ${l.awayTeam}: ${l.resultLabel} (${(l.individualPlausibility * 100).toFixed(0)}% likely)`
    )
    .join('\n');
}

function formatCandidatePath(path: CandidatePath, index: number): string {
  return `Path ${index + 1} (plausibility: ${(path.compositePlausibility * 100).toFixed(1)}%, resulting odds: ${path.resultingOdds.toFixed(1)}%):
${path.locks.map((l) => `  - ${l.homeTeam} vs ${l.awayTeam}: ${l.resultLabel}`).join('\n')}`;
}

function formatSensitivity(s: SensitivityResult): string {
  const best = Math.max(s.deltaIfHomeWin, s.deltaIfDraw, s.deltaIfAwayWin);
  const worst = Math.min(s.deltaIfHomeWin, s.deltaIfDraw, s.deltaIfAwayWin);
  return `  ${s.homeTeam} vs ${s.awayTeam}: best +${best.toFixed(1)}pp / worst ${worst.toFixed(1)}pp`;
}

// ── Two-Phase Narrative Pipeline ──
// Phase A: Research agent builds a verified fact sheet via web searches
// Phase B: Writing agent composes the analysis using ONLY facts from the sheet

function buildResearchPrompt(
  pathResult: PathSearchResult,
  config: PathSearchConfig,
  teamName: string,
  teamsToResearch: string[]
): string {
  const currentDate = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

  return `You are a football research assistant. Your job is to build a VERIFIED FACT SHEET about specific Premier League teams. The current date is ${currentDate}.

## YOUR TASK
Research the following teams and produce a structured fact sheet. You MUST search for every single claim. Do NOT use training knowledge — it is outdated and unreliable.

Teams to research: ${teamsToResearch.join(', ')}

## REQUIRED SEARCHES (do ALL of these)
For EACH team listed above, perform these searches:
1. "[team] manager head coach 2026" — WHO is the current manager? Managers get sacked constantly. This is the #1 source of errors.
2. "[team] squad key players 2025-26" — WHO actually plays for this team right now? Players transfer and get loaned. Verify every name.
3. "[team] form results March 2026" — recent results and form
4. "[team] injuries suspensions March 2026" — who is available?
5. "[team] tactics playing style 2025-26" — how do they play under the CURRENT manager?

## OUTPUT FORMAT
After completing your research, output a fact sheet in this exact format:

\`\`\`factsheet
TEAM: [team name]
MANAGER: [verified name] (since [date if known])
KEY PLAYERS (CONFIRMED ON CURRENT SQUAD): [comma-separated list — ONLY players confirmed to be at this club RIGHT NOW]
PLAYERS WHO HAVE LEFT: [any notable former players you discovered have moved — include where they went]
RECENT FORM: [last 5 results if available]
INJURIES/SUSPENSIONS: [current absences]
TACTICAL STYLE: [how they play under current manager]
STRENGTHS: [2-3 specific strengths]
WEAKNESSES: [2-3 specific weaknesses]
HOME/AWAY RECORD: [if found]
---
\`\`\`

Repeat this block for each team.

## CRITICAL RULES
- If a search says a player has TRANSFERRED or been LOANED OUT, they are NOT on the current squad. Do not list them.
- If you find conflicting information about a manager, use the MOST RECENT source.
- If you cannot verify something, write "UNVERIFIED" rather than guessing.
- Better to have fewer facts that are correct than many facts that might be wrong.`;
}

function buildWritingPrompt(
  pathResult: PathSearchResult,
  config: PathSearchConfig,
  teamName: string,
  position: number,
  points: number,
  gapToTarget: number,
  gamesRemaining: number,
  factSheet: string
): string {
  const isRelegation = config.targetMetric === 'relegationPct';
  const isChampion = config.targetMetric === 'championPct';
  const objectiveLabel = isChampion ? 'winning the league title' : isRelegation ? 'avoiding relegation' : 'qualifying for Europe';

  return `You are Keepwatch's Deep Analysis writer. You produce a concise, punchy analysis document about ${teamName}'s chances of ${objectiveLabel}.

## YOUR CONSTRAINT
You have been given a VERIFIED FACT SHEET from a research agent. You may ONLY reference facts that appear in this fact sheet. If a player, manager, or tactic is not in the fact sheet, do NOT mention them. This is non-negotiable.

## VERIFIED FACT SHEET
${factSheet}

## SIMULATION DATA
Team: ${teamName} (${config.targetTeam})
Position: ${position}th, ${points} points
Gap to target: ${gapToTarget} points
Games remaining: ${gamesRemaining}
Baseline ${config.targetMetric}: ${pathResult.baselineOdds.toFixed(1)}%

Optimal path (ceiling, ${pathResult.optimalPath.resultingOdds.toFixed(1)}%):
${formatOptimalPath(pathResult.optimalPath)}
Plausibility: ${(pathResult.optimalPath.compositePlausibility * 100).toFixed(2)}%

Candidate paths:
${pathResult.candidatePaths.map(formatCandidatePath).join('\n\n')}

Top sensitivity fixtures:
${pathResult.sensitivityData.slice(0, 10).map(formatSensitivity).join('\n')}

## TONE
Write like a well-prepared football analyst: specific, data-informed, occasionally surprising.
- Identify "angles of attack" (set-piece mismatches, transition vulnerabilities, fatigue patterns)
- Do NOT prescribe formations or starting XIs
- If a well-read fan on a podcast could say it with confidence, it's in bounds

## BREVITY IS CRITICAL
- "contextNarrative": 3-4 punchy sentences MAX. The stat pills already show position, gap, remaining games, baseline odds — don't repeat numbers.
- "summary": 2-3 SHORT sentences. Pundit sign-off.
- "risks": 1-2 sentences each. Specific opponent threats in THIS match.
- "angles": 2-3 sentences each. Specific tactical mismatches.

## OUTPUT FORMAT
Return a JSON object. Wrap in \`\`\`json blocks.

{
  "stateOfPlay": {
    "contextNarrative": "3-4 sentences MAX."
  },
  "decisiveMatch": {
    "fixtureId": "${pathResult.sensitivityData[0]?.fixtureId ?? ''}",
    "homeTeam": "${pathResult.sensitivityData[0]?.homeTeam ?? ''}",
    "awayTeam": "${pathResult.sensitivityData[0]?.awayTeam ?? ''}",
    "date": "human-readable date",
    "risks": ["Specific opponent threat from the fact sheet. Name real players/tactics. 1-2 sentences.", "...", "..."],
    "angles": [{"title": "5-8 word title", "analysis": "2-3 sentences referencing fact sheet"}],
    "whatToWatch": ["Specific in-match indicator a viewer can track"]
  },
  "matchesToWatch": [
    {
      "fixtureId": "id",
      "homeTeam": "XXX",
      "awayTeam": "XXX",
      "whyItMatters": "2-3 sentences using simulation data",
      "idealResult": "what result is needed",
      "whyItsPlausible": "1-2 sentences using fact sheet data",
      "simulationImpact": "e.g. +4pp"
    }
  ],
  "bottomLine": {
    "summary": "2-3 SHORT sentences. Name the scenario, say why it works, done.",
    "keyScenario": "One concrete sentence naming the specific combination of results."
  },
  "sources": []
}

## RULES
- "risks" = specific threats the OPPONENT poses. "Their striker [name from fact sheet] has scored X goals" or "Under [manager from fact sheet], they press aggressively". NEVER use a player/manager name not in the fact sheet.
- "angles" = specific mismatches ${teamName} can exploit, grounded in fact sheet data.
- "whatToWatch" = in-match indicators a viewer can track.
- DO NOT invent any facts. If the fact sheet doesn't cover something, omit it or keep it generic.
- DO NOT reference "Path 1" or "Path 2" by name — the reader hasn't seen those. Instead describe the scenario in plain language.`;
}

async function runResearchPhase(
  pathResult: PathSearchResult,
  config: PathSearchConfig,
  teamName: string,
  teamsToResearch: string[]
): Promise<{ factSheet: string; sources: string[]; searchCount: number }> {
  const systemPrompt = buildResearchPrompt(pathResult, config, teamName, teamsToResearch);

  const conversation: OpenRouterMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `Research all the teams listed and build the fact sheet. Start searching now.` },
  ];

  const sources: string[] = [];
  let searchCount = 0;
  const MAX_ROUNDS = 15;

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const message = await callOpenRouter(conversation, TOOLS);

    if (!message.tool_calls || message.tool_calls.length === 0) {
      // Research complete — extract the fact sheet
      const content = message.content ?? '';
      const factMatch = content.match(/```factsheet\s*([\s\S]*?)```/);
      const factSheet = factMatch ? factMatch[1].trim() : content;
      return { factSheet, sources, searchCount };
    }

    conversation.push(message);

    for (const call of message.tool_calls) {
      if (call.function.name === 'web_search') {
        let query: string;
        try {
          const args = JSON.parse(call.function.arguments);
          query = args.query;
        } catch {
          query = call.function.arguments;
        }

        searchCount++;
        try {
          const searchResults = await executeWebSearch(query);
          const urlMatches = searchResults.match(/\[https?:\/\/[^\]]+\]/g);
          if (urlMatches) {
            sources.push(...urlMatches.map((u) => u.slice(1, -1)));
          }
          conversation.push({
            role: 'tool',
            tool_call_id: call.id,
            content: searchResults,
          });
        } catch (e) {
          conversation.push({
            role: 'tool',
            tool_call_id: call.id,
            content: `Search failed: ${e instanceof Error ? e.message : 'Unknown error'}`,
          });
        }
      }
    }
  }

  // Force output
  conversation.push({
    role: 'user',
    content: 'Please output the fact sheet now with everything you have verified so far.',
  });
  const finalMsg = await callOpenRouter(conversation, []);
  const content = finalMsg.content ?? '';
  const factMatch = content.match(/```factsheet\s*([\s\S]*?)```/);
  return { factSheet: factMatch ? factMatch[1].trim() : content, sources, searchCount };
}

async function runWritingPhase(
  pathResult: PathSearchResult,
  config: PathSearchConfig,
  teamName: string,
  position: number,
  points: number,
  gapToTarget: number,
  gamesRemaining: number,
  factSheet: string
): Promise<Partial<DeepAnalysis>> {
  const systemPrompt = buildWritingPrompt(
    pathResult, config, teamName, position, points, gapToTarget, gamesRemaining, factSheet
  );

  const conversation: OpenRouterMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `Write the Deep Analysis JSON for ${teamName}. Use ONLY facts from the fact sheet. Do not invent any names or claims.` },
  ];

  const message = await callOpenRouter(conversation, []);
  const content = message.content ?? '';

  // Parse JSON
  const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[1]);
    } catch (e) {
      console.error('Failed to parse writing phase JSON:', e);
    }
  }

  // Fallback: find any JSON object
  const fallbackMatch = content.match(/\{[\s\S]*\}/);
  if (fallbackMatch) {
    try {
      return JSON.parse(fallbackMatch[0]);
    } catch {
      // give up
    }
  }

  return {};
}

async function narrateAnalysis(
  pathResult: PathSearchResult,
  config: PathSearchConfig,
  teamName: string,
  position: number,
  points: number,
  gapToTarget: number,
  gamesRemaining: number
): Promise<{ analysis: Partial<DeepAnalysis>; sources: string[]; searchCount: number }> {
  // Identify which teams need researching
  const teamsToResearch = new Set<string>();
  teamsToResearch.add(teamName);

  // Add teams from the decisive match
  if (pathResult.sensitivityData[0]) {
    const s = pathResult.sensitivityData[0];
    const homeTeamObj = config.teams.find(t => t.abbr === s.homeTeam);
    const awayTeamObj = config.teams.find(t => t.abbr === s.awayTeam);
    if (homeTeamObj) teamsToResearch.add(homeTeamObj.name);
    if (awayTeamObj) teamsToResearch.add(awayTeamObj.name);
  }

  // Add teams from top sensitivity fixtures (matches to watch candidates)
  for (const s of pathResult.sensitivityData.slice(0, 6)) {
    const homeTeamObj = config.teams.find(t => t.abbr === s.homeTeam);
    const awayTeamObj = config.teams.find(t => t.abbr === s.awayTeam);
    if (homeTeamObj) teamsToResearch.add(homeTeamObj.name);
    if (awayTeamObj) teamsToResearch.add(awayTeamObj.name);
  }

  // Phase A: Research
  const { factSheet, sources, searchCount } = await runResearchPhase(
    pathResult, config, teamName, [...teamsToResearch]
  );

  // Phase B: Write
  const analysis = await runWritingPhase(
    pathResult, config, teamName, position, points, gapToTarget, gamesRemaining, factSheet
  );

  return { analysis, sources, searchCount };
}

// ── Main Handler ──

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      targetTeam,
      targetMetric = 'top7Pct',
      targetThreshold = 50,
      teams,
      fixtures,
    } = body as {
      targetTeam: string;
      targetMetric?: string;
      targetThreshold?: number;
      teams: Team[];
      fixtures: Fixture[];
    };

    if (!teams?.length || !fixtures?.length || !targetTeam) {
      return NextResponse.json(
        { error: 'Missing required fields: teams, fixtures, targetTeam' },
        { status: 400 }
      );
    }

    // ── Phase 1: Path Search ──
    const config: PathSearchConfig = {
      teams,
      fixtures,
      targetTeam,
      targetMetric: targetMetric as keyof import('@/lib/types').SimulationResult,
      targetThreshold,
      maxFixturesToLock: 8,
      branchDepth: 3,
    };

    const pathResult = pathSearch(config);

    // Compute team context
    const sortedTeams = [...teams].sort(
      (a, b) => b.points - a.points || b.goalDifference - a.goalDifference
    );
    const currentTeam = teams.find((t) => t.abbr === targetTeam);
    const position = sortedTeams.findIndex((t) => t.abbr === targetTeam) + 1;
    const teamPoints = currentTeam?.points ?? 0;
    const gamesRemaining = currentTeam ? 38 - currentTeam.played : 0;
    const teamName = currentTeam?.name ?? targetTeam;

    // Find the target position team for gap calculation
    let gapToTarget = 0;
    if (targetMetric === 'championPct') {
      // Gap to 1st place
      const leader = sortedTeams[0];
      gapToTarget = leader && leader.abbr !== targetTeam ? leader.points - teamPoints : 0;
    } else if (targetMetric === 'relegationPct' || targetMetric === 'survivalPct') {
      // Points above the relegation zone (18th place)
      const relegationTeam = sortedTeams[17];
      gapToTarget = relegationTeam ? teamPoints - relegationTeam.points : 0;
    } else {
      const targetPositionIndex = targetMetric === 'top4Pct' ? 3 : targetMetric === 'top5Pct' ? 4 : targetMetric === 'top6Pct' ? 5 : 6;
      const targetPositionTeam = sortedTeams[targetPositionIndex];
      gapToTarget = targetPositionTeam ? targetPositionTeam.points - teamPoints : 0;
    }

    // Decisive match data from sensitivity
    const decisiveFixture = pathResult.sensitivityData[0];
    const decisiveFixtureData = fixtures.find((f) => f.id === decisiveFixture?.fixtureId);

    // Compute outcome table for decisive match
    let outcomeTable: { result: string; resultingOdds: number; delta: number }[] = [];
    if (decisiveFixture) {
      outcomeTable = [
        {
          result: `${decisiveFixture.homeTeam} Win`,
          resultingOdds: pathResult.baselineOdds + decisiveFixture.deltaIfHomeWin,
          delta: decisiveFixture.deltaIfHomeWin,
        },
        {
          result: 'Draw',
          resultingOdds: pathResult.baselineOdds + decisiveFixture.deltaIfDraw,
          delta: decisiveFixture.deltaIfDraw,
        },
        {
          result: `${decisiveFixture.awayTeam} Win`,
          resultingOdds: pathResult.baselineOdds + decisiveFixture.deltaIfAwayWin,
          delta: decisiveFixture.deltaIfAwayWin,
        },
      ];
    }

    // ── Phase 2: Narration (if API keys available) ──
    let narrativeData: Partial<DeepAnalysis> = {};
    let sources: string[] = [];
    let searchCount = 0;

    if (OPENROUTER_API_KEY) {
      const result = await narrateAnalysis(
        pathResult,
        config,
        teamName,
        position,
        teamPoints,
        gapToTarget,
        gamesRemaining
      );
      narrativeData = result.analysis;
      sources = result.sources;
      searchCount = result.searchCount;
    }

    // ── Build final DeepAnalysis object ──
    const analysis: DeepAnalysis = {
      id: crypto.randomUUID(),
      generatedAt: Date.now(),
      targetTeam,
      targetMetric,
      targetThreshold,

      stateOfPlay: {
        position,
        points: teamPoints,
        gapToTarget: Math.max(0, gapToTarget),
        gamesRemaining,
        baselineOdds: pathResult.baselineOdds,
        optimalPathOdds: pathResult.optimalPath.resultingOdds,
        optimalPathPlausibility: pathResult.optimalPath.compositePlausibility,
        contextNarrative:
          narrativeData.stateOfPlay?.contextNarrative ??
          `${teamName} sit ${position}th on ${teamPoints} points with ${gamesRemaining} matches remaining. The baseline simulation gives them a ${pathResult.baselineOdds.toFixed(1)}% chance of achieving the target. The optimal path — where everything breaks their way — pushes this to ${pathResult.optimalPath.resultingOdds.toFixed(1)}%, but the probability of all those results occurring together is just ${(pathResult.optimalPath.compositePlausibility * 100).toFixed(1)}%.`,
      },

      decisiveMatch: {
        fixtureId: decisiveFixture?.fixtureId ?? '',
        homeTeam: decisiveFixture?.homeTeam ?? '',
        awayTeam: decisiveFixture?.awayTeam ?? '',
        date: decisiveFixtureData?.date ?? '',
        outcomeTable,
        risks: narrativeData.decisiveMatch?.risks ?? [
          'This is the highest-leverage fixture in the remaining schedule.',
          'The outcome swings qualification odds more than any other single match.',
        ],
        angles: narrativeData.decisiveMatch?.angles ?? [
          {
            title: 'Simulation leverage',
            analysis: `This fixture has a maximum delta of ${decisiveFixture?.maxAbsDelta.toFixed(1)}pp on ${targetMetric}.`,
          },
        ],
        whatToWatch: narrativeData.decisiveMatch?.whatToWatch ?? [
          'The first 15 minutes will set the tone for the match.',
        ],
      },

      matchesToWatch:
        narrativeData.matchesToWatch ??
        pathResult.sensitivityData
          .filter(
            (s) =>
              s.fixtureId !== decisiveFixture?.fixtureId &&
              s.homeTeam !== targetTeam &&
              s.awayTeam !== targetTeam
          )
          .slice(0, 3)
          .map((s) => ({
            fixtureId: s.fixtureId,
            homeTeam: s.homeTeam,
            awayTeam: s.awayTeam,
            whyItMatters: `This fixture has a ${s.maxAbsDelta.toFixed(1)}pp impact on ${teamName}'s odds.`,
            idealResult: s.deltaIfHomeWin > s.deltaIfAwayWin
              ? `${s.homeTeam} win`
              : s.deltaIfAwayWin > s.deltaIfHomeWin
                ? `${s.awayTeam} win`
                : 'Draw',
            whyItsPlausible: 'Based on current form and bookmaker odds.',
            simulationImpact: `+${s.maxAbsDelta.toFixed(1)}pp to ${targetMetric}`,
          })),

      bottomLine: narrativeData.bottomLine ?? {
        summary: `${teamName}'s path to their target runs through the fixtures identified in this analysis. The baseline odds are ${pathResult.baselineOdds.toFixed(1)}%, but the right combination of results can push this significantly higher.`,
        keyScenario: pathResult.candidatePaths[0]
          ? `The most plausible path requires: ${pathResult.candidatePaths[0].locks.map((l) => l.resultLabel).join(', ')}. This would push odds to ${pathResult.candidatePaths[0].resultingOdds.toFixed(1)}%.`
          : 'No viable path found that crosses the threshold.',
      },

      sources: [...new Set(sources)],
      searchBudgetUsed: searchCount,
    };

    return NextResponse.json({
      analysis,
      pathResult: {
        baselineOdds: pathResult.baselineOdds,
        optimalPath: pathResult.optimalPath,
        candidatePaths: pathResult.candidatePaths,
        sensitivityData: pathResult.sensitivityData,
        searchStats: pathResult.searchStats,
      },
    });
  } catch (error) {
    console.error('Deep Analysis API error:', error);
    return NextResponse.json(
      { error: `Deep Analysis failed: ${error instanceof Error ? error.message : 'Unknown error'}` },
      { status: 500 }
    );
  }
}
