import { NextRequest, NextResponse } from 'next/server';

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const TAVILY_API_KEY = process.env.TAVILY_API_KEY;

// ── Tool Definitions ──

const TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'web_search',
      description:
        'Search the web for current football information. Use this to verify ANY claims about current squads, player form, injuries, team circumstances, recent results, or tactical changes. NEVER rely on your training knowledge for football facts — always search first.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description:
              "Search query. Keep specific and include current year/season for recency. Examples: 'Bruno Guimaraes Newcastle 2025-26 stats', 'Chelsea results without Cole Palmer 2026'",
          },
          intent: {
            type: 'string',
            description: "What you're trying to learn from this search.",
            enum: [
              'verify_player_team',
              'player_stats',
              'team_record_without',
              'injury_news',
              'replacement_options',
              'team_form',
              'fixture_congestion',
              'managerial_situation',
              'tactical_analysis',
              'general',
            ],
          },
        },
        required: ['query', 'intent'],
      },
    },
  },
];

// ── Search Execution ──

async function executeWebSearch(query: string): Promise<string> {
  // Try Tavily first
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
        return summariseTavilyResults(data);
      }
    } catch (e) {
      console.error('Tavily search failed:', e);
    }
  }

  // Fallback: return a message that search is unavailable
  return `[Search unavailable — no TAVILY_API_KEY configured. Please add one to .env.local for web research. Proceeding with reasoning only.]`;
}

function summariseTavilyResults(data: {
  answer?: string;
  results?: Array<{ title?: string; content?: string; url?: string }>;
}): string {
  const parts: string[] = [];

  if (data.answer) {
    parts.push(`Summary: ${data.answer}`);
  }

  if (data.results?.length) {
    const snippets = data.results
      .slice(0, 3)
      .map((r) => {
        const content = r.content?.slice(0, 250) ?? '';
        return `- ${r.title ?? 'Result'}: ${content}${r.url ? ` [${r.url}]` : ''}`;
      })
      .join('\n');
    parts.push(`\nTop results:\n${snippets}`);
  }

  return parts.join('\n') || 'No results found.';
}

// ── System Prompt Builder ──

interface AgentContext {
  selectedTeam: string;
  selectedTeamName: string;
  position: number;
  points: number;
  gd: number;
  gamesRemaining: number;
  standingsSummary: string;
  activeChaptersSummary: string;
  sensitivitySummary: string;
}

function buildAgentContext(context: {
  selectedTeam?: string;
  standings?: Array<{ abbr: string; name: string; points: number; goalDifference: number; played: number }>;
  activeChapters?: Array<{ title: string; type: string; confidence?: string }>;
  sensitivityResults?: Array<{ homeTeam: string; awayTeam: string; maxAbsDelta: number }>;
}): AgentContext {
  const teams = context.standings ?? [];
  const sorted = [...teams].sort((a, b) => b.points - a.points || b.goalDifference - a.goalDifference);
  const team = teams.find((t) => t.abbr === context.selectedTeam);
  const position = team ? sorted.findIndex((t) => t.abbr === context.selectedTeam) + 1 : 0;

  // Show top 8 + teams near selected team
  const relevantTeams = sorted.filter(
    (t, i) => i < 8 || Math.abs(i - (position - 1)) <= 5
  );

  const standingsSummary = relevantTeams
    .map((t) => {
      const pos = sorted.indexOf(t) + 1;
      const marker = t.abbr === context.selectedTeam ? ' <<' : '';
      const gd = t.goalDifference > 0 ? `+${t.goalDifference}` : `${t.goalDifference}`;
      return `${pos}. ${t.name} - ${t.points}pts (GD ${gd})${marker}`;
    })
    .join('\n');

  const activeChaptersSummary =
    context.activeChapters
      ?.filter((c) => c.type)
      .map((c) => `- ${c.title} (${c.type}, confidence: ${c.confidence ?? 'unknown'})`)
      .join('\n') || 'None';

  const sensitivitySummary =
    context.sensitivityResults
      ?.slice(0, 5)
      .map((s) => `- ${s.homeTeam} vs ${s.awayTeam}: max impact ${s.maxAbsDelta.toFixed(1)}pp`)
      .join('\n') || 'Not yet computed';

  return {
    selectedTeam: context.selectedTeam ?? 'NEW',
    selectedTeamName: team?.name ?? context.selectedTeam ?? 'Newcastle',
    position,
    points: team?.points ?? 0,
    gd: team?.goalDifference ?? 0,
    gamesRemaining: team ? 38 - team.played : 0,
    standingsSummary,
    activeChaptersSummary,
    sensitivitySummary,
  };
}

function buildSystemPrompt(mode: 'fast' | 'deep', ctx: AgentContext): string {
  const modeInstructions =
    mode === 'fast'
      ? `
FAST MODE: You have a budget of 1-2 web searches. Use them to verify the most critical facts (e.g., does the player still play for the claimed team? what is their current status?). Then reason from verified facts to produce your estimate. Be upfront about the limitations of a fast estimate.`
      : `
DEEP MODE: You have a budget of up to 8 web searches. Follow this workflow:
1. PLAN: Before searching, tell the user your research plan (what you need to find and why). Ask them to confirm before proceeding.
2. RESEARCH: Execute your searches step by step. After each search, assess what you've learned and whether you need to adjust your plan.
3. SYNTHESISE: Combine your findings into a coherent analysis.
4. QUANTIFY: Translate your analysis into probability modifications.
Present your plan clearly and wait for user confirmation before executing.`;

  return `You are Keepwatch's scenario analysis agent — a football intelligence system that helps users understand how real-world events would affect Premier League outcomes.

## YOUR ROLE
You translate natural language scenarios into quantified probability modifications that feed into a Monte Carlo simulation of the remaining EPL season. You are a collaborator, not an oracle. You propose, the user adjusts, and the simulation computes.

## CRITICAL: VERIFY EVERYTHING
Your training data about football is UNRELIABLE. Players transfer between clubs. Managers get sacked. Form changes week to week. You MUST use the web_search tool to verify ANY factual claims about:
- Which club a player currently plays for
- Current squad composition and starting lineups
- Recent form and results
- Current injuries and suspensions
- Managerial status
- League position and points (use the provided standings for this)

NEVER state a football fact without first searching to confirm it is current. If you cannot verify something, say so explicitly.

## CURRENT CONTEXT
Selected team: ${ctx.selectedTeam} (${ctx.selectedTeamName})
Current position: ${ctx.position}
Points: ${ctx.points} | GD: ${ctx.gd > 0 ? '+' : ''}${ctx.gd} | Games remaining: ${ctx.gamesRemaining}

Current standings (top of table and teams near ${ctx.selectedTeam}):
${ctx.standingsSummary}

Active scenario chapters:
${ctx.activeChaptersSummary}

High-leverage fixtures (from sensitivity analysis):
${ctx.sensitivitySummary}

## MODE: ${mode.toUpperCase()}
${modeInstructions}

## SCENARIO TYPES AND APPROACH
When you receive a scenario, first classify it:

**Player injury/absence**: Search for the player's current club and role, their statistical contribution, the team's record with/without them, and likely replacement. Quantify as team-wide probability deltas.

**Fixture lock request**: ("Chelsea lose to Arsenal") This is a direct fixture override, not a probability modifier. Output it as a fixture_lock type, not a probability_modifier. No research needed unless the user wants analysis of knock-on effects.

**Team circumstance change**: (fixture congestion, cup exit, managerial change) Search for current team context, upcoming schedule, and historical parallels. Quantify as team-wide probability deltas.

**Unquantifiable scenario**: (rule changes, hypotheticals with no empirical basis) Tell the user you lack a strong basis for quantification. Ask them to provide their intuition about the direction and magnitude. Validate their estimate against what you can find, then structure it as a modification.

**Meta-scenario**: ("what's the most likely path to Europe") Redirect the user to examine the sensitivity analysis and suggest which chapters might be worth exploring.

## QUANTIFICATION FRAMEWORK
When producing probability deltas, think in terms of these tiers:

Minor impact (2-5pp per match):
- Rotation player injured
- Slight form dip
- Minor tactical disadvantage

Moderate impact (6-12pp per match):
- Key starter injured
- Significant fixture congestion
- Notable form swing (3+ game run)
- Managerial uncertainty

Major impact (13-20pp per match):
- Team's best player out for the season
- Managerial sacking mid-season
- Points deduction
- Multiple key injuries simultaneously

Always state which tier you're assigning and the specific evidence driving that assessment.

## PROBABILITY REDISTRIBUTION
When a team's win probability drops, the lost probability distributes to draws and opponent wins. Use this heuristic:
- For attacking player injuries: most lost win probability goes to draws (the team creates less but doesn't collapse defensively)
- For defensive player injuries: more goes to opponent wins (the team concedes more)
- For general team-level impacts (congestion, morale): split roughly 40% to draws, 60% to opponent wins

## OUTPUT FORMAT
When you have a proposed modification, include this structured block in your response:

\`\`\`json
{
  "type": "scenario_modification",
  "title": "Brief title for the chapter",
  "modification": {
    "description": "One sentence description",
    "teamModifications": [
      {
        "team": "XXX",
        "homeWinDelta": -0.10,
        "awayWinDelta": -0.12,
        "drawDelta": 0.04
      }
    ],
    "fixtureSpecificOverrides": []
  },
  "confidence": "medium",
  "reasoning": "2-3 sentence summary of why this magnitude"
}
\`\`\`

Or for a fixture lock:

\`\`\`json
{
  "type": "fixture_lock",
  "title": "Brief title",
  "fixtureLock": {
    "fixtureId": "kf11",
    "result": "away"
  },
  "reasoning": "User requested this specific outcome"
}
\`\`\`

Team abbreviations: ARS, AVL, BOU, BRE, BHA, BUR, CHE, CRY, EVE, FUL, LIV, LUT, MCI, MUN, NEW, NFO, TOT, WHU, WOL, IPS

CRITICAL: You MUST ALWAYS include the JSON block in EVERY response where you discuss a scenario's impact — even when you have caveats, warnings, or questions. The user needs the [Apply] button to appear. Include the JSON block FIRST, then add your caveats and questions AFTER it. Never describe numbers in prose without also outputting the structured JSON. If you're unsure about the magnitude, pick your best estimate and note the uncertainty — the user can always adjust.

## HANDLING REFINEMENT
When the user says something like "make it more severe" or "adjust the numbers":
- Do NOT re-run all your research
- Adjust the numbers in the direction requested
- Explain what changed and why the new magnitude is reasonable (or flag if it seems excessive)
- Output a new JSON block with the revised modification

## PRESENT OPTIONS, NOT OPEN QUESTIONS
When there are multiple valid interpretations of a scenario (e.g., the event may already be priced in, or the severity is ambiguous), present concrete labelled options — each with its own JSON block — so the user can just pick one. Format like this:

**Option A: [description]** — [brief rationale]
[JSON block for option A]

**Option B: [description]** — [brief rationale]
[JSON block for option B]

**Option C: [description]** — [brief rationale, if applicable]
[JSON block for option C]

Each option gets its own complete JSON block. The user picks one and hits Apply. This is much better than dumping analysis and making the user figure out what to do next. Even when there's only one reasonable interpretation, frame it as "here's what I'd recommend" with a single JSON block and an invitation to adjust.

## DOUBLE-COUNTING WARNING
If a scenario describes something that has ALREADY HAPPENED (a real, current injury), present the options clearly:
- **Option A**: Apply the full modification (if the user believes baseline data hasn't updated)
- **Option B**: Apply a reduced version (incremental effect of extending the known injury further)
- **Option C**: Apply the inverse (see how much the event is already costing them — positive deltas)
Each option MUST include its own JSON block. Let the user pick.

## CHAPTER AWARENESS
You are aware of existing active chapters. When the user adds a new scenario:
- Note any interactions with existing chapters (e.g., "you already have Bruno injured — adding Joelinton's return partially offsets this")
- Don't re-explain the impact of existing chapters unless asked
- Quantify the NEW chapter's impact relative to the current modified baseline, not the original baseline

Keep responses concise and in a confident pundit voice. Focus on the footballing logic.`;
}

// ── Response Parsing ──

interface ParsedOption {
  title: string;
  modification?: {
    description: string;
    teamModifications: Array<{
      team: string;
      homeWinDelta: number;
      awayWinDelta: number;
      drawDelta: number;
    }>;
    fixtureSpecificOverrides?: Array<{
      fixtureId: string;
      homeWinDelta?: number;
      awayWinDelta?: number;
      drawDelta?: number;
    }>;
  };
  fixtureLock?: { fixtureId: string; result: 'home' | 'draw' | 'away' };
  confidence?: 'high' | 'medium' | 'low';
  reasoning?: string;
  type: 'scenario_modification' | 'fixture_lock';
}

interface ParsedResponse {
  content: string;
  proposedModification?: ParsedOption['modification'];
  proposedLock?: { fixtureId: string; result: 'home' | 'draw' | 'away' };
  proposedOptions?: ParsedOption[];
  title?: string;
  confidence?: 'high' | 'medium' | 'low';
  reasoning?: string;
  toolCalls: Array<{ id: string; type: 'web_search'; query: string; status: 'complete' | 'error' }>;
}

function parseJsonLenient(raw: string): Record<string, unknown> | null {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    // Tolerate common model formatting mistakes.
    const sanitized = raw
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'")
      .replace(/,\s*([}\]])/g, '$1')
      .trim();
    try {
      return JSON.parse(sanitized) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}

function extractJsonBlocks(content: string): Array<Record<string, unknown>> {
  const blocks: Array<Record<string, unknown>> = [];

  // Prefer explicitly typed JSON-like fences first.
  const typedRegex = /```(?:json|jsonc|json5|JSON|JSONC|JSON5)\s*([\s\S]*?)\s*```/g;
  let match: RegExpExecArray | null;
  while ((match = typedRegex.exec(content)) !== null) {
    const parsed = parseJsonLenient(match[1]);
    if (parsed) blocks.push(parsed);
  }

  if (blocks.length > 0) return blocks;

  // Fallback: generic fenced code that still looks like a JSON object payload.
  const genericFenceRegex = /```[^\n]*\n([\s\S]*?)\s*```/g;
  while ((match = genericFenceRegex.exec(content)) !== null) {
    const candidate = match[1].trim();
    if (!candidate.startsWith('{')) continue;
    const parsed = parseJsonLenient(candidate);
    if (parsed) blocks.push(parsed);
  }

  return blocks;
}

function scaleOptionModification(
  modification: NonNullable<ParsedOption['modification']>,
  factor: number
): NonNullable<ParsedOption['modification']> {
  return {
    description: modification.description,
    teamModifications: modification.teamModifications.map((tm) => ({
      ...tm,
      homeWinDelta: tm.homeWinDelta * factor,
      awayWinDelta: tm.awayWinDelta * factor,
      drawDelta: tm.drawDelta * factor,
    })),
    fixtureSpecificOverrides: modification.fixtureSpecificOverrides?.map((fo) => ({
      ...fo,
      homeWinDelta: typeof fo.homeWinDelta === 'number' ? fo.homeWinDelta * factor : undefined,
      awayWinDelta: typeof fo.awayWinDelta === 'number' ? fo.awayWinDelta * factor : undefined,
      drawDelta: typeof fo.drawDelta === 'number' ? fo.drawDelta * factor : undefined,
    })),
  };
}

function shouldExpandToAmbiguityOptions(content: string): boolean {
  const lower = content.toLowerCase();
  const ambiguitySignals = [
    'double-count',
    'already priced',
    'already reflected',
    'already happened',
    'already out',
    'one caveat',
    'caveat',
    'incremental effect',
    'extension of that absence',
  ];
  return ambiguitySignals.some((signal) => lower.includes(signal));
}

function parseAgentResponse(
  content: string,
  toolCallLog: Array<{ id: string; query: string; status: 'complete' | 'error' }>
): ParsedResponse {
  const result: ParsedResponse = {
    content,
    toolCalls: toolCallLog.map((tc) => ({ ...tc, type: 'web_search' as const })),
  };

  // Extract ALL JSON blocks (supports json/jsonc/json5/uppercase/generic fences)
  const jsonBlocks = extractJsonBlocks(content);

  if (jsonBlocks.length > 0) {
    // Remove all JSON blocks from displayed content
    result.content = content
      .replace(/```(?:json|jsonc|json5|JSON|JSONC|JSON5)\s*[\s\S]*?\s*```/g, '')
      .replace(/```[^\n]*\n[\s\S]*?\s*```/g, (block) => {
        // Keep non-JSON generic fenced blocks; strip only those that parse as JSON.
        const inner = block.replace(/```[^\n]*\n?/, '').replace(/```$/, '').trim();
        return parseJsonLenient(inner) ? '' : block;
      })
      .trim();

    // Parse each block into an option
    const options: ParsedOption[] = [];
    for (const parsed of jsonBlocks) {
      if (parsed.type === 'scenario_modification' && parsed.modification) {
        options.push({
          title: (parsed.title as string) ?? (parsed.modification as { description?: string })?.description ?? 'Scenario modification',
          modification: parsed.modification as ParsedOption['modification'],
          confidence: parsed.confidence as ParsedOption['confidence'],
          reasoning: parsed.reasoning as string | undefined,
          type: 'scenario_modification',
        });
      } else if (parsed.type === 'fixture_lock' && parsed.fixtureLock) {
        options.push({
          title: (parsed.title as string) ?? 'Fixture lock',
          fixtureLock: parsed.fixtureLock as ParsedOption['fixtureLock'],
          confidence: 'high',
          reasoning: parsed.reasoning as string | undefined,
          type: 'fixture_lock',
        });
      }
    }

    if (options.length === 1) {
      // Single option — use the flat fields for backwards compat
      const opt = options[0];
      if (opt.type === 'fixture_lock') {
        result.proposedLock = opt.fixtureLock;
      } else if (opt.modification && shouldExpandToAmbiguityOptions(content)) {
        // If the assistant mentions ambiguity/caveats but only provided one block,
        // synthesise A/B/C options so the user can pick without re-prompting.
        const full = opt.modification;
        const reduced = scaleOptionModification(full, 0.5);
        const inverse = scaleOptionModification(full, -1);
        result.proposedOptions = [
          {
            title: `Option A: ${opt.title || 'Apply full impact'}`,
            modification: full,
            confidence: opt.confidence ?? 'medium',
            reasoning: opt.reasoning,
            type: 'scenario_modification',
          },
          {
            title: 'Option B: Reduced incremental impact',
            modification: reduced,
            confidence: 'low',
            reasoning:
              'Conservative variant in case part of this effect is already reflected in baseline odds.',
            type: 'scenario_modification',
          },
          {
            title: 'Option C: Inverse / already-priced test',
            modification: inverse,
            confidence: 'low',
            reasoning:
              'Diagnostic inverse to estimate how much of this event may already be priced into the baseline.',
            type: 'scenario_modification',
          },
        ];
      } else {
        result.proposedModification = opt.modification;
      }
      if (!result.proposedOptions) {
        result.title = opt.title;
        result.confidence = opt.confidence;
        result.reasoning = opt.reasoning;
      }
    } else if (options.length > 1) {
      // Multiple options — send as array
      result.proposedOptions = options;
    }
  }

  // Also check for <modification> tags (V3A fallback format)
  if (!result.proposedModification && !result.proposedOptions) {
    const modMatch = content.match(/<modification>\s*([\s\S]*?)\s*<\/modification>/);
    if (modMatch) {
      try {
        result.proposedModification = JSON.parse(modMatch[1]);
        result.content = content.replace(/<modification>[\s\S]*?<\/modification>/, '').trim();
      } catch {
        // ignore
      }
    }
  }

  return result;
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

async function callOpenRouter(
  model: string,
  messages: OpenRouterMessage[],
  tools?: typeof TOOLS
): Promise<{
  message: OpenRouterMessage;
  error?: string;
}> {
  const body: Record<string, unknown> = {
    model,
    messages,
    max_tokens: 1500,
  };

  if (tools && tools.length > 0) {
    body.tools = tools;
  }

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
    return { message: { role: 'assistant', content: '' }, error };
  }

  const data = await response.json();
  return { message: data.choices?.[0]?.message ?? { role: 'assistant', content: '' } };
}

// ── Main Handler ──

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { messages, mode, context } = body;

    if (!OPENROUTER_API_KEY) {
      return NextResponse.json({
        content:
          'Chat API is not configured. Add OPENROUTER_API_KEY to your .env.local to enable AI chat. For now, you can use the What-If panel to manually lock fixtures.',
        toolCalls: [],
      });
    }

    // Build rich context
    const agentCtx = buildAgentContext(context ?? {});
    const deepAnalysisContext = context?.deepAnalysisContext as string | undefined;
    const systemPrompt = deepAnalysisContext
      ? deepAnalysisContext
      : buildSystemPrompt(mode ?? 'fast', agentCtx);

    // Choose model based on mode
    const model = mode === 'deep' ? 'openai/gpt-5.4' : 'openai/gpt-5.4-mini';

    const MAX_TOOL_ROUNDS = mode === 'deep' ? 8 : 2;
    const toolCallLog: Array<{ id: string; query: string; status: 'complete' | 'error' }> = [];

    // Build conversation with system prompt
    const conversation: OpenRouterMessage[] = [
      { role: 'system', content: systemPrompt },
      ...messages.map((m: { role: string; content: string }) => ({
        role: m.role,
        content: m.content,
      })),
    ];

    // Tool-use loop
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const { message, error } = await callOpenRouter(model, conversation, TOOLS);

      if (error) {
        return NextResponse.json(
          { content: 'Failed to get a response from the AI. Please try again.', toolCalls: toolCallLog },
          { status: 502 }
        );
      }

      const toolCalls = message.tool_calls;

      if (!toolCalls || toolCalls.length === 0) {
        // Agent is done — parse and return final response
        const parsed = parseAgentResponse(message.content ?? '', toolCallLog);
        return NextResponse.json(parsed);
      }

      // Execute tool calls
      // Add the assistant message with tool calls to conversation
      conversation.push(message);

      for (const call of toolCalls) {
        if (call.function.name === 'web_search') {
          let args: { query: string; intent?: string };
          try {
            args = JSON.parse(call.function.arguments);
          } catch {
            args = { query: call.function.arguments, intent: 'general' };
          }

          const logEntry: { id: string; query: string; status: 'complete' | 'error' } = { id: call.id, query: args.query, status: 'complete' };

          try {
            const searchResults = await executeWebSearch(args.query);
            conversation.push({
              role: 'tool',
              tool_call_id: call.id,
              content: `Search intent: ${args.intent ?? 'general'}\n${searchResults}`,
            });
          } catch (e) {
            logEntry.status = 'error';
            conversation.push({
              role: 'tool',
              tool_call_id: call.id,
              content: `Search failed: ${e instanceof Error ? e.message : 'Unknown error'}. Please proceed with available information.`,
            });
          }

          toolCallLog.push(logEntry);
        }
      }
    }

    // Max rounds reached — force a conclusion
    conversation.push({
      role: 'user',
      content: 'Please provide your best estimate based on the research so far.',
    });

    const { message: finalMessage } = await callOpenRouter(model, conversation, []);
    const parsed = parseAgentResponse(finalMessage.content ?? '', toolCallLog);
    return NextResponse.json(parsed);
  } catch (error) {
    console.error('Chat API error:', error);
    return NextResponse.json(
      { content: 'An error occurred. Please try again.', toolCalls: [] },
      { status: 500 }
    );
  }
}
