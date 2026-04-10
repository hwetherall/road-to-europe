import { NextRequest } from 'next/server';
import { executeWebSearch } from '@/lib/web-search';
import { lookupPlayer, getPlayersForClub } from '@/lib/what-if/fifa-data';
import {
  callOpenRouter,
  OpenRouterMessage,
  OpenRouterTool,
} from '@/lib/openrouter';

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

// ── Tool Definitions ──

const TOOLS: OpenRouterTool[] = [
  {
    type: 'function',
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
  {
    type: 'function',
    function: {
      name: 'lookup_player',
      description:
        "Look up a player's FC 26 quality ratings from our local database. Use this to compare players numerically — e.g. to quantify the quality drop from a first-choice player to their backup. Returns overall rating, potential, age, positions, and attribute breakdown (pace, shooting, passing, dribbling, defending, physical). Faster and more reliable than web search for player quality comparisons.",
      parameters: {
        type: 'object',
        properties: {
          playerName: {
            type: 'string',
            description: 'Player name to search for (supports fuzzy matching, e.g. "Areola", "Bowen")',
          },
        },
        required: ['playerName'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_squad',
      description:
        "Get the full squad for a Premier League team with FC 26 quality ratings. Use this to see the full depth chart, compare starters vs backups, and identify quality drops at specific positions. Returns all players sorted by overall rating.",
      parameters: {
        type: 'object',
        properties: {
          team: {
            type: 'string',
            description: 'Team name or 3-letter abbreviation (e.g. "WHU", "West Ham", "TOT", "Arsenal")',
          },
        },
        required: ['team'],
      },
    },
  },
];

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
FAST MODE: You have a budget of 1-2 web searches PLUS unlimited lookup_player/get_squad calls (they are instant local lookups). Use web searches to verify critical facts (injuries, current status). Use player/squad lookups to quantify quality differences. Then reason from verified facts to produce your estimate.`
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

## PLAYER QUALITY DATA
You have access to FC 26 player quality ratings via two local tools:
- **lookup_player**: Look up any player by name to get their overall rating, potential, age, positions, and attribute breakdown (pace/shooting/passing/dribbling/defending/physical). Use this to quantify the quality drop when a player is replaced — e.g. "Areola (OVR 79) → Herrick (OVR 54) = 25-point drop".
- **get_squad**: Get the full squad for any PL team. Use this to see depth at each position and identify who the actual backup would be.

PREFER these tools over web search for player quality comparisons. They are faster, more reliable, and give you concrete numbers to base your probability deltas on. Use web search for current form, injuries, and real-world context that FC 26 ratings don't capture.

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

**Fixture lock request**: ("Chelsea lose to Arsenal") This is a direct fixture override for a SINGLE match, not a probability modifier. Output it as a fixture_lock type, not a probability_modifier. No research needed unless the user wants analysis of knock-on effects.

**Team result lock**: ("Tottenham lose all their games", "Man City win every remaining match") This locks ALL remaining fixtures for that team to a specific result. Use the compound type with teamFixtureLocks. The simulation will set each fixture to 100% for the specified outcome.

**Compound scenario**: ("If Saka is injured AND Arsenal lose their next 3") When a scenario combines BOTH fixed match outcomes AND probability adjustments, use the compound type. This applies fixture locks FIRST (100% certainty outcomes), then applies probability modifiers to the remaining non-locked fixtures.

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

**For probability adjustments only** (injuries, form changes, etc.):
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

**For a single fixture lock** (specific match result):
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

**For team-level result locks and compound scenarios** ("Team X loses/wins/draws all remaining", or combining locks with probability adjustments):
\`\`\`json
{
  "type": "compound",
  "title": "Brief title",
  "teamFixtureLocks": [
    { "team": "TOT", "result": "lose" }
  ],
  "modification": {
    "description": "Optional: additional probability adjustments for other teams",
    "teamModifications": [
      {
        "team": "WHU",
        "homeWinDelta": 0.03,
        "awayWinDelta": 0.05,
        "drawDelta": -0.02
      }
    ]
  },
  "confidence": "medium",
  "reasoning": "Explanation of the compound scenario"
}
\`\`\`

The compound type is powerful — use it whenever the user asks about a team winning/losing all their games, or combines fixed outcomes with probability adjustments. The "teamFixtureLocks" array locks ALL remaining fixtures for that team. Valid results are "win", "lose", or "draw" (relative to the named team). The optional "modification" field adjusts probabilities for OTHER teams' non-locked fixtures.

IMPORTANT: When a user says "[Team] loses all their games" or "[Team] wins every remaining match", this is NOT a probability modifier. Use compound with teamFixtureLocks to lock those outcomes to 100%, then run the 10k simulation. Probability modifiers are for uncertain adjustments like injuries or form changes.

Team abbreviations: ARS, MCI, MUN, AVL, CFC, LFC, BRE, FUL, EVE, BRI, NEW, BOU, SUN, CRY, LEE, TOT, NFO, WHU, BUR, WOL

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
  teamFixtureLocks?: Array<{ team: string; result: 'win' | 'lose' | 'draw' }>;
  confidence?: 'high' | 'medium' | 'low';
  reasoning?: string;
  type: 'scenario_modification' | 'fixture_lock' | 'compound';
}

interface ParsedResponse {
  content: string;
  proposedModification?: ParsedOption['modification'];
  proposedLock?: { fixtureId: string; result: 'home' | 'draw' | 'away' };
  proposedTeamLocks?: Array<{ team: string; result: 'win' | 'lose' | 'draw' }>;
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
    // Tolerate common model formatting mistakes
    const DQ = String.fromCharCode(34); // straight double quote
    const SQ = String.fromCharCode(39); // straight single quote
    const sanitized = raw
      .replace(/[\u201C\u201D]/g, DQ)
      .replace(/[\u2018\u2019]/g, SQ)
      .replace(/,\s*([}\]])/g, `$1`)
      .replace(/:\s*\+(\d)/g, `: $1`)
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
      if (parsed.type === 'compound' && (parsed.teamFixtureLocks || parsed.modification)) {
        options.push({
          title: (parsed.title as string) ?? 'Compound scenario',
          teamFixtureLocks: parsed.teamFixtureLocks as ParsedOption['teamFixtureLocks'],
          modification: parsed.modification as ParsedOption['modification'],
          confidence: parsed.confidence as ParsedOption['confidence'],
          reasoning: parsed.reasoning as string | undefined,
          type: 'compound',
        });
      } else if (parsed.type === 'scenario_modification' && parsed.modification) {
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
      if (opt.type === 'compound') {
        // Compound scenarios always go through proposedOptions for clear UI
        result.proposedOptions = [opt];
      } else if (opt.type === 'fixture_lock') {
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

// ── Main Handler ──

export async function POST(req: NextRequest) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const send = (payload: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      };

      const closeSafe = () => {
        try {
          controller.close();
        } catch {
          // Already closed/cancelled.
        }
      };

      void (async () => {
        try {
          const body = await req.json();
          const { messages, mode, context } = body;

          if (!OPENROUTER_API_KEY) {
            send({
              type: 'final',
              data: {
                content:
                  'Chat API is not configured. Add OPENROUTER_API_KEY to your .env.local to enable AI chat. For now, you can use the What-If panel to manually lock fixtures.',
                toolCalls: [],
              },
            });
            closeSafe();
            return;
          }

          send({ type: 'status', message: 'Building scenario context...' });

          const agentCtx = buildAgentContext(context ?? {});
          const deepAnalysisContext = context?.deepAnalysisContext as string | undefined;
          const systemPrompt = deepAnalysisContext
            ? deepAnalysisContext
            : buildSystemPrompt(mode ?? 'fast', agentCtx);

          const model = mode === 'deep' ? 'anthropic/claude-opus-4.6' : 'x-ai/grok-4.1-fast';
          const MAX_TOOL_ROUNDS = mode === 'deep' ? 8 : 2;
          const toolCallLog: Array<{ id: string; query: string; status: 'complete' | 'error' }> = [];

          const conversation: OpenRouterMessage[] = [
            { role: 'system', content: systemPrompt },
            ...(messages as Array<{ role: string; content: string }>).map((m) => ({
              role: m.role,
              content: m.content,
            })),
          ];

          for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
            send({ type: 'status', message: `Research round ${round + 1}...` });

            let message: OpenRouterMessage;
            try {
              message = await callOpenRouter(conversation, { model, tools: TOOLS, maxTokens: 15000 });
            } catch {
              send({
                type: 'error',
                message: 'Failed to get a response from the AI. Please try again.',
              });
              send({
                type: 'final',
                data: { content: 'Failed to get a response from the AI. Please try again.', toolCalls: toolCallLog },
              });
              closeSafe();
              return;
            }

            const toolCalls = message.tool_calls;

            if (!toolCalls || toolCalls.length === 0) {
              const parsed = parseAgentResponse(message.content ?? '', toolCallLog);
              send({ type: 'status', message: 'Finalizing response...' });
              send({ type: 'final', data: parsed as unknown as Record<string, unknown> });
              closeSafe();
              return;
            }

            conversation.push(message);

            for (const call of toolCalls) {
              let args: Record<string, unknown>;
              try {
                args = JSON.parse(call.function.arguments);
              } catch {
                args = { query: call.function.arguments };
              }

              if (call.function.name === 'web_search') {
                const query = args.query as string;
                const intent = (args.intent as string) ?? 'general';
                const logEntry: { id: string; query: string; status: 'complete' | 'error' } = { id: call.id, query, status: 'complete' };
                send({ type: 'tool_call', toolCall: { id: call.id, type: 'web_search', query, status: 'pending' } });

                try {
                  const searchResults = await executeWebSearch(query);
                  conversation.push({
                    role: 'tool',
                    tool_call_id: call.id,
                    content: `Search intent: ${intent}\n${searchResults}`,
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
                send({
                  type: 'tool_call',
                  toolCall: { id: call.id, type: 'web_search', query, status: logEntry.status },
                });
              } else if (call.function.name === 'lookup_player') {
                const name = args.playerName as string;
                const query = `Player: ${name}`;
                const logEntry: { id: string; query: string; status: 'complete' | 'error' } = { id: call.id, query, status: 'complete' };
                send({ type: 'tool_call', toolCall: { id: call.id, type: 'web_search', query, status: 'pending' } });

                try {
                  const players = await lookupPlayer(name, true);
                  if (players.length === 0) {
                    conversation.push({
                      role: 'tool',
                      tool_call_id: call.id,
                      content: `No player found matching "${name}". Try a different spelling or last name only.`,
                    });
                  } else {
                    const summary = players.slice(0, 5).map((p) =>
                      `${p.name} (${p.club}) — OVR ${p.overall}, POT ${p.potential}, Age ${p.age}, Pos: ${p.positions.join('/')}\n  PAC ${p.pace} | SHO ${p.shooting} | PAS ${p.passing} | DRI ${p.dribbling} | DEF ${p.defending} | PHY ${p.physical}`
                    ).join('\n\n');
                    conversation.push({
                      role: 'tool',
                      tool_call_id: call.id,
                      content: `FC 26 Player Data (${players.length} match${players.length > 1 ? 'es' : ''}):\n\n${summary}`,
                    });
                  }
                } catch {
                  logEntry.status = 'error';
                  conversation.push({
                    role: 'tool',
                    tool_call_id: call.id,
                    content: 'Player lookup failed. Proceed with available information.',
                  });
                }

                toolCallLog.push(logEntry);
                send({
                  type: 'tool_call',
                  toolCall: { id: call.id, type: 'web_search', query, status: logEntry.status },
                });
              } else if (call.function.name === 'get_squad') {
                const team = args.team as string;
                const query = `Squad: ${team}`;
                const logEntry: { id: string; query: string; status: 'complete' | 'error' } = { id: call.id, query, status: 'complete' };
                send({ type: 'tool_call', toolCall: { id: call.id, type: 'web_search', query, status: 'pending' } });

                try {
                  const players = await getPlayersForClub(team);
                  if (players.length === 0) {
                    conversation.push({
                      role: 'tool',
                      tool_call_id: call.id,
                      content: `No squad data found for "${team}". Try a 3-letter abbreviation (e.g. WHU, TOT, ARS).`,
                    });
                  } else {
                    const sorted = [...players].sort((a, b) => b.overall - a.overall);
                    const gkPlayers = sorted.filter((p) => p.positions.some((pos) => pos === 'GK'));
                    const outfield = sorted.filter((p) => !p.positions.some((pos) => pos === 'GK'));
                    const formatPlayer = (p: typeof sorted[number]) =>
                      `  ${p.name} — OVR ${p.overall}, Pos: ${p.positions.join('/')}, Age ${p.age}`;

                    const lines = [
                      `${team} Squad (${players.length} players):`,
                      '',
                      'Goalkeepers:',
                      ...gkPlayers.map(formatPlayer),
                      '',
                      'Outfield (by overall):',
                      ...outfield.slice(0, 20).map(formatPlayer),
                    ];

                    if (outfield.length > 20) {
                      lines.push(`  ... and ${outfield.length - 20} more`);
                    }

                    conversation.push({
                      role: 'tool',
                      tool_call_id: call.id,
                      content: lines.join('\n'),
                    });
                  }
                } catch {
                  logEntry.status = 'error';
                  conversation.push({
                    role: 'tool',
                    tool_call_id: call.id,
                    content: 'Squad lookup failed. Proceed with available information.',
                  });
                }

                toolCallLog.push(logEntry);
                send({
                  type: 'tool_call',
                  toolCall: { id: call.id, type: 'web_search', query, status: logEntry.status },
                });
              }
            }
          }

          send({ type: 'status', message: 'Max tool rounds reached, forcing conclusion...' });
          conversation.push({
            role: 'user',
            content: 'Please provide your best estimate based on the research so far.',
          });

          const finalMessage = await callOpenRouter(conversation, { model, maxTokens: 15000 });
          const parsed = parseAgentResponse(finalMessage.content ?? '', toolCallLog);
          send({ type: 'final', data: parsed as unknown as Record<string, unknown> });
          closeSafe();
        } catch (error) {
          console.error('Chat API error:', error);
          send({ type: 'error', message: 'An error occurred. Please try again.' });
          send({
            type: 'final',
            data: { content: 'An error occurred. Please try again.', toolCalls: [] },
          });
          closeSafe();
        }
      })();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
