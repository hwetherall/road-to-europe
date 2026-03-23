# CLAUDE-V4.md — Keepwatch: Inverse Scenario Discovery (Deep Analysis)

## Overview

V4 is the capstone feature: **inverse scenario discovery**. The user specifies a desired outcome ("What needs to happen for Newcastle to qualify for Europe?") and the system discovers which real-world scenarios could produce it, presenting them as a narrative-rich Deep Analysis document.

V3 was forward inference: user specifies cause → system calculates effect.
V4 is reverse inference: user specifies desired effect → system discovers plausible causes.

The output should feel like a Monday Night Football deep-dive segment: specific, data-informed, occasionally surprising, grounded in both mathematics and football intelligence.

### What V4 Delivers
- A "Deep Analysis" button/mode in the chat sidebar
- A server-side path search algorithm that finds scenario combinations crossing a target probability threshold
- A plausibility scoring system that filters mathematically optimal but unrealistic paths
- An agent pipeline that researches and narrates the surviving paths into a structured document
- A full-page Deep Analysis view with four sections: State of Play, Decisive Match, Matches to Watch, Bottom Line
- Follow-up chat capability ("Ask about this analysis")

### What V4 Depends On
- V3A: Chat sidebar, chapter system, modification engine
- V3B: Agent brain, web search tool-use loop, OpenRouter integration
- V2: Team selector, sensitivity scan, simulation engine
- V1: Monte Carlo engine, standings/fixtures/odds data layer

---

## Architecture

### The V4 Pipeline

```
User asks: "What needs to happen for Newcastle to qualify for Europe?"
    │
    ▼
┌──────────────────────────────────┐
│  PHASE 1: PARSE + CONFIGURE      │
│  Extract: target team, target     │
│  metric (top7Pct), threshold (50%)│
│  Or ask user to clarify           │
└──────────┬───────────────────────┘
           │
    ┌──────┴───────────────────────┐
    │  PHASE 2: PATH SEARCH        │   ← Pure computation, no LLM
    │  Server-side, ~2 seconds      │
    │                               │
    │  1. Run baseline simulation   │
    │  2. Sensitivity scan (top 15) │
    │  3. Greedy optimal path       │
    │  4. Branch at decision points │
    │  5. Plausibility filter       │
    │  6. Validate with 10K sims    │
    │                               │
    │  Output: 4-6 candidate paths  │
    │  with plausibility scores     │
    └──────────┬───────────────────┘
               │
    ┌──────────┴───────────────────┐
    │  PHASE 3: RESEARCH + NARRATE  │   ← LLM + web search
    │  ~20-30 seconds               │
    │                               │
    │  1. Identify decisive match   │
    │  2. Research teams involved    │
    │  3. Compose 4-section output  │
    │  4. Ground in tactical detail  │
    │                               │
    │  Output: Deep Analysis doc    │
    └──────────┬───────────────────┘
               │
    ┌──────────┴───────────────────┐
    │  PHASE 4: RENDER + INTERACT   │
    │  Full-page analysis view      │
    │  Follow-up chat enabled       │
    └──────────────────────────────┘
```

### Key Design Principle: Computation and Narration Are Separate

Phase 2 (path search) is **pure computation**. No LLM calls. It runs the Monte Carlo engine, explores scenario combinations, scores plausibility, and produces structured data: a ranked list of paths with fixture locks and probabilities.

Phase 3 (research + narration) is **pure LLM**. It receives the path search results and enriches them with web-researched football intelligence, tactical context, and narrative structure.

These two phases can be developed and tested independently. The path search can be validated with unit tests (does greedy expansion find reasonable paths? does plausibility filtering kill absurd scenarios?). The narrative agent can be tested with mock path data.

---

## New/Modified Files

```
app/
├── api/
│   ├── deep-analysis/route.ts           # NEW: Orchestrates the full V4 pipeline
│   └── chat/route.ts                    # MODIFY: Add 'analysis' mode alongside fast/deep
│
├── components/
│   ├── DeepAnalysis.tsx                  # NEW: Full-page analysis renderer
│   ├── AnalysisStateOfPlay.tsx           # NEW: Section 1 — current position + optimal path
│   ├── AnalysisDecisiveMatch.tsx         # NEW: Section 2 — highest-leverage fixture deep-dive
│   ├── AnalysisMatchesToWatch.tsx        # NEW: Section 3 — key non-team fixtures
│   ├── AnalysisBottomLine.tsx            # NEW: Section 4 — pundit summary
│   ├── DeepAnalysisTrigger.tsx           # NEW: Button/mode in chat to start analysis
│   ├── ChatSidebar.tsx                   # MODIFY: Handle analysis mode + follow-up questions
│   └── Dashboard.tsx                     # MODIFY: Conditionally show DeepAnalysis view
│
lib/
├── path-search.ts                        # NEW: Greedy expansion + branching algorithm
├── plausibility.ts                       # NEW: Composite plausibility scoring
├── server-simulation.ts                  # NEW: Server-side copy of Monte Carlo engine
├── types.ts                              # MODIFY: Add V4 types
└── [all other lib files unchanged]
```

---

## New Types

```typescript
// Add to lib/types.ts

// ── Path Search ──

interface PathSearchConfig {
  teams: Team[];
  fixtures: Fixture[];
  targetTeam: string;              // e.g. "NEW"
  targetMetric: keyof SimulationResult;  // e.g. "top7Pct"
  targetThreshold: number;         // e.g. 50 (percent)
  maxFixturesToLock: number;       // default 8 — don't lock more than this
  branchDepth: number;             // default 3 — branch at first N decision points
}

interface FixtureLock {
  fixtureId: string;
  homeTeam: string;
  awayTeam: string;
  result: 'home' | 'draw' | 'away';
  resultLabel: string;             // e.g. "Newcastle win" or "Draw"
  individualPlausibility: number;  // bookmaker probability of this specific result
}

interface CandidatePath {
  id: string;
  locks: FixtureLock[];
  resultingOdds: number;           // target metric % after applying all locks
  baselineOdds: number;            // target metric % without any locks
  delta: number;                   // resultingOdds - baselineOdds
  compositePlausibility: number;   // product of all individual plausibilities
  crossesThreshold: boolean;       // resultingOdds >= targetThreshold
  locksInvolvingTarget: number;    // how many locks are the target team's own fixtures
  locksInvolvingRivals: number;    // how many are other teams' fixtures
}

interface PathSearchResult {
  config: PathSearchConfig;
  baselineOdds: number;
  optimalPath: CandidatePath;      // best possible outcome (greedy, all best results)
  candidatePaths: CandidatePath[]; // 4-6 diverse paths, ranked by plausibility
  sensitivityData: SensitivityResult[];  // top 15 fixtures by leverage
  searchStats: {
    totalSimulations: number;
    totalPaths: number;
    pathsFiltered: number;
    searchTimeMs: number;
  };
}

// ── Deep Analysis Output ──

interface DeepAnalysis {
  id: string;
  generatedAt: number;
  targetTeam: string;
  targetMetric: string;
  targetThreshold: number;

  // Section 1: State of Play
  stateOfPlay: {
    position: number;
    points: number;
    gapToTarget: number;           // points gap to the qualifying position
    gamesRemaining: number;
    baselineOdds: number;
    optimalPathOdds: number;
    optimalPathPlausibility: number;
    contextNarrative: string;      // 2-3 paragraph overview
  };

  // Section 2: Decisive Match
  decisiveMatch: {
    fixtureId: string;
    homeTeam: string;
    awayTeam: string;
    date: string;
    outcomeTable: {
      result: string;              // "Newcastle Win" / "Draw" / "Newcastle Lose"
      resultingOdds: number;
      delta: number;
    }[];
    risks: string[];               // 2-3 bullet points on why this is hard
    angles: {                      // 2-3 data-backed tactical advantages
      title: string;
      analysis: string;
    }[];
    whatToWatch: string[];         // 2-3 in-match indicators
  };

  // Section 3: Matches to Watch
  matchesToWatch: {
    fixtureId: string;
    homeTeam: string;
    awayTeam: string;
    whyItMatters: string;
    idealResult: string;
    whyItsPlausible: string;
    simulationImpact: string;
  }[];

  // Section 4: Bottom Line
  bottomLine: {
    summary: string;               // Pundit-style 2-3 paragraph conclusion
    keyScenario: string;           // The specific combination that crosses threshold
  };

  // Metadata
  sources: string[];               // URLs from web research
  searchBudgetUsed: number;        // web searches consumed
}
```

---

## Path Search Algorithm (lib/path-search.ts)

This is the computational core of V4. Pure TypeScript, no LLM calls.

### Algorithm: Greedy Expansion with Branching

```typescript
function pathSearch(config: PathSearchConfig): PathSearchResult {
  const { teams, fixtures, targetTeam, targetMetric, targetThreshold,
          maxFixturesToLock, branchDepth } = config;

  const startTime = Date.now();
  let totalSims = 0;

  // ── Step 1: Baseline ──
  const scheduledFixtures = fixtures.filter(f => f.status === 'SCHEDULED');
  const baselineResults = simulate(teams, fixtures, 10000);
  totalSims += 10000;
  const baselineOdds = baselineResults.find(r => r.team === targetTeam)![targetMetric] as number;

  // ── Step 2: Sensitivity scan ──
  // For each fixture, lock to each outcome, run 1K sims, measure delta
  const sensitivity: SensitivityResult[] = [];
  for (const fixture of scheduledFixtures) {
    const deltas: Record<string, number> = {};
    for (const result of ['home', 'draw', 'away'] as const) {
      const locked = lockFixture(fixtures, fixture.id, result);
      const simResult = simulate(teams, locked, 1000);
      totalSims += 1000;
      const odds = simResult.find(r => r.team === targetTeam)![targetMetric] as number;
      deltas[result] = odds - baselineOdds;
    }
    sensitivity.push({
      fixtureId: fixture.id,
      homeTeam: fixture.homeTeam,
      awayTeam: fixture.awayTeam,
      deltaIfHomeWin: deltas.home,
      deltaIfDraw: deltas.draw,
      deltaIfAwayWin: deltas.away,
      maxAbsDelta: Math.max(
        Math.abs(deltas.home), Math.abs(deltas.draw), Math.abs(deltas.away)
      ),
    });
  }
  sensitivity.sort((a, b) => b.maxAbsDelta - a.maxAbsDelta);
  const topFixtures = sensitivity.slice(0, 15);

  // ── Step 3: Greedy optimal path ──
  // Lock the best result at the highest-leverage fixture, re-scan, repeat
  function buildGreedyPath(
    startingLocks: FixtureLock[],
    excludeFixtures: Set<string>,
    maxLocks: number
  ): CandidatePath {
    const locks: FixtureLock[] = [...startingLocks];
    let currentFixtures = applyLocks(fixtures, locks);

    for (let step = locks.length; step < maxLocks; step++) {
      // Find the best unlocked fixture + result
      let bestFixtureId = '';
      let bestResult: 'home' | 'draw' | 'away' = 'home';
      let bestOdds = -1;

      for (const sf of topFixtures) {
        if (locks.some(l => l.fixtureId === sf.fixtureId)) continue;
        if (excludeFixtures.has(sf.fixtureId)) continue;

        for (const result of ['home', 'draw', 'away'] as const) {
          const testLocks = [...locks, makeFixtureLock(sf, result, fixtures)];
          const testFixtures = applyLocks(fixtures, testLocks);
          const simResult = simulate(teams, testFixtures, 1000);
          totalSims += 1000;
          const odds = simResult.find(r => r.team === targetTeam)![targetMetric] as number;

          if (odds > bestOdds) {
            bestOdds = odds;
            bestFixtureId = sf.fixtureId;
            bestResult = result;
          }
        }
      }

      if (!bestFixtureId) break;  // No more fixtures to lock

      locks.push(makeFixtureLock(
        topFixtures.find(f => f.fixtureId === bestFixtureId)!,
        bestResult,
        fixtures
      ));
      currentFixtures = applyLocks(fixtures, locks);

      // Early exit if we've crossed the threshold
      if (bestOdds >= targetThreshold && step >= 2) break;
    }

    // Final validation with full 10K sims
    const finalFixtures = applyLocks(fixtures, locks);
    const finalResult = simulate(teams, finalFixtures, 10000);
    totalSims += 10000;
    const finalOdds = finalResult.find(r => r.team === targetTeam)![targetMetric] as number;

    return buildCandidatePath(locks, finalOdds, baselineOdds, targetThreshold);
  }

  const optimalPath = buildGreedyPath([], new Set(), maxFixturesToLock);

  // ── Step 4: Branch at decision points ──
  // At the first N fixtures in the optimal path, try the SECOND-best result instead
  const candidatePaths: CandidatePath[] = [optimalPath];

  for (let i = 0; i < Math.min(branchDepth, optimalPath.locks.length); i++) {
    const lock = optimalPath.locks[i];
    const otherResults = (['home', 'draw', 'away'] as const)
      .filter(r => r !== lock.result);

    for (const altResult of otherResults) {
      // Build a path that starts with the same locks up to position i,
      // but substitutes a different result at position i
      const altStartingLocks = [
        ...optimalPath.locks.slice(0, i),
        makeFixtureLock(
          topFixtures.find(f => f.fixtureId === lock.fixtureId)!,
          altResult,
          fixtures
        ),
      ];

      const altPath = buildGreedyPath(
        altStartingLocks,
        new Set(),  // Don't exclude anything — let greedy pick freely
        maxFixturesToLock
      );

      candidatePaths.push(altPath);
    }
  }

  // ── Step 5: Plausibility filter ──
  // Remove paths with composite plausibility < 0.5%
  const plausiblePaths = candidatePaths
    .filter(p => p.compositePlausibility >= 0.005)
    .sort((a, b) => b.compositePlausibility - a.compositePlausibility);

  // Deduplicate: remove paths that are >80% similar in their lock sets
  const diversePaths = deduplicatePaths(plausiblePaths);

  // Take top 4-6
  const finalPaths = diversePaths.slice(0, 6);

  return {
    config,
    baselineOdds,
    optimalPath,
    candidatePaths: finalPaths,
    sensitivityData: topFixtures,
    searchStats: {
      totalSimulations: totalSims,
      totalPaths: candidatePaths.length,
      pathsFiltered: candidatePaths.length - finalPaths.length,
      searchTimeMs: Date.now() - startTime,
    },
  };
}

// ── Helper functions ──

function makeFixtureLock(
  sensitivity: SensitivityResult,
  result: 'home' | 'draw' | 'away',
  fixtures: Fixture[]
): FixtureLock {
  const fixture = fixtures.find(f => f.id === sensitivity.fixtureId)!;
  const resultLabel = result === 'home'
    ? `${sensitivity.homeTeam} win`
    : result === 'away'
      ? `${sensitivity.awayTeam} win`
      : 'Draw';

  const individualPlausibility = result === 'home'
    ? (fixture.homeWinProb ?? 0.33)
    : result === 'away'
      ? (fixture.awayWinProb ?? 0.33)
      : (fixture.drawProb ?? 0.33);

  return {
    fixtureId: sensitivity.fixtureId,
    homeTeam: sensitivity.homeTeam,
    awayTeam: sensitivity.awayTeam,
    result,
    resultLabel,
    individualPlausibility,
  };
}

function buildCandidatePath(
  locks: FixtureLock[],
  resultingOdds: number,
  baselineOdds: number,
  targetThreshold: number
): CandidatePath {
  const compositePlausibility = locks.reduce(
    (product, lock) => product * lock.individualPlausibility, 1
  );

  return {
    id: crypto.randomUUID(),
    locks,
    resultingOdds,
    baselineOdds,
    delta: resultingOdds - baselineOdds,
    compositePlausibility,
    crossesThreshold: resultingOdds >= targetThreshold,
    locksInvolvingTarget: locks.filter(
      l => l.homeTeam === 'NEW' || l.awayTeam === 'NEW'  // generalise via config
    ).length,
    locksInvolvingRivals: locks.filter(
      l => l.homeTeam !== 'NEW' && l.awayTeam !== 'NEW'
    ).length,
  };
}

function applyLocks(fixtures: Fixture[], locks: FixtureLock[]): Fixture[] {
  return fixtures.map(f => {
    const lock = locks.find(l => l.fixtureId === f.id);
    if (!lock) return f;
    return {
      ...f,
      homeWinProb: lock.result === 'home' ? 1.0 : 0.0,
      drawProb: lock.result === 'draw' ? 1.0 : 0.0,
      awayWinProb: lock.result === 'away' ? 1.0 : 0.0,
    };
  });
}

function deduplicatePaths(paths: CandidatePath[]): CandidatePath[] {
  const kept: CandidatePath[] = [];
  for (const path of paths) {
    const isDuplicate = kept.some(existing => {
      const existingLockSet = new Set(existing.locks.map(l => `${l.fixtureId}:${l.result}`));
      const overlap = path.locks.filter(l => existingLockSet.has(`${l.fixtureId}:${l.result}`));
      return overlap.length / Math.max(path.locks.length, existing.locks.length) > 0.8;
    });
    if (!isDuplicate) kept.push(path);
  }
  return kept;
}
```

### Performance Budget

The greedy search with branching runs approximately:
- Baseline: 10K sims
- Sensitivity scan: ~80 fixtures × 3 results × 1K sims = 240K sims
- Greedy path (8 steps, testing ~15 fixtures × 3 results each): ~360K sims
- Branching (3 branch points × 2 alt results × 8-step paths): ~720K sims per branch ≈ ~4.3M sims
- Validation: ~6 paths × 10K sims = 60K sims
- **Total: ~5M simulations**

Each simulation is ~400 arithmetic operations. 5M × 400 = 2 billion operations. In Node.js, this runs in approximately **2-4 seconds**. Well within the acceptable range for a feature that only triggers on explicit user request.

---

## Server-Side Simulation (lib/server-simulation.ts)

A direct copy of `lib/montecarlo.ts` adapted for server-side use. The engine is pure TypeScript with no browser APIs, so it runs identically in Node.js.

```typescript
// Copy lib/montecarlo.ts to lib/server-simulation.ts
// The only changes:
// 1. No 'use client' directive
// 2. Export as a module usable from API routes
// 3. Add a faster variant for the path search (fewer sims, simplified GD)

// For the path search's inner loops, use a FAST variant:
// - 1000 sims instead of 10000
// - Simplified GD (±1 per result, no Poisson) — sufficient for ranking
// - ~10x faster per call

export function simulateFast(
  teams: Team[],
  fixtures: Fixture[],
  numSims: number
): SimulationResult[] {
  // Same structure as simulate() but with simplified goal difference
  // ±1 per result instead of Poisson sampling
  // Used for sensitivity scanning and greedy path exploration
  // where we need speed over GD precision
}

export function simulateFull(
  teams: Team[],
  fixtures: Fixture[],
  numSims: number
): SimulationResult[] {
  // Exact copy of client-side simulate()
  // Used for final path validation (10K sims with Poisson GD)
}
```

---

## Deep Analysis API (app/api/deep-analysis/route.ts)

This endpoint orchestrates the full V4 pipeline.

```typescript
// POST /api/deep-analysis
// Body: {
//   targetTeam: string,
//   targetMetric: string,      // e.g. "top7Pct"
//   targetThreshold: number,   // e.g. 50
//   teams: Team[],
//   fixtures: Fixture[],
// }
//
// Response: streaming (progress updates + final DeepAnalysis)

async function POST(request: Request) {
  const body = await request.json();

  // ── Phase 1: Parse + validate ──
  const config: PathSearchConfig = {
    teams: body.teams,
    fixtures: body.fixtures,
    targetTeam: body.targetTeam,
    targetMetric: body.targetMetric,
    targetThreshold: body.targetThreshold,
    maxFixturesToLock: 8,
    branchDepth: 3,
  };

  // ── Phase 2: Path search (computational, ~2-4 seconds) ──
  // Stream a progress update to the client
  const pathResult = pathSearch(config);

  // ── Phase 3: Research + narrate (LLM + web search, ~20-30 seconds) ──
  const analysis = await narrateAnalysis(pathResult, config);

  // ── Return ──
  return NextResponse.json(analysis);
}
```

### Narrative Agent (Phase 3)

The narrative agent receives the path search results and composes the Deep Analysis document. It uses the same tool-use loop as V3B but with a different system prompt.

```typescript
async function narrateAnalysis(
  pathResult: PathSearchResult,
  config: PathSearchConfig
): Promise<DeepAnalysis> {

  // Identify the decisive match (highest single-fixture leverage)
  const decisiveFixture = pathResult.sensitivityData[0];

  // Identify matches to watch (non-target-team fixtures in top paths)
  const rivalFixtures = identifyRivalFixtures(pathResult);

  // Build the agent context with path search data
  const context = buildAnalysisContext(pathResult, config);

  // Call the agent with the analysis system prompt
  // Budget: 15-30 web searches
  // The agent researches:
  //   1. Decisive match: both teams' form, injuries, tactical angles
  //   2. Rival fixtures: why specific results are plausible
  //   3. General context: target team's season narrative
  const agentResponse = await callAnalysisAgent(context);

  // Parse the structured output into a DeepAnalysis object
  return parseDeepAnalysis(agentResponse, pathResult);
}
```

---

## Deep Analysis Agent System Prompt

```typescript
function buildAnalysisSystemPrompt(pathResult: PathSearchResult, config: PathSearchConfig): string {
  return `You are Keepwatch's Deep Analysis agent. You produce a comprehensive analysis document explaining what needs to happen for a team to achieve their season objective.

## YOUR ROLE
You have been given the results of a computational path search — the system has already identified which fixture results would push ${config.targetTeam}'s ${config.targetMetric} above ${config.targetThreshold}%. Your job is to research and narrate these findings into an analysis that reads like a Monday Night Football segment.

## CRITICAL: VERIFY EVERYTHING VIA WEB SEARCH
Your training data about football is UNRELIABLE. You MUST search before making any claims about current squads, form, injuries, tactics, or circumstances. You have a budget of up to 30 web searches. Use them.

## TONE
Write like a well-prepared football analyst: specific, data-informed, occasionally surprising. Follow these rules:
- Identify "angles of attack" (set-piece mismatches, transition vulnerabilities, fatigue patterns) — do NOT prescribe formations or starting XIs
- Reference tactical concepts by name when publicly discussed (e.g. "Arsenal's 3+2 rest defence")
- If a well-read fan on a podcast could say it with confidence, it's in bounds
- If it would sound presumptuous from anyone other than an actual coach, it's out of bounds

## PATH SEARCH RESULTS
Baseline ${config.targetMetric}: ${pathResult.baselineOdds.toFixed(1)}%

Optimal path (mathematical ceiling):
${formatOptimalPath(pathResult.optimalPath)}

Candidate paths (plausible scenarios):
${pathResult.candidatePaths.map(formatCandidatePath).join('\n\n')}

Top sensitivity fixtures:
${pathResult.sensitivityData.slice(0, 10).map(formatSensitivity).join('\n')}

## OUTPUT STRUCTURE
Produce a JSON document matching the DeepAnalysis interface. The four sections:

### Section 1: State of Play
- Current position, points, gap to target, games remaining
- Baseline simulation odds
- The optimal path (mathematical ceiling) with its probability
- 2-3 paragraph contextual narrative setting the scene

### Section 2: Decisive Match
The single fixture with the highest simulation leverage from the sensitivity data.
- Outcome impact table: win/draw/lose with exact simulation numbers
- 2-3 KEY RISKS: why this match is hard for ${config.targetTeam}. Lead with the fear.
- 2-3 ANGLES: data-backed reasons ${config.targetTeam} could get a result. Follow with the hope.
- 2-3 WHAT TO WATCH: in-match indicators (e.g. "if Newcastle win the set-piece battle in the first 30 minutes...")
Research BOTH teams thoroughly. Search for form, injuries, head-to-head, tactical tendencies.

### Section 3: Matches to Watch
2-3 non-${config.targetTeam} fixtures from the candidate paths where rival results matter.
For each: why it matters, what result is needed, one data-backed reason that result is plausible, simulation impact.
Keep this section lighter than Section 2 — awareness, not deep analysis.

### Section 4: Bottom Line
Pundit-style summary. 2-3 paragraphs. Name the SPECIFIC scenario combination that crosses the ${config.targetThreshold}% threshold. Make it concrete and memorable: "If Newcastle beat Palace, beat Arsenal, and Brentford-Everton draws, European qualification odds cross 50% for the first time this season."

## RESEARCH PRIORITIES
1. The decisive match teams: form, injuries, key players, tactical setup (8-10 searches)
2. Matches to watch teams: brief form/context check (4-6 searches)
3. Target team general context: manager situation, squad availability, morale (2-3 searches)
4. Any specific storylines mentioned in the paths (1-2 searches)

## OUTPUT FORMAT
Return a JSON object matching the DeepAnalysis interface. Wrap in \`\`\`json blocks.
`;
}
```

---

## Deep Analysis UI

### Full-Page View (app/components/DeepAnalysis.tsx)

When a Deep Analysis is generated, the dashboard transitions to a full-page reading view. The chat sidebar remains for follow-up questions.

```
┌────────────────────────────────────────────┬──────────────────┐
│                                            │                  │
│  ◄ Back to Dashboard                       │  Follow-up chat  │
│                                            │                  │
│  ══════════════════════════════════════     │  "Ask about      │
│  KEEPWATCH DEEP ANALYSIS                   │   this analysis" │
│  Newcastle United → European Qualification │                  │
│  Generated 23 March 2026                   │  ──────────────  │
│  ══════════════════════════════════════     │                  │
│                                            │  💬 Why is the   │
│  ┌─────────┬─────────┬─────────┬────────┐  │  Arsenal match   │
│  │ 12th    │ 4pts    │ 7 left  │ 19%   │  │  so decisive?    │
│  │Position │Gap to 7 │Remaining│Baseline│  │                  │
│  └─────────┴─────────┴─────────┴────────┘  │  🤖 Because of   │
│                                            │  the double-swing │
│  [State of Play narrative...]              │  effect...        │
│                                            │                  │
│  ──── THE DECISIVE MATCH ─────             │                  │
│  Arsenal vs Newcastle                      │                  │
│  [Outcome table]                           │                  │
│  [Risks → Angles → What to Watch]          │                  │
│                                            │                  │
│  ──── MATCHES TO WATCH ───────             │                  │
│  1. Brentford vs Everton                   │                  │
│  2. Chelsea vs Man City                    │                  │
│                                            │                  │
│  ──── THE BOTTOM LINE ────────             │                  │
│  [Summary + key scenario]                  │                  │
│                                            │  ──────────────  │
│  [Methodology footer]                      │  [input] [Send]  │
└────────────────────────────────────────────┴──────────────────┘
```

### Design Details

**Typography:** The Deep Analysis uses a more editorial layout than the dashboard. Larger body text (16px), generous line height (1.8), wider margins. It's meant to be read, not scanned.

**Stat cards:** The four key numbers (Position, Gap, Remaining, Baseline Odds) appear as a horizontal row of cards at the top of Section 1, styled consistently with the dashboard's qualification cards.

**Outcome table:** The decisive match section includes a 3-row table (Win/Draw/Lose) with the resulting odds and delta. Colour-coded: green for improved, red for worsened.

**Section dividers:** Use the Oswald font for section headings, consistent with the dashboard. Subtle horizontal rules between sections.

**Follow-up chat:** The sidebar switches to a "follow-up" mode. The analysis document serves as context — the user can ask "Why is Arsenal away so important?" and the agent answers referencing the analysis data.

### Trigger Mechanism

In the chat sidebar, alongside Fast/Deep mode, add an "Analysis" mode or a dedicated button:

```
┌────────────────────────────┐
│  [🔍 Deep Analysis]        │
│  "What needs to happen     │
│   for [Team] to [Goal]?"   │
└────────────────────────────┘
```

When clicked, it either pre-fills the chat with a query based on the team's context (e.g., "What needs to happen for Newcastle to qualify for Europe?") or opens a small configuration panel:

```
┌────────────────────────────┐
│  Target: [Top 7 ▼]         │
│  Threshold: [50% ━━━━●━]   │
│  [Generate Analysis]        │
└────────────────────────────┘
```

The target dropdown shows context-appropriate options (same as V2's card selection logic). The threshold slider defaults to 50% but can be adjusted.

---

## Build Order (V4)

### Step 1: Server-Side Simulation
- Copy `lib/montecarlo.ts` to `lib/server-simulation.ts`
- Remove any client-side directives
- Add `simulateFast()` variant (simplified GD, for inner-loop speed)
- Keep `simulateFull()` as the exact copy (for final validation)
- **Test:** Import from an API route, run 10K sims, verify results match client-side engine within statistical noise.

### Step 2: Path Search Algorithm
- Create `lib/path-search.ts` with the greedy-expansion-with-branching algorithm
- Create `lib/plausibility.ts` with composite scoring and deduplication
- Use `simulateFast` for inner-loop exploration, `simulateFull` for final validation
- **Test:** Run with current data. Verify:
  - Optimal path involves Newcastle winning most remaining games + rival results
  - Plausibility filter kills absurd scenarios (e.g. Wolves winning 5 in a row)
  - 4-6 diverse candidate paths emerge
  - Total runtime < 5 seconds

### Step 3: Deep Analysis API Endpoint
- Create `app/api/deep-analysis/route.ts`
- Wire up: receive request → run path search → return PathSearchResult
- For now, return just the computational results (no LLM narration yet)
- **Test:** POST to the endpoint, verify path search results are well-formed.

### Step 4: Deep Analysis UI Shell
- Create `DeepAnalysis.tsx` and section subcomponents
- Create `DeepAnalysisTrigger.tsx` (the button/config panel in the sidebar)
- Render the four sections with mock/placeholder content
- Wire the trigger to call the API and display results
- **Test:** Click trigger, see analysis view load with path search data displayed (raw, not narrated).

### Step 5: Narrative Agent
- Build the analysis system prompt
- Implement `narrateAnalysis()` using V3B's existing tool-use loop
- Budget: 15-30 web searches per analysis
- Parse the agent's structured output into a `DeepAnalysis` object
- **Test:** Generate a full analysis. Verify all four sections are populated with web-grounded content. Check that tactical claims reference real, current information.

### Step 6: Wire End-to-End
- Connect: trigger → API → path search → agent narration → render
- Add loading states (Phase 2: "Searching scenario space..." → Phase 3: "Researching and writing analysis...")
- Handle errors (search timeout, agent failure, no paths found)
- **Test:** Full flow from button click to rendered analysis. Time the end-to-end: target < 45 seconds.

### Step 7: Follow-Up Chat
- When Deep Analysis is displayed, switch the sidebar to follow-up mode
- Include the analysis data in the chat context so the agent can reference it
- User can ask drill-down questions ("Tell me more about Arsenal's set-piece vulnerability")
- Follow-up questions use V3B's deep mode agent with analysis context injected
- **Test:** Generate analysis, ask follow-up question, verify response references analysis content.

### Step 8: Polish
- Loading animations for the two-phase pipeline
- Smooth transition between dashboard and analysis view
- "Back to Dashboard" button that preserves analysis (can return to it)
- Print/share styling for the analysis view
- Mobile responsiveness for the editorial layout
- Edge case: what if no path crosses the threshold? ("Based on current probabilities, Newcastle would need to win all remaining games AND multiple rivals to drop points. The mathematical ceiling is X%, which is below your 50% threshold. Here's what the best realistic scenario looks like instead...")
- **Test:** Full end-to-end across multiple teams and target metrics.

---

## Cost Budget (V4)

Per Deep Analysis generation:
- Path search computation: free (runs server-side, ~2-4 seconds of Node.js CPU)
- LLM narration: ~$0.10-0.30 per analysis (depends on model + response length)
- Web searches: 15-30 Tavily calls (~$0.01 each at scale, free tier covers ~30-60 analyses/month)
- **Total per analysis: ~$0.15-0.50**

At casual usage (a few analyses per week), the free tiers of all APIs are sufficient.

---

## Connection to Innovera Demo

For the Pedram demo, V4 is the showcase feature. The flow is:

1. Open Keepwatch, select Newcastle
2. Dashboard shows current odds (~19% for Europe)
3. Click "Deep Analysis" → "What needs to happen?"
4. System searches the scenario space (2 seconds, visible progress)
5. Agent researches and narrates (20-30 seconds, search indicators visible)
6. Full analysis appears: State of Play → Decisive Match → Matches to Watch → Bottom Line
7. Ask a follow-up: "What if we remove the Arsenal constraint?"

The parallel to Innovera writes itself: replace "Newcastle qualifies for Europe" with "portfolio maintains 8% return." Replace "Arsenal away" with "Fed rate decision." Replace "Brentford vs Everton" with "EUR/USD movement." The computational search, plausibility filtering, narrative enrichment, and interactive follow-up are domain-agnostic.
