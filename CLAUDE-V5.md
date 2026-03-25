# CLAUDE-V5.md — Keepwatch: Counterfactual Season Simulator ("What If")

## Overview

V5 is the experimental capstone: **counterfactual season simulation**. The user selects a team whose target outcome is mathematically impossible (or near-impossible) under current conditions, and asks: "What would need to have been different for this to be achievable?" The system diagnoses structural bottlenecks, generates alternate-reality scenarios (squad changes, tactical pivots, competition prioritisation), translates them into probability modifications, runs them through the Monte Carlo engine, stress-tests them against real-world constraints, and produces a richly narrated strategic analysis.

V4 was reverse inference within current reality: "What results need to happen for X?"
V5 is counterfactual inference beyond current reality: "What structural changes would make X achievable?"

The output should feel like a boardroom strategic review crossed with a Monday Night Football deep-dive: specific player names, real transfer fees, genuine tactical analysis, hard simulation numbers — followed by an honest reality check.

### What V5 Delivers
- A "What If" trigger when a user explores an outcome with ~0% probability
- A multi-phase agentic pipeline powered by Vercel AI SDK 6's `ToolLoopAgent`
- FIFA 26 player quality data as a numerical backbone for squad analysis
- Iterative scenario generation → simulation → evaluation loops (5-15 iterations)
- A two-part output: "Perfect World" (mathematical ceiling) and "Real World" (pragmatic recommendation)
- Results cached in Supabase for instant retrieval
- Follow-up chat capability

### What V5 Depends On
- V4: Deep Analysis pipeline, path search, narrative agent
- V3B: Agent brain, web search tool-use loop, OpenRouter integration
- V3A: Chat sidebar, chapter system, modification engine
- V2: Team selector, sensitivity scan, simulation engine
- V1: Monte Carlo engine, standings/fixtures/odds data layer

### Key Technology Addition
- **Vercel AI SDK 6** (`ToolLoopAgent`) for agent orchestration
- **FC 26 (FIFA 26) Kaggle dataset** for player quality scores
- **Supabase** for caching analysis results

---

## Architecture

### The V5 Pipeline

```
User explores Aston Villa → sees 0% chance of being Champion
    │
    ▼
┌──────────────────────────────────────┐
│  PHASE 1: DETECT + CONFIGURE          │
│  System detects impossible/improbable  │
│  outcome, offers "What If" analysis    │
│  User confirms target + constraints    │
└──────────┬───────────────────────────┘
           │
    ┌──────┴───────────────────────────┐
    │  PHASE 2: DIAGNOSE                │  ← Agent + web search
    │  ~30-60 seconds                   │
    │                                   │
    │  1. Run baseline simulation       │
    │  2. Calculate gap to target       │
    │  3. Compute squad quality score   │
    │     (FIFA data for all 20 teams)  │
    │  4. Agent researches bottlenecks  │
    │     - Squad depth issues          │
    │     - Fixture congestion          │
    │     - Transfer window decisions   │
    │     - Tactical limitations        │
    │     - Injury patterns             │
    │                                   │
    │  Output: Diagnosis document       │
    │  with quantified problem areas    │
    └──────────┬───────────────────────┘
               │
    ┌──────────┴───────────────────────┐
    │  PHASE 3: HYPOTHESISE + SIMULATE  │  ← Agent + simulation loop
    │  ~3-10 minutes                    │
    │                                   │
    │  LOOP (5-15 iterations):          │
    │    1. Agent generates scenario    │
    │    2. Translate to prob. deltas   │
    │    3. Run Monte Carlo simulation  │
    │    4. Record results              │
    │    5. Agent evaluates + adapts    │
    │                                   │
    │  Scenarios explored:              │
    │  - "Perfect World" (max ceiling)  │
    │  - Squad upgrade scenarios        │
    │  - Competition prioritisation     │
    │  - Tactical system changes        │
    │  - Combination scenarios          │
    │                                   │
    │  Output: Scored scenario library  │
    └──────────┬───────────────────────┘
               │
    ┌──────────┴───────────────────────┐
    │  PHASE 4: STRESS-TEST             │  ← Agent + web search
    │  ~30-60 seconds                   │
    │                                   │
    │  For top 3-5 scenarios:           │
    │  1. Would the players be available│
    │     to sign? (web search)         │
    │  2. Would the club realistically  │
    │     make these decisions?         │
    │  3. What are the second-order     │
    │     effects? (morale, fans, etc.) │
    │                                   │
    │  Output: Feasibility scores       │
    └──────────┬───────────────────────┘
               │
    ┌──────────┴───────────────────────┐
    │  PHASE 5: SYNTHESISE + NARRATE    │  ← Agent
    │  ~30-60 seconds                   │
    │                                   │
    │  1. "Perfect World" analysis      │
    │  2. Reality check                 │
    │  3. "Pragmatic Path" recommendation│
    │  4. Long-term perspective         │
    │                                   │
    │  Output: Final analysis document  │
    └──────────┬───────────────────────┘
               │
    ┌──────────┴───────────────────────┐
    │  PHASE 6: CACHE + RENDER          │
    │  Store in Supabase                │
    │  Render editorial-style view      │
    │  Enable follow-up chat            │
    └──────────────────────────────────┘
```

### Key Design Principles

**1. The simulation engine remains the source of truth.** Every scenario the agent proposes gets translated into probability modifications and run through the Monte Carlo engine. The agent never just claims "this would improve odds by X%" — it proves it with 10,000 simulations.

**2. The agent is an iterative researcher, not a one-shot oracle.** It proposes, tests, evaluates, and refines. Each loop iteration builds on what was learned in the previous one. If Scenario A only moves the needle 3%, the agent should reason about why and try a different approach.

**3. Honesty is the product.** The "Perfect World" section shows the mathematical ceiling — often a surprisingly modest number. The "Real World" section is ruthlessly honest about why you can't get there. The "Pragmatic Path" offers something achievable. This structure is what makes the feature feel like genuine strategic analysis rather than a toy.

---

## New/Modified Files

```
app/
├── api/
│   ├── what-if/route.ts                    # NEW: Orchestrates the V5 pipeline
│   └── what-if/tools.ts                    # NEW: Tool definitions for ToolLoopAgent
│
├── components/
│   ├── WhatIfAnalysis.tsx                   # NEW: Full-page analysis renderer
│   ├── WhatIfTrigger.tsx                    # NEW: Trigger UI (appears on ~0% outcomes)
│   └── Dashboard.tsx                        # MODIFY: Detect impossible outcomes, show trigger
│
lib/
├── what-if/
│   ├── agent.ts                             # NEW: ToolLoopAgent configuration + system prompts
│   ├── tools/
│   │   ├── run-simulation.ts                # NEW: Tool wrapper for Monte Carlo engine
│   │   ├── lookup-player.ts                 # NEW: FIFA data lookup tool
│   │   ├── lookup-squad.ts                  # NEW: Full squad quality comparison tool
│   │   ├── web-search.ts                    # NEW: Tavily/web search tool
│   │   ├── evaluate-plausibility.ts         # NEW: Structured plausibility scoring tool
│   │   └── store-scenario.ts               # NEW: Write scenario result to accumulator
│   ├── fifa-data.ts                         # NEW: FIFA dataset loader + query functions
│   ├── squad-quality.ts                     # NEW: Squad quality scoring algorithms
│   └── types.ts                             # NEW: V5-specific types
│
├── supabase/
│   ├── client.ts                            # NEW: Supabase client setup
│   └── what-if-cache.ts                     # NEW: Cache read/write for analyses
│
└── server-simulation.ts                     # EXISTING (from V4): Server-side Monte Carlo
```

---

## New Types

```typescript
// lib/what-if/types.ts

// ── Squad Quality ──

interface PlayerQuality {
  name: string;
  overall: number;
  potential: number;
  age: number;
  positions: string[];
  club: string;
  valueEuro: number;
  wageEuro: number;
  // Aggregated attribute groups
  pace: number;
  shooting: number;
  passing: number;
  dribbling: number;
  defending: number;
  physical: number;
}

interface SquadProfile {
  teamName: string;
  teamAbbr: string;
  averageOverall: number;
  averageStartingXI: number;       // Top 11 by overall
  depthScore: number;              // Average of players 12-20
  weakestPositionGroup: string;    // e.g. "centre-back", "striker"
  weakestPositionAvg: number;
  strongestPositionGroup: string;
  strongestPositionAvg: number;
  players: PlayerQuality[];
  totalSquadValue: number;
}

// ── Scenario System ──

interface CounterfactualScenario {
  id: string;
  title: string;
  category: 'squad_upgrade' | 'competition_priority' | 'tactical_change' |
            'injury_prevention' | 'combination' | 'perfect_world';
  description: string;
  modifications: ScenarioModification[];
  simulationResult: {
    targetMetric: string;
    baselineOdds: number;
    modifiedOdds: number;
    delta: number;
  };
  plausibility: {
    score: number;           // 0-100
    reasoning: string;
    constraints: string[];   // List of real-world issues
  };
  iteration: number;         // Which loop iteration produced this
}

interface ScenarioModification {
  type: 'team_quality_delta' | 'fixture_lock' | 'probability_modifier' |
        'competition_withdrawal';
  description: string;
  // For team_quality_delta:
  teamAbbr?: string;
  homeWinDelta?: number;
  awayWinDelta?: number;
  drawDelta?: number;
  // For competition_withdrawal:
  competition?: string;     // e.g. "Europa League"
  fatigueReduction?: number;
}

// ── Analysis Output ──

interface WhatIfAnalysis {
  id: string;
  generatedAt: number;
  targetTeam: string;
  targetTeamName: string;
  targetMetric: string;
  targetMetricLabel: string;  // e.g. "League Champions"
  baselineOdds: number;

  // Phase 2 output
  diagnosis: {
    squadQualityRank: number;          // e.g. 6th best squad
    gapToTopSquad: number;             // Overall rating difference
    keyBottlenecks: string[];          // Identified structural issues
    narrativeSummary: string;          // 3-5 sentence diagnosis
  };

  // Phase 3 output
  scenarios: CounterfactualScenario[];
  perfectWorld: CounterfactualScenario;  // The mathematical ceiling

  // Phase 4 output
  stressTest: {
    feasibleScenarios: CounterfactualScenario[];
    infeasibleReasons: Record<string, string[]>;
  };

  // Phase 5 output
  narrative: {
    perfectWorldSection: string;
    realityCheckSection: string;
    pragmaticPathSection: string;
    longTermPerspective: string;
    bottomLine: string;
  };

  // Metadata
  totalIterations: number;
  totalSimulations: number;
  totalWebSearches: number;
  totalLLMCalls: number;
  wallClockTimeMs: number;
  costEstimate: number;
}

// ── Supabase Cache ──

interface CachedWhatIfAnalysis {
  id: string;
  team_abbr: string;
  target_metric: string;
  analysis_json: WhatIfAnalysis;
  created_at: string;
  season: string;           // e.g. "2025-26"
  gameweek: number;         // When it was generated
}
```

---

## Tool Definitions for ToolLoopAgent

The agent has access to six tools. Each tool is a clean interface that the agent can call iteratively.

```typescript
// lib/what-if/tools.ts

import { tool } from 'ai';
import { z } from 'zod';

// ── Tool 1: Run Simulation ──
// Agent provides probability modifications, gets back hard numbers
export const runSimulationTool = tool({
  description: `Run a Monte Carlo simulation with modified probabilities.
    Provide team-level probability deltas (e.g. increase Villa's home win
    probability by 0.08). Returns the target metric probability.
    Use this to TEST every hypothesis with real numbers.`,
  parameters: z.object({
    modifications: z.array(z.object({
      teamAbbr: z.string(),
      homeWinDelta: z.number().min(-0.5).max(0.5),
      awayWinDelta: z.number().min(-0.5).max(0.5),
      drawDelta: z.number().min(-0.3).max(0.3),
    })),
    fixtureLocks: z.array(z.object({
      fixtureId: z.string(),
      result: z.enum(['home', 'draw', 'away']),
    })).optional(),
    simCount: z.number().default(10000),
  }),
  execute: async ({ modifications, fixtureLocks, simCount }) => {
    // Calls server-side Monte Carlo engine with modifications applied
    // Returns: { targetMetricPct, expectedPoints, expectedPosition, positionDistribution }
  },
});

// ── Tool 2: Lookup Player Quality ──
// Agent can query individual players from the FIFA dataset
export const lookupPlayerTool = tool({
  description: `Look up a player's FIFA 26 quality ratings. Use this to
    compare players numerically — e.g. "Is Ollie Watkins (82) a significant
    upgrade over the average PL striker (76)?"`,
  parameters: z.object({
    playerName: z.string(),
    fuzzyMatch: z.boolean().default(true),
  }),
  execute: async ({ playerName, fuzzyMatch }) => {
    // Searches FIFA dataset, returns PlayerQuality or top 3 matches
  },
});

// ── Tool 3: Compare Squad Quality ──
// Agent can compare entire squads numerically
export const compareSquadsTool = tool({
  description: `Compare squad quality profiles between two or more teams.
    Returns overall ratings, depth scores, position-group breakdowns,
    and identifies the biggest quality gaps. Essential for diagnosing
    why a team can't compete at the target level.`,
  parameters: z.object({
    teams: z.array(z.string()).min(2).max(5),
  }),
  execute: async ({ teams }) => {
    // Returns SquadProfile[] with comparison metrics
  },
});

// ── Tool 4: Web Search ──
// Agent can research real-world context
export const webSearchTool = tool({
  description: `Search the web for current football information. Use for:
    - Verifying transfers and fees
    - Checking if a player would realistically be available
    - Finding tactical analysis
    - Checking team circumstances (fixture congestion, cup runs)
    ALWAYS verify football facts via search. Never trust training data.`,
  parameters: z.object({
    query: z.string(),
    maxResults: z.number().default(5),
  }),
  execute: async ({ query, maxResults }) => {
    // Calls Tavily API, returns summarised results
  },
});

// ── Tool 5: Evaluate Plausibility ──
// Structured self-evaluation
export const evaluatePlausibilityTool = tool({
  description: `Score the plausibility of a scenario you've just simulated.
    Forces structured reasoning about whether it could really happen.
    Call this AFTER running a simulation, BEFORE storing the result.`,
  parameters: z.object({
    scenarioTitle: z.string(),
    scenarioDescription: z.string(),
    constraints: z.array(z.string()).describe(
      'List every reason this scenario might not be realistic'
    ),
    plausibilityScore: z.number().min(0).max(100).describe(
      '0 = impossible fantasy, 100 = already happening. Be harsh.'
    ),
    reasoning: z.string(),
  }),
  execute: async (input) => {
    // Simply returns the structured evaluation (the act of calling
    // this tool forces the agent to think critically)
    return input;
  },
});

// ── Tool 6: Store Scenario Result ──
// Agent explicitly saves scenarios worth keeping
export const storeScenarioTool = tool({
  description: `Store a completed scenario with its simulation results
    and plausibility evaluation. Only store scenarios that are worth
    including in the final analysis — don't store dead ends.`,
  parameters: z.object({
    title: z.string(),
    category: z.enum([
      'squad_upgrade', 'competition_priority', 'tactical_change',
      'injury_prevention', 'combination', 'perfect_world'
    ]),
    description: z.string(),
    modifications: z.array(z.object({
      teamAbbr: z.string(),
      homeWinDelta: z.number(),
      awayWinDelta: z.number(),
      drawDelta: z.number(),
    })),
    simulationResult: z.object({
      targetMetric: z.string(),
      baselineOdds: z.number(),
      modifiedOdds: z.number(),
      delta: z.number(),
    }),
    plausibility: z.object({
      score: z.number(),
      reasoning: z.string(),
      constraints: z.array(z.string()),
    }),
  }),
  execute: async (scenario) => {
    // Appends to the running scenario accumulator
    return { stored: true, scenarioCount: /* current count */ };
  },
});
```

---

## Agent System Prompt (Phase 3: Hypothesise + Simulate)

```typescript
function buildWhatIfAgentPrompt(context: WhatIfContext): string {
  return `You are Keepwatch's counterfactual analysis agent. Your job is to
explore alternate realities: "What if this team's season had been constructed
differently? Could they have achieved [target outcome]?"

## YOUR MISSION
${context.teamName} currently has a ${context.baselineOdds.toFixed(1)}%
chance of ${context.targetLabel}. That's effectively impossible under current
conditions. Your job is to explore what structural changes — squad upgrades,
tactical pivots, competition prioritisation, fitness investments — could make
it achievable. Then be ruthlessly honest about whether those changes are
realistic.

## DIAGNOSIS (from Phase 2)
${context.diagnosisNarrative}

Squad quality ranking: ${context.squadRank}th of 20 (overall avg: ${context.squadAvg})
Gap to #1 squad: ${context.gapToTop} rating points
Key bottlenecks: ${context.bottlenecks.join(', ')}

## YOUR TOOLS
You have six tools. Use them in this pattern:

1. **compareSquads** — Understand the quality gap numerically
2. **lookupPlayer** — Identify specific upgrade targets
3. **webSearch** — Verify transfers, fees, availability
4. **runSimulation** — TEST every hypothesis with real Monte Carlo numbers
5. **evaluatePlausibility** — Score each scenario honestly
6. **storeScenario** — Save scenarios worth including in the final output

## YOUR WORKFLOW
You must explore AT LEAST 5 distinct scenarios. Follow this order:

### Iteration 1: The Perfect World
Lock ALL of ${context.teamName}'s remaining fixtures to wins. Lock the most
favourable results for all rival fixtures. Run the simulation. This is the
mathematical ceiling — how good could it possibly get? Store this as
category "perfect_world".

### Iterations 2-3: Squad Upgrade Scenarios
Using the FIFA data, identify the positions where ${context.teamName} is
weakest relative to the top teams. Find realistic upgrade targets (players
at similar-level clubs, not superstars who would never move). Estimate the
quality improvement as a probability delta:
- +1 to +3 overall rating avg improvement → +0.03 to +0.06 home/away win delta
- +4 to +6 overall rating avg improvement → +0.07 to +0.12 home/away win delta
- +7+ overall rating avg improvement → +0.13 to +0.18 home/away win delta

Run the simulation with these modifications. Be specific about which players
you'd sign, which you'd sell, and the net financial impact.

### Iteration 4: Competition Prioritisation
What if ${context.teamName} deprioritised cups and/or European competition?
Model this as a fatigue reduction: fewer midweek games → fresher squad →
higher win probabilities in the league.
- Deprioritise one cup: +0.02 to +0.04 league win delta
- Deprioritise all cups: +0.04 to +0.07 league win delta
- Full Europa/Conference withdrawal (play youth): +0.05 to +0.10 league delta

### Iterations 5+: Combination and Creative Scenarios
Combine the best elements from earlier iterations. Also consider:
- What if a key rival lost their best player? (Search for who that is)
- What if the team had invested in sports science/physio? (Injury reduction)
- What if the manager had adopted a different tactical system?

For each, run the simulation and store the result.

## CRITICAL RULES
1. NEVER claim a probability impact without running the simulation tool.
   You must get real numbers, not estimates.
2. ALWAYS verify player facts via web search. Your training data is stale.
3. Be HARSH with plausibility scores. If a scenario requires signing
   Haaland, it gets a 5/100. If it requires signing a realistic target
   from a mid-table club, it might get 50-70/100.
4. The goal is NOT to prove the target is achievable. Often it genuinely
   isn't. The goal is to find the realistic ceiling and explain what it
   would take — even if the answer is "it would take years."
5. After storing at least 5 scenarios, you MUST stop and output a
   summary of all stored scenarios ranked by (delta × plausibility).

## QUANTIFICATION FRAMEWORK
Translate squad quality changes to probability deltas using this scale:

| Change | Home Win Delta | Away Win Delta | Example |
|--------|---------------|----------------|---------|
| Minor upgrade (1-2 OVR avg) | +0.03 | +0.02 | Signing a solid backup |
| Moderate upgrade (3-5 OVR avg) | +0.07 | +0.05 | Upgrading a weak position |
| Major upgrade (6+ OVR avg) | +0.12 | +0.10 | Complete position overhaul |
| World-class addition | +0.15 | +0.12 | Signing a top-20 global player |

For competition prioritisation:
| Change | League Win Delta | Reasoning |
|--------|-----------------|-----------|
| Rotate in 1 cup | +0.02 | Slight freshness gain |
| Youth team in all cups | +0.05 | Major squad preservation |
| No Europe at all | +0.08 | Eliminates midweek travel/fatigue |

These are starting points. Adjust based on your research.`;
}
```

---

## Supabase Schema

```sql
-- Cache table for completed analyses
CREATE TABLE what_if_analyses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_abbr TEXT NOT NULL,
  target_metric TEXT NOT NULL,
  season TEXT NOT NULL DEFAULT '2025-26',
  gameweek INTEGER NOT NULL,
  analysis_json JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),

  -- Composite unique: one analysis per team+metric+gameweek
  UNIQUE(team_abbr, target_metric, season, gameweek)
);

-- Index for fast lookups
CREATE INDEX idx_what_if_team ON what_if_analyses(team_abbr, season);

-- Progress tracking for long-running analyses
CREATE TABLE what_if_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id UUID REFERENCES what_if_analyses(id),
  phase TEXT NOT NULL,          -- 'diagnose', 'hypothesise', 'stress_test', 'synthesise'
  status TEXT NOT NULL,          -- 'running', 'complete', 'error'
  progress_pct INTEGER DEFAULT 0,
  current_step TEXT,             -- Human-readable status message
  scenarios_found INTEGER DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## FIFA Data Integration

### Data Loading

```typescript
// lib/what-if/fifa-data.ts

import Papa from 'papaparse';

// The CSV is downloaded from Kaggle and stored in /data/fc26-players.csv
// At build time or first request, parse and cache in memory

let playerCache: PlayerQuality[] | null = null;

export async function loadFIFAData(): Promise<PlayerQuality[]> {
  if (playerCache) return playerCache;

  const csv = await fs.readFile('data/fc26-players.csv', 'utf-8');
  const parsed = Papa.parse(csv, { header: true, dynamicTyping: true });

  playerCache = parsed.data
    .filter((row: any) => row.Overall && row.Club)
    .map((row: any) => ({
      name: row.Name || row.LongName,
      overall: row.Overall,
      potential: row.Potential,
      age: row.Age,
      positions: (row.Positions || row.BestPosition || '').split(',').map((p: string) => p.trim()),
      club: row.Club,
      valueEuro: row.ValueEUR || row.Value || 0,
      wageEuro: row.WageEUR || row.Wage || 0,
      pace: row.Pace || row.PAC || 0,
      shooting: row.Shooting || row.SHO || 0,
      passing: row.Passing || row.PAS || 0,
      dribbling: row.Dribbling || row.DRI || 0,
      defending: row.Defending || row.DEF || 0,
      physical: row.Physicality || row.PHY || 0,
    }));

  return playerCache;
}

// Map FIFA club names to our team abbreviations
const CLUB_TO_ABBR: Record<string, string> = {
  'Arsenal': 'ARS',
  'Aston Villa': 'AVL',
  'Newcastle United': 'NEW',
  // ... all 20 PL teams
};
```

### Squad Quality Scoring

```typescript
// lib/what-if/squad-quality.ts

export function computeSquadProfile(
  players: PlayerQuality[],
  teamName: string,
  teamAbbr: string
): SquadProfile {
  const squad = players.filter(p => p.club === teamName);
  const sorted = [...squad].sort((a, b) => b.overall - a.overall);

  const startingXI = sorted.slice(0, 11);
  const bench = sorted.slice(11, 20);

  // Position group analysis
  const positionGroups = groupByPosition(squad);
  const groupAverages = Object.entries(positionGroups).map(([group, players]) => ({
    group,
    avg: players.reduce((s, p) => s + p.overall, 0) / players.length,
    count: players.length,
  }));

  const weakest = groupAverages.reduce((a, b) => a.avg < b.avg ? a : b);
  const strongest = groupAverages.reduce((a, b) => a.avg > b.avg ? a : b);

  return {
    teamName,
    teamAbbr,
    averageOverall: squad.reduce((s, p) => s + p.overall, 0) / squad.length,
    averageStartingXI: startingXI.reduce((s, p) => s + p.overall, 0) / 11,
    depthScore: bench.length > 0
      ? bench.reduce((s, p) => s + p.overall, 0) / bench.length
      : 0,
    weakestPositionGroup: weakest.group,
    weakestPositionAvg: weakest.avg,
    strongestPositionGroup: strongest.group,
    strongestPositionAvg: strongest.avg,
    players: squad,
    totalSquadValue: squad.reduce((s, p) => s + p.valueEuro, 0),
  };
}
```

---

## Cost Budget (V5)

Per What-If analysis generation:
- LLM calls (agent loop): ~$0.50-2.00 (depends on iterations, ~5-15 calls at ~$0.10-0.15 each)
- Web searches: 10-25 Tavily calls (~$0.10-0.25)
- Monte Carlo computation: free (server-side, ~1-2 seconds per sim run × 5-15 runs)
- Supabase storage: negligible
- **Total per analysis: ~$0.60-2.25**
- **Wall-clock time: ~3-10 minutes** (acceptable for a deep analysis; cached for instant replay)

This is more expensive than V4 (~$0.15-0.50) but justifiable for an experimental feature that runs infrequently and produces high-value output.

---

## Build Roadmap

### Phase A: Foundation (Steps 1-4)
*Goal: Get the data layer and basic tooling working independently*

#### Step 1: Vercel AI SDK 6 Setup
- Install `ai@latest` and `@ai-sdk/openai` (or appropriate provider for OpenRouter)
- Create a minimal `ToolLoopAgent` that can call a simple echo tool
- Verify the agent loop works: prompt → tool call → result → response
- **Test:** Agent receives "What is 2+2?", calls a calculator tool, returns "4"
- **Learning:** Understanding ToolLoopAgent lifecycle, tool definitions, stop conditions
- **Estimated time:** 2-3 hours

#### Step 2: FIFA Data Integration
- Download FC 26 dataset from Kaggle
- Create `lib/what-if/fifa-data.ts` — CSV parser + in-memory cache
- Create `lib/what-if/squad-quality.ts` — squad profiling algorithms
- Map FIFA club names to our existing team abbreviations
- Compute `SquadProfile` for all 20 PL teams
- **Test:** Call `computeSquadProfile('Arsenal')` and verify it returns sensible numbers (top players, position groups, quality rankings)
- **Test:** Verify all 20 PL teams have mapped squads with >18 players each
- **Learning:** FIFA data structure, position grouping logic, quality metrics
- **Estimated time:** 3-4 hours

#### Step 3: Supabase Setup
- Create Supabase project (or add to existing if one exists)
- Create `what_if_analyses` and `what_if_progress` tables
- Create `lib/supabase/client.ts` — Supabase client initialisation
- Create `lib/supabase/what-if-cache.ts` — read/write functions
- **Test:** Write a mock analysis JSON, read it back, verify roundtrip
- **Test:** Upsert on duplicate (team_abbr + target_metric + gameweek)
- **Learning:** Supabase client setup, JSONB storage patterns
- **Estimated time:** 2-3 hours

#### Step 4: Individual Tool Development
Build and test each tool in isolation before connecting them to the agent:

**4a: `runSimulationTool`**
- Wrap the existing `server-simulation.ts` engine in a tool-compatible interface
- Accept probability modifications and fixture locks
- Return target metric percentage + position distribution
- **Test:** Apply +0.10 home win delta to Newcastle, verify odds increase by a sensible amount

**4b: `lookupPlayerTool`**
- Fuzzy name matching against FIFA dataset (handle "Watkins" → "Ollie Watkins")
- Return structured player quality data
- **Test:** Look up "Saka", "Haaland", "Watkins" — verify correct players returned

**4c: `compareSquadsTool`**
- Takes 2-5 team abbreviations, returns comparative squad profiles
- Highlights the biggest quality gaps between teams
- **Test:** Compare Arsenal vs Aston Villa, verify Arsenal rates higher in most categories

**4d: `webSearchTool`**
- Wrap Tavily (or existing web search integration from V3B)
- Return summarised results with source URLs
- **Test:** Search "Aston Villa transfers January 2026", verify relevant results

**4e: `evaluatePlausibilityTool`**
- Simple passthrough that structures the agent's self-evaluation
- **Test:** Call with mock data, verify structured output returned

**4f: `storeScenarioTool`**
- Appends to an in-memory accumulator during a single analysis run
- **Test:** Store 3 scenarios, verify accumulator holds all 3

- **Estimated time (all 4a-4f):** 4-6 hours

---

### Phase B: Agent Loop (Steps 5-7)
*Goal: Get the iterative agent working end-to-end with real data*

#### Step 5: Phase 2 — Diagnosis Agent
- Create the diagnosis system prompt
- Wire up a `ToolLoopAgent` that:
  - Calls `compareSquads` to rank the target team
  - Calls `webSearch` to research current squad issues
  - Produces a structured diagnosis (bottlenecks, quality gaps, narrative)
- Agent should use 3-5 tool calls and stop
- **Test:** Run diagnosis for Aston Villa targeting "Champion"
- Verify: squad ranking is correct, bottlenecks are specific and verified, narrative reads well
- **Learning:** System prompt engineering for focused tool use, stop conditions
- **Estimated time:** 3-4 hours

#### Step 6: Phase 3 — Hypothesise + Simulate Loop
- This is the heart of V5 and the hardest step
- Create the main agent system prompt (see above)
- Wire up `ToolLoopAgent` with all 6 tools and `stopWhen: stepCountIs(50)`
- The agent should:
  - Start with "Perfect World" scenario (lock all fixtures favourably)
  - Progress through squad upgrades using FIFA data
  - Explore competition prioritisation
  - Try combinations
  - Store at least 5 scenarios
- Add a safety limit: max 15 simulation runs per analysis
- **Test:** Run the full loop for Aston Villa → Champion
  - Does it call runSimulation at least 5 times?
  - Does it call lookupPlayer to find specific upgrade targets?
  - Does it call webSearch to verify transfers?
  - Does it call evaluatePlausibility for each scenario?
  - Does it store at least 5 scenarios?
  - Are the simulation numbers sensible (not 0% everywhere, not 100%)?
- **Learning:** Long-running agent loops, token budgets, preventing agent from going off-track
- **Estimated time:** 6-8 hours (expect iteration/debugging)

#### Step 7: Phase 4 — Stress Test Agent
- Separate, shorter agent run that takes the top 3-5 scenarios from Phase 3
- For each scenario, searches for real-world constraints:
  - "Would Player X actually be available to sign?"
  - "Has Club Y shown any interest in selling?"
  - "What would fans/board think of deprioritising Europe?"
- Adjusts plausibility scores based on findings
- **Test:** Run stress test on the scenarios from Step 6
- Verify: at least one scenario gets its plausibility reduced, constraints are specific
- **Learning:** Multi-agent handoff, context passing between phases
- **Estimated time:** 3-4 hours

---

### Phase C: Synthesis + UI (Steps 8-11)
*Goal: Turn raw agent output into a polished user-facing experience*

#### Step 8: Phase 5 — Narrative Synthesis Agent
- Takes all scenarios, diagnosis, and stress test results
- Produces the four-section narrative:
  1. **The Perfect World** — What if everything went right? (Ceiling number + what it requires)
  2. **The Reality Check** — Why you can't have that (specific constraints)
  3. **The Pragmatic Path** — What's actually achievable (moderate scenario + its odds)
  4. **The Long View** — Historical perspective + multi-year framing
- **Test:** Generate full narrative for Aston Villa → Champion
- Verify: all four sections populated, specific player names mentioned, honest about limitations
- **Estimated time:** 4-5 hours

#### Step 9: API Endpoint + Background Processing
- Create `app/api/what-if/route.ts`
- Implement as a background job pattern:
  - POST triggers analysis, returns an `analysisId` immediately
  - Analysis runs server-side, writes progress to Supabase
  - Client polls progress endpoint every 5 seconds
  - On completion, analysis JSON is in Supabase
- Handle errors gracefully (agent timeout, search failure, sim error)
- **Test:** Trigger analysis via API, poll progress, receive completed analysis
- **Learning:** Background job patterns in Vercel, long-running function limits
- **Estimated time:** 4-5 hours

#### Step 10: What-If UI
- Create `WhatIfTrigger.tsx` — appears when a metric card shows ~0%
  - "This outcome is beyond mathematical possibility. Want to explore what it would take?"
  - User confirms target + optional constraints
- Create `WhatIfAnalysis.tsx` — full-page editorial view
  - Stat cards: Current position, squad rank, baseline odds, ceiling odds
  - Section 1: Perfect World (with simulation numbers)
  - Section 2: Reality Check (with specific constraints)
  - Section 3: Pragmatic Path (with moderate scenario detail)
  - Section 4: The Long View
  - Methodology footer
- Progress indicator during generation:
  - "Diagnosing structural bottlenecks..."
  - "Exploring scenario 3 of 8: What if Villa signed a top striker?"
  - "Stress-testing against real-world constraints..."
  - "Writing analysis..."
- **Test:** Full click-through from trigger to rendered analysis
- **Estimated time:** 6-8 hours

#### Step 11: Caching + Follow-Up Chat
- On completion, analysis is cached in Supabase
- Subsequent visits to the same team+metric load from cache instantly
- "Regenerate" button to force a fresh analysis
- Follow-up chat: sidebar switches to analysis context mode
  - User can ask "Why did you choose those players?"
  - Agent has the full analysis in context
- **Test:** Generate analysis → navigate away → return → verify instant load from cache
- **Test:** Ask follow-up question, verify response references the analysis
- **Estimated time:** 3-4 hours

---

### Phase D: Polish + Demo Prep (Steps 12-13)

#### Step 12: Edge Cases + Error Handling
- What if the team already has a high probability? (Redirect to V4 Deep Analysis instead)
- What if FIFA data is missing for a team? (Fallback to web-search-only analysis)
- What if the agent exceeds token limits? (Graceful truncation + partial results)
- What if Tavily/search is down? (Degrade to FIFA-data-only analysis)
- Agent timeout handling (save partial results, let user retry)
- **Estimated time:** 3-4 hours

#### Step 13: Pedram Demo Preparation
- Identify 2-3 compelling demo scenarios:
  - Aston Villa → Champion (the example from our conversation)
  - A relegation team → Top 7 (dramatic gap, shows range)
  - Newcastle → Champion (familiar team, resonant with V4)
- Pre-generate and cache these analyses so the demo is instant
- Prepare the Innovera parallel talking points:
  - "Replace 'Aston Villa becomes champion' with 'portfolio achieves 15% returns'"
  - "Replace 'sign a better striker' with 'reallocate from bonds to growth equity'"
  - "Replace 'deprioritise Europa League' with 'exit low-margin business units'"
  - "The honest reality check section is what separates this from a chatbot"
- Write demo script: which buttons to click, what to say at each stage
- **Estimated time:** 3-4 hours

---

## Summary: Total Estimated Build

| Phase | Steps | Estimated Hours | Focus |
|-------|-------|----------------|-------|
| A: Foundation | 1-4 | 11-16 hours | Data + tools + infrastructure |
| B: Agent Loop | 5-7 | 12-16 hours | Core agent pipeline |
| C: Synthesis + UI | 8-11 | 17-22 hours | Narration + UI + caching |
| D: Polish + Demo | 12-13 | 6-8 hours | Edge cases + demo prep |
| **Total** | **1-13** | **46-62 hours** | |

At ~3-4 hours per session, this is roughly **15-20 working sessions**. Given you're also polishing existing features and prepping the Pedram presentation, a realistic timeline is **3-4 weeks** of focused work.

---

## Connection to Innovera Demo

V5 is the "wow" feature for the Pedram demo. The demo flow:

1. Open Keepwatch, select Aston Villa
2. Dashboard shows current odds — 0% for Champion
3. The "What If" trigger appears: "Want to explore what it would take?"
4. System runs (pre-cached for demo: instant load)
5. Analysis reveals:
   - **Perfect World:** "Even if everything broke Villa's way, champion odds peak at ~11%"
   - **Reality Check:** "Players A and B wouldn't realistically be available. Forfeiting Europe isn't palatable for fans or board."
   - **Pragmatic Path:** "A more achievable restructuring gets you to 4% champion odds — but essentially guarantees Champions League, which is the real prize."
   - **Long View:** "Villa were in the Championship from 2016-2019. The trajectory is remarkable. Champions League is the next step."
6. Follow-up: "What if we only changed the transfer strategy?"

The parallel writes itself:
- "Portfolio can't hit 15% returns this year. But here's what structural changes would get you closest — and why 10% with lower risk is the smarter target."
- The system doesn't just compute — it reasons, researches, simulates, and then tells you the truth.

That's not a ChatGPT wrapper. That's a strategic intelligence tool.
