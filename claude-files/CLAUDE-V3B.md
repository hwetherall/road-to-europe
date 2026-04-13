# CLAUDE-V3B.md — Keepwatch: Agent Brain (Research Pipeline + MCP)

## Overview

V3B is the intelligence layer of Keepwatch. It defines the agent that turns natural language scenarios into quantified probability modifications for the simulation engine. This is the "brain" that V3A's UI shell connects to.

**V3B covers:**
- Agent system prompt and reasoning framework
- The tool-use architecture (MCP pattern for web search)
- Fast mode vs deep mode research pipelines
- The research plan → execute → synthesise → quantify workflow
- Structured output format for probability modifications
- Handling user refinement and unquantifiable scenarios
- Foundation for V4's inverse scenario search

**V3B depends on:** V3A's chat endpoint, chapter system, and modification engine being in place.

---

## Critical Design Principle: Never Trust Training Data for Football

```
⚠️  THE AGENT MUST VERIFY ALL FOOTBALL FACTS VIA WEB SEARCH.
    
    LLM training data is stale. Players transfer every window.
    Managers get sacked mid-season. Team form changes weekly.
    
    Even in FAST MODE, the agent must run at least one grounding
    search before making any claims about current squads, form,
    injuries, or team circumstances.
    
    The agent should NEVER say "Player X plays for Team Y" or
    "Team Z's record is..." without first searching to confirm.
```

This is not optional. It is the single most important instruction for the agent. Football changes faster than model training cycles. A confidently wrong agent is worse than a slow but accurate one.

---

## Architecture

### The Agent Loop

```
User message
    │
    ▼
┌─────────────────────────────┐
│  PHASE 1: CLASSIFY + SCOPE  │
│  What type of scenario?      │
│  What do I need to know?     │
│  Do I need clarification?    │
└──────────┬──────────────────┘
           │
     ┌─────┴──────┐
     │  FAST MODE  │──────────────────────────────────────┐
     └─────┬──────┘                                       │
           │                                              │
    ┌──────┴───────┐                               ┌──────┴──────┐
    │  DEEP MODE   │                               │  1-2 quick   │
    └──────┬───────┘                               │  grounding   │
           │                                       │  searches    │
    ┌──────┴───────────┐                           └──────┬──────┘
    │  PHASE 2: PLAN   │                                  │
    │  Generate research│                                  │
    │  plan, present to │                                  │
    │  user for approval│                                  │
    └──────┬───────────┘                                  │
           │ (user confirms)                              │
    ┌──────┴───────────┐                                  │
    │  PHASE 3: RESEARCH│                                 │
    │  Execute searches │                                 │
    │  via tool calls   │                                 │
    │  Synthesise       │                                 │
    └──────┬───────────┘                                  │
           │                                              │
           ├──────────────────────────────────────────────┘
           │
    ┌──────┴───────────┐
    │  PHASE 4: QUANTIFY│
    │  Translate research│
    │  into probability │
    │  deltas            │
    └──────┬───────────┘
           │
    ┌──────┴───────────┐
    │  PHASE 5: PROPOSE │
    │  Present to user  │
    │  with reasoning   │
    │  [Apply] [Adjust] │
    └──────┬───────────┘
           │
     (user may refine — loop back to Phase 4)
           │
    ┌──────┴───────────┐
    │  PHASE 6: APPLY   │
    │  Create chapter   │
    │  Trigger resim    │
    │  Report impact    │
    └───────────────────┘
```

---

## Tool Definitions (MCP Pattern)

The agent has access to one tool: web search. This follows the MCP (Model Context Protocol) tool-use pattern where the agent decides when and what to search, and the backend executes.

### Tool Schema

```typescript
const TOOLS = [
  {
    type: "function",
    function: {
      name: "web_search",
      description: "Search the web for current football information. Use this to verify ANY claims about current squads, player form, injuries, team circumstances, recent results, or tactical changes. NEVER rely on your training knowledge for football facts — always search first.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Search query. Keep specific and include current year/season for recency. Examples: 'Bruno Guimaraes Newcastle 2025-26 stats', 'Newcastle results without Bruno 2026', 'who replaced Bruno Guimaraes Newcastle midfield'"
          },
          intent: {
            type: "string",
            description: "What you're trying to learn from this search. Helps with result interpretation.",
            enum: [
              "verify_player_team",       // Confirm a player currently plays for a team
              "player_stats",             // Get player performance data
              "team_record_without",      // Find team's record without a specific player
              "injury_news",              // Current injury status
              "replacement_options",      // Who would replace the player
              "team_form",               // Recent results and form
              "fixture_congestion",       // European/cup scheduling pressure
              "managerial_situation",     // Manager pressure, sacking rumours
              "tactical_analysis",       // System/formation information
              "general"                  // Other football research
            ]
          }
        },
        required: ["query", "intent"]
      }
    }
  }
];
```

### Tool Execution (in app/api/chat/route.ts)

The chat API endpoint handles the tool execution loop. When the LLM response contains a tool call:

```typescript
// Pseudocode for the tool execution loop in the chat API

async function handleChat(messages, mode, context) {
  const systemPrompt = buildSystemPrompt(mode, context);
  
  let conversation = [
    { role: 'system', content: systemPrompt },
    ...messages,
  ];
  
  const MAX_TOOL_ROUNDS = mode === 'deep' ? 8 : 2;  // Fast mode: max 2 searches
  
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await callOpenRouter({
      model: 'anthropic/claude-opus-4.6',  // or preferred model
      messages: conversation,
      tools: TOOLS,
    });
    
    // Check if the response contains tool calls
    const toolCalls = response.choices[0].message.tool_calls;
    
    if (!toolCalls || toolCalls.length === 0) {
      // Agent is done researching, return the final text response
      return parseAgentResponse(response.choices[0].message.content);
    }
    
    // Execute each tool call
    const toolResults = await Promise.all(
      toolCalls.map(async (call) => {
        if (call.function.name === 'web_search') {
          const args = JSON.parse(call.function.arguments);
          const results = await executeWebSearch(args.query);
          return {
            role: 'tool',
            tool_call_id: call.id,
            content: summariseSearchResults(results, args.intent),
          };
        }
      })
    );
    
    // Add the assistant's tool call message and tool results to conversation
    conversation.push(response.choices[0].message);
    conversation.push(...toolResults);
    
    // Loop continues — agent will either search again or respond with final answer
  }
  
  // Max rounds reached — ask agent to conclude with what it has
  conversation.push({
    role: 'user',
    content: 'Please provide your best estimate based on the research so far.',
  });
  
  const finalResponse = await callOpenRouter({
    model: 'anthropic/claude-opus-4.6',
    messages: conversation,
    tools: [],  // No more tools — force a text response
  });
  
  return parseAgentResponse(finalResponse.choices[0].message.content);
}
```

### Web Search Execution

The backend needs a search API to execute the agent's queries. Options in order of preference:

1. **Tavily API** — Purpose-built for AI agent search. Returns clean, summarised results. Free tier: 1000 searches/month. `https://tavily.com`
2. **Serper API** — Google search results as JSON. Free tier: 2500 searches/month. `https://serper.dev`
3. **Brave Search API** — Free tier: 2000 searches/month. `https://brave.search.com/api`

```typescript
// Example with Tavily
async function executeWebSearch(query: string): Promise<SearchResult[]> {
  const response = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: process.env.TAVILY_API_KEY,
      query,
      search_depth: 'basic',         // 'advanced' for deep mode if budget allows
      max_results: 5,
      include_answer: true,           // Tavily's AI summary
    }),
  });
  return response.json();
}

// Summarise results for the agent's context window
function summariseSearchResults(results: any, intent: string): string {
  // Return a concise summary focused on what the agent was looking for
  // Include: Tavily's AI answer, top 3 result snippets, source URLs
  // Keep under 500 tokens to preserve context window space
  const answer = results.answer || 'No direct answer found.';
  const snippets = results.results
    .slice(0, 3)
    .map((r: any) => `- ${r.title}: ${r.content?.slice(0, 200)}`)
    .join('\n');
  
  return `Search intent: ${intent}\nSummary: ${answer}\n\nTop results:\n${snippets}`;
}
```

### New Environment Variable

```env
TAVILY_API_KEY=              # https://tavily.com (free tier: 1000 searches/month)
```

---

## Agent System Prompt

This is the most critical piece. The system prompt defines how the agent reasons, what it can and cannot do, and the format of its output.

```typescript
function buildSystemPrompt(mode: 'fast' | 'deep', context: AgentContext): string {
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
Selected team: ${context.selectedTeam} (${context.selectedTeamName})
Current position: ${context.position}
Points: ${context.points} | GD: ${context.gd} | Games remaining: ${context.gamesRemaining}

Current standings (top of table and teams near ${context.selectedTeam}):
${context.standingsSummary}

Active scenario chapters:
${context.activeChaptersSummary || 'None — baseline simulation'}

High-leverage fixtures (from sensitivity analysis):
${context.sensitivitySummary}

## MODE: ${mode.toUpperCase()}
${mode === 'fast' ? `
FAST MODE: You have a budget of 1-2 web searches. Use them to verify the most critical facts (e.g., does the player still play for the claimed team? what is their current status?). Then reason from verified facts to produce your estimate. Be upfront about the limitations of a fast estimate.
` : `
DEEP MODE: You have a budget of up to 8 web searches. Follow this workflow:
1. PLAN: Before searching, tell the user your research plan (what you need to find and why). Ask them to confirm before proceeding.
2. RESEARCH: Execute your searches step by step. After each search, assess what you've learned and whether you need to adjust your plan.
3. SYNTHESISE: Combine your findings into a coherent analysis.
4. QUANTIFY: Translate your analysis into probability modifications.
Present your plan clearly and wait for user confirmation before executing.
`}

## SCENARIO TYPES AND APPROACH
When you receive a scenario, first classify it:

**Player injury/absence**: Search for the player's current club and role, their statistical contribution, the team's record with/without them, and likely replacement. Quantify as team-wide probability deltas.

**Fixture lock request**: ("Chelsea lose to Arsenal") This is a direct fixture override, not a probability modifier. Output it as a fixture_lock type, not a probability_modifier. No research needed unless the user wants analysis of knock-on effects.

**Team circumstance change**: (fixture congestion, cup exit, managerial change) Search for current team context, upcoming schedule, and historical parallels. Quantify as team-wide probability deltas.

**Unquantifiable scenario**: (rule changes, hypotheticals with no empirical basis) Tell the user you lack a strong basis for quantification. Ask them to provide their intuition about the direction and magnitude. Validate their estimate against what you can find, then structure it as a modification.

**Meta-scenario**: ("what's the most likely path to Europe") This is a V4 feature. For now, redirect the user to examine the sensitivity analysis and suggest which chapters might be worth exploring.

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

IMPORTANT: Always present the JSON block clearly so the frontend can parse it. Always follow it with a natural language explanation of what the numbers mean and an invitation to adjust.

## HANDLING REFINEMENT
When the user says something like "make it more severe" or "I think the impact is bigger":
- Do NOT re-run all your research
- Adjust the numbers in the direction requested
- Explain what changed and why the new magnitude is reasonable (or flag if it seems excessive)
- Output a new JSON block with the revised modification

## DOUBLE-COUNTING WARNING
If a scenario describes something that has ALREADY HAPPENED (a real, current injury), warn the user that current bookmaker odds may already reflect this. The modification would double-count the impact. Suggest they either:
1. Use the modification as a "what-if it hadn't happened" (inverted) to see how much it's already costing them
2. Only apply it if their data source hasn't updated yet

## CHAPTER AWARENESS
You are aware of existing active chapters. When the user adds a new scenario:
- Note any interactions with existing chapters (e.g., "you already have Bruno injured — adding Joelinton's return partially offsets this")
- Don't re-explain the impact of existing chapters unless asked
- Quantify the NEW chapter's impact relative to the current modified baseline, not the original baseline
`;
}
```

---

## Agent Context Building

The system prompt needs current context. Build it from the data the frontend sends:

```typescript
interface AgentContext {
  selectedTeam: string;
  selectedTeamName: string;
  position: number;
  points: number;
  gd: number;
  gamesRemaining: number;
  standingsSummary: string;         // Compact standings table
  activeChaptersSummary: string;    // List of active chapters
  sensitivitySummary: string;       // Top 5 high-leverage fixtures
}

function buildAgentContext(
  selectedTeam: string,
  teams: Team[],
  chapters: Chapter[],
  sensitivityResults: SensitivityResult[]
): AgentContext {
  const sorted = [...teams].sort((a, b) => b.points - a.points || b.goalDifference - a.goalDifference);
  const team = teams.find(t => t.abbr === selectedTeam)!;
  const position = sorted.findIndex(t => t.abbr === selectedTeam) + 1;

  // Show top 8 + teams within 5 positions of selected team
  const relevantTeams = sorted.filter((t, i) =>
    i < 8 || Math.abs(i - (position - 1)) <= 5
  );

  const standingsSummary = relevantTeams
    .map((t, i) => {
      const pos = sorted.indexOf(t) + 1;
      const marker = t.abbr === selectedTeam ? ' ◄' : '';
      return `${pos}. ${t.name} - ${t.points}pts (GD ${t.goalDifference > 0 ? '+' : ''}${t.goalDifference})${marker}`;
    })
    .join('\n');

  const activeChaptersSummary = chapters
    .filter(c => c.status === 'active')
    .map(c => `- ${c.title} (${c.type}, confidence: ${c.confidence})`)
    .join('\n') || 'None';

  const sensitivitySummary = sensitivityResults
    .slice(0, 5)
    .map(s => `- ${s.homeTeam} vs ${s.awayTeam}: max impact ${s.maxAbsDelta.toFixed(1)}pp`)
    .join('\n');

  return {
    selectedTeam,
    selectedTeamName: team.name,
    position,
    points: team.points,
    gd: team.goalDifference,
    gamesRemaining: 38 - team.played,
    standingsSummary,
    activeChaptersSummary,
    sensitivitySummary,
  };
}
```

---

## Response Parsing

The frontend needs to extract structured modifications from the agent's response. The agent outputs JSON blocks within its natural language response.

```typescript
interface ParsedAgentResponse {
  text: string;                                    // The full response text (for display)
  proposedModification?: ScenarioModification;     // Extracted from JSON block
  proposedLock?: { fixtureId: string; result: 'home' | 'draw' | 'away' };
  title?: string;
  confidence?: 'high' | 'medium' | 'low';
  reasoning?: string;
  isResearchPlan?: boolean;                        // Agent is presenting a plan, not a modification
  toolCalls?: ToolCall[];                          // Searches the agent made
}

function parseAgentResponse(content: string): ParsedAgentResponse {
  const result: ParsedAgentResponse = { text: content };

  // Extract JSON blocks
  const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[1]);
      
      if (parsed.type === 'scenario_modification') {
        result.proposedModification = parsed.modification;
        result.title = parsed.title;
        result.confidence = parsed.confidence;
        result.reasoning = parsed.reasoning;
      } else if (parsed.type === 'fixture_lock') {
        result.proposedLock = parsed.fixtureLock;
        result.title = parsed.title;
        result.reasoning = parsed.reasoning;
        result.confidence = 'high';
      }
    } catch {
      // JSON parsing failed — treat as plain text response
    }
  }

  // Check if this is a research plan (deep mode phase 2)
  if (content.includes('research plan') || content.includes('Here\'s my plan')) {
    result.isResearchPlan = true;
  }

  return result;
}
```

---

## Fast Mode vs Deep Mode — Detailed Workflows

### Fast Mode Workflow

```
User: "What if Cole Palmer gets injured?"

Agent thinking:
  1. I need to verify Palmer's current club (NEVER assume)
  2. Quick assessment of his importance
  
Agent → Tool: web_search("Cole Palmer current club 2025-26 season", "verify_player_team")
Tool → Agent: "Cole Palmer plays for Chelsea FC, 28 goals and 14 assists this season..."

Agent → Tool: web_search("Chelsea results without Cole Palmer 2025-26", "team_record_without")  
Tool → Agent: "Chelsea are 2W 3L in matches Palmer missed, averaging 0.8 PPG vs 1.7 with him..."

Agent response:
  "Based on a quick search, Cole Palmer is Chelsea's standout player this season
   with 28 goals and 14 assists. Chelsea's record without him is significantly
   worse — just 0.8 points per game compared to 1.7 with him.

   This is a major-tier impact. I'd estimate:
   
   [JSON block: CFC homeWinDelta: -0.14, awayWinDelta: -0.18, drawDelta: +0.05]
   
   This would indirectly help Newcastle by weakening a direct rival for European
   places. Shall I apply this, or would you like to adjust?"
```

**Total: 2 searches, 1 LLM round after tools, ~5-8 seconds**

### Deep Mode Workflow

```
User: "What if Cole Palmer gets injured?"

Agent response (Phase 2 — Plan):
  "I'll assess Cole Palmer's injury impact on Chelsea and the wider European race.
   Here's my research plan:
   
   1. Verify Palmer's current status at Chelsea and this season's statistics
   2. Find Chelsea's record in matches Palmer has missed this season
   3. Identify Palmer's statistical contribution (goals, assists, key passes, 
      chance creation) relative to the rest of the squad
   4. Determine who would replace him and their quality level
   5. Check if Chelsea have upcoming fixtures against teams near Newcastle
      in the European race (amplifying the indirect impact)
   
   Shall I proceed?"

User: "Go for it"

Agent → Tool: web_search("Cole Palmer Chelsea 2025-26 season statistics goals assists", "player_stats")
Agent → Tool: web_search("Chelsea FC results without Cole Palmer 2025-26", "team_record_without")
Agent → Tool: web_search("Chelsea FC squad attacking options midfield 2026", "replacement_options")
Agent → Tool: web_search("Chelsea remaining fixtures premier league 2025-26", "team_form")
Agent → Tool: web_search("Cole Palmer Chelsea chance creation expected goals 2025-26", "player_stats")

Agent response (Phase 4-5 — Quantification):
  "Here's what I found:
   
   **Palmer's contribution:** 28 goals, 14 assists — directly involved in 57% 
   of Chelsea's league goals. His xG+xA per 90 of 1.12 is nearly double the 
   next highest Chelsea player.
   
   **Chelsea without Palmer:** In 5 matches he missed, Chelsea won 2, lost 3, 
   scoring just 4 goals (0.8 per game vs their 1.9 average). Their creative 
   output dropped by roughly 60%.
   
   **Replacement:** Noni Madueke would likely shift centrally, with Christopher 
   Nkunku taking more creative responsibility. Madueke has 6 goals in 24 apps — 
   decent but not comparable.
   
   **Fixture impact on Newcastle:** Chelsea still play Brentford (GW35) and 
   Everton (GW37) — both teams Newcastle is competing with for 7th. A weakened 
   Chelsea losing those games would significantly help Newcastle.
   
   This is a clear major-tier impact:
   
   [JSON block: CFC homeWinDelta: -0.15, awayWinDelta: -0.19, drawDelta: +0.06,
    with fixture-specific overrides for CFC vs BRE and CFC vs EVE]
   
   **Bottom line:** Palmer's absence would likely drop Chelsea from 49 to 
   roughly 43-44 projected points, pulling them into the pack Newcastle is 
   competing with. The indirect benefit to Newcastle is significant.
   
   Apply this, or would you like to adjust?"
```

**Total: 5 searches, 2 LLM rounds, ~20-30 seconds**

---

## Handling Edge Cases

### Scenario Already Reflected in Odds

```
User: "Bruno Guimarães is injured, he got hurt last week"

Agent → Tool: web_search("Bruno Guimaraes injury March 2026", "injury_news")
Tool → Agent: "Bruno Guimarães confirmed out for 3 weeks with a hamstring injury..."

Agent response:
  "Bruno Guimarães is indeed currently injured — confirmed out for approximately 
   3 weeks with a hamstring issue since March 15.
   
   ⚠️ IMPORTANT: Because this injury is already public knowledge, the bookmaker 
   odds feeding our simulation likely already reflect his absence for the next 
   2-3 fixtures. Applying an additional modification would double-count the impact.
   
   Options:
   1. Skip this chapter — odds already account for it
   2. Apply it only for fixtures beyond the current odds window (games 4+ weeks out 
      where odds might not be posted yet)
   3. Apply the inverse — see how much his return would HELP compared to current baseline
   
   What would you prefer?"
```

### Unquantifiable Scenario

```
User: "What if the Premier League introduces a salary cap?"

Agent response:
  "A salary cap would be a structural change to the league with complex, 
   second-order effects. I don't have a strong empirical basis for quantifying 
   this — there's no direct historical parallel in the Premier League.
   
   To build a useful chapter, I need your intuition:
   
   - Which teams do you think would be most affected? (likely the big spenders: 
     City, Chelsea, United)
   - Would it make the league more competitive (weaker top teams) or just shift 
     spending patterns?
   - How significant do you think the impact would be — minor levelling, or a 
     major disruption?
   
   Give me a direction and rough magnitude, and I'll structure it as a 
   modification. I can then validate whether your estimate seems reasonable 
   by searching for comparable effects in other leagues with salary caps."
```

### Stacking With Existing Chapters

```
Active chapters: [Bruno Guimarães injured — NEW -12pp/match]

User: "What if Joelinton comes back from injury?"

Agent → Tool: web_search("Joelinton Newcastle injury return 2026", "injury_news")
Tool → Agent: "Joelinton has been out since January with a knee injury, expected back in April..."

Agent response:
  "Good news — Joelinton is currently expected back in April, which would 
   cover Newcastle's final 5-6 fixtures.
   
   Note: You already have Bruno Guimarães' absence as an active chapter 
   (-12pp/match). Joelinton's return would partially offset this — he 
   provides energy, defensive work rate, and physical presence in midfield.
   However, he's not a like-for-like creative replacement for Bruno.
   
   I'd estimate Joelinton's return as a minor-to-moderate positive:
   
   [JSON block: NEW homeWinDelta: +0.05, awayWinDelta: +0.04, drawDelta: -0.02]
   
   Net effect with both chapters: Newcastle still -7pp at home and -8pp away, 
   which reflects a midfield that's functional but missing its creative heartbeat.
   
   Apply this?"
```

---

## MCP Integration Pattern

The tool-use pattern described above follows the Model Context Protocol approach. For builders looking to extend Keepwatch with additional tools beyond web search, the MCP pattern allows plugging in new capabilities:

### Current Tool: Web Search
- Used for all football research
- Backend executes via Tavily/Serper/Brave
- Results summarised and returned to agent context

### Future MCP Tools (V4+)

**`simulation_run`** — Let the agent directly trigger simulations with specific parameters. Useful for V4 where the agent needs to test many scenario combinations.
```json
{
  "name": "simulation_run",
  "description": "Run a Monte Carlo simulation with the provided fixture modifications",
  "parameters": {
    "modifications": "ScenarioModification[]",
    "numSims": "number",
    "targetTeam": "string"
  }
}
```

**`sensitivity_query`** — Let the agent query the sensitivity data directly.
```json
{
  "name": "sensitivity_query",  
  "description": "Get the impact of a specific fixture result on the target team's odds",
  "parameters": {
    "fixtureId": "string",
    "result": "'home' | 'draw' | 'away'",
    "targetTeam": "string"
  }
}
```

**`odds_lookup`** — Let the agent check current bookmaker odds for a specific fixture.
```json
{
  "name": "odds_lookup",
  "description": "Get current bookmaker odds for an upcoming fixture",
  "parameters": {
    "homeTeam": "string",
    "awayTeam": "string"
  }
}
```

These additional tools transform the agent from a research-and-estimate system into a fully autonomous analyst that can iteratively search, simulate, compare, and refine. This is the foundation V4's inverse scenario search needs.

### MCP Server Architecture (Future)

For V4 and beyond, the tool backend could be formalised as an MCP server:

```
┌─────────────┐     ┌──────────────────┐     ┌──────────────────┐
│   Agent      │────▶│  Keepwatch MCP   │────▶│  External APIs   │
│   (LLM)      │◀────│  Server          │◀────│  (Tavily, Odds,  │
│              │     │                  │     │   football-data)  │
│              │     │  Tools:          │     └──────────────────┘
│              │     │  - web_search    │
│              │     │  - sim_run       │     ┌──────────────────┐
│              │     │  - sensitivity   │────▶│  Simulation      │
│              │     │  - odds_lookup   │◀────│  Engine          │
│              │     │                  │     │  (client-side)   │
└─────────────┘     └──────────────────┘     └──────────────────┘
```

This is not needed for V3B. But structuring the tool calls as clean, documented interfaces now means the MCP server is a straightforward extraction later.

---

## Environment Variables (V3B additions)

```env
# Add to existing .env.local
OPENROUTER_API_KEY=          # Agent LLM calls
TAVILY_API_KEY=              # Web search for agent research (free: 1000/month)
```

---

## Build Order (V3B)

V3B builds on V3A. The chat UI and chapter system must be working before starting.

### Step 1: Search Tool Backend
- Integrate Tavily (or Serper/Brave) into the chat API endpoint
- Create `executeWebSearch()` function
- Create `summariseSearchResults()` function
- **Test:** Call the search function directly with a football query. Verify results are relevant and concise.

### Step 2: Tool-Use Loop
- Implement the tool execution loop in `app/api/chat/route.ts`
- Handle: agent requests search → backend executes → results returned → agent continues
- Support multiple sequential tool calls (up to 2 for fast, 8 for deep)
- **Test:** Send a message that should trigger a search. Verify the agent receives results and incorporates them into its response.

### Step 3: System Prompt — Fast Mode
- Implement `buildSystemPrompt()` with fast mode instructions
- Implement `buildAgentContext()` to provide current standings, chapters, sensitivity data
- Configure the agent to ALWAYS search before making claims
- **Test:** Ask "what if [player] gets injured" in fast mode. Agent should search to verify the player's current team, then estimate impact. Response should take 5-8 seconds.

### Step 4: System Prompt — Deep Mode
- Add deep mode instructions to system prompt
- Implement research plan presentation (agent shows plan, waits for confirmation)
- Handle the confirm → research → synthesise flow
- **Test:** Same query in deep mode. Agent should present a plan, user confirms, agent executes 4-6 searches, then presents a grounded estimate with sources.

### Step 5: Structured Output Parsing
- Implement `parseAgentResponse()` to extract JSON modification blocks
- Wire parsed modifications into V3A's chapter creation flow
- Handle both `scenario_modification` and `fixture_lock` types
- **Test:** Full pipeline — chat message → agent research → structured output → parsed → chapter created → simulation updated → dashboard shows new odds.

### Step 6: Refinement Loop
- Handle "make it more severe" / "adjust the numbers" messages
- Agent should revise modification without re-running research
- Updated JSON block → frontend updates pending modification → user re-applies
- **Test:** Propose a modification, ask for adjustment, verify numbers change, apply the adjusted version.

### Step 7: Edge Case Handling
- Implement double-counting detection (scenario already in current odds)
- Implement unquantifiable scenario flow (ask user for estimates)
- Implement chapter interaction awareness (note existing chapters when adding new ones)
- **Test:** Each edge case workflow end-to-end.

### Step 8: Polish
- Streaming responses from OpenRouter (show agent thinking in real time)
- Search progress indicators in chat (show "Searching: [query]..." during tool execution)
- Error handling for failed searches, rate limits, API errors
- Graceful degradation: if search fails, agent should note this and work with what it has
- Token budget management: ensure context window doesn't overflow with many searches
- **Test:** Stress test with rapid scenario additions, long conversations, and multiple deep mode analyses.
