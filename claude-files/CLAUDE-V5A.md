# CLAUDE-V5A.md — What-If Critical Fixes: Full-Season Simulation, Temporal Grounding, Squad Verification

## Context

The What-If feature (V5) is producing impressive narrative output, but has three critical bugs that undermine the analysis. This document specifies exact fixes for each.

**Bug 1: Simulation only covers remaining games (7 of 38).** The Monte Carlo engine starts from current standings and simulates forward. This means 31 games of already-banked points are locked. For teams far from their target (e.g. West Ham at 18th targeting Top 7), no modification to 7 remaining games can bridge the gap. The entire point of "What If" is to ask "what if the season had been constructed differently?" — that requires resimulating all 380 fixtures from scratch.

**Bug 2: Season confusion.** The agent confuses 2024-25 and 2025-26 data. It references "7th-place Nottingham Forest" (that was 2024-25; Forest are near relegation in 2025-26). Web searches return mixed-season results and the agent cannot reliably distinguish them.

**Bug 3: Squad hallucinations.** The agent references players who no longer play for the club. It said Kudus is at West Ham when he transferred to Spurs at the end of 2024-25. The FIFA dataset has current club assignments, but the agent doesn't cross-reference these before generating scenarios.

All three bugs are interconnected: the simulation scope is wrong, the temporal context is weak, and the squad data isn't being used as a guardrail.

---

## Fix 1: Full-Season Simulation Mode

### The Problem

The current `runSimulationTool` calls `simulateFull()` which does this:

```typescript
// Current behaviour (lib/montecarlo.ts / lib/server-simulation.ts):
// 1. Start with current standings (points, GD, GF for all 20 teams)
// 2. Filter to SCHEDULED fixtures only
// 3. Simulate only those remaining fixtures
// 4. Add simulated points to current standings
// 5. Rank and return results
```

When West Ham have 29 points from 31 games, this is immovable. Modifying win probabilities only affects the 7 remaining games, producing negligible changes. Every scenario returns 0.0% because the damage from 31 games is baked in.

### The Fix

Create a new function `simulateFullSeason()` that ignores current standings entirely and simulates all 380 fixtures from Matchday 1, using Elo-derived base probabilities for every match. Probability modifications are applied across ALL 380 fixtures, not just the remaining ones.

### New File: `lib/what-if/full-season-sim.ts`

```typescript
import { Team, Fixture, SimulationResult } from '../types';
import { teamElo, eloProb } from '../elo';

// Poisson-distributed goal sampling (same as existing engine)
function sampleGoals(lambda: number): number {
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= Math.random();
  } while (p > L);
  return k - 1;
}

const GOAL_PARAMS = {
  homeWin: { home: 1.7, away: 0.6 },
  draw: { home: 1.1, away: 1.1 },
  awayWin: { home: 0.7, away: 1.5 },
};

interface TeamModification {
  teamAbbr: string;
  homeWinDelta: number;   // Applied to EVERY home match for this team
  awayWinDelta: number;   // Applied to EVERY away match for this team
  drawDelta: number;      // Applied to EVERY match involving this team
}

interface FullSeasonSimConfig {
  teams: Team[];
  fixtures: Fixture[];         // ALL 380 fixtures (completed + scheduled)
  modifications: TeamModification[];
  numSims: number;             // Default 10000
}

/**
 * Simulate a FULL 38-game season from scratch.
 *
 * KEY DIFFERENCE from the standard simulate():
 * - Ignores current standings entirely (all teams start at 0 points)
 * - Simulates ALL 380 fixtures, including those already completed
 * - Uses Elo-derived base probabilities for every fixture
 * - Applies team-level modifications across ALL fixtures
 *
 * This answers the question: "If we replayed the entire season with
 * these structural changes, what would the final table look like?"
 *
 * Base probabilities come from Elo ratings. We do NOT use bookmaker
 * odds here because:
 * 1. Bookmaker odds only exist for upcoming fixtures
 * 2. We need consistent probabilities across all 380 matches
 * 3. Elo captures relative team strength, which is what we're modifying
 *
 * The Elo ratings themselves come from the CURRENT season's points-per-game,
 * which means they reflect how teams have actually performed this season.
 * When we apply modifications (e.g. "West Ham with a better squad"),
 * we're asking: "What if this team had been X% stronger all season?"
 */
export function simulateFullSeason(config: FullSeasonSimConfig): SimulationResult[] {
  const { teams, fixtures, modifications, numSims } = config;

  const teamIndex: Record<string, number> = {};
  teams.forEach((t, i) => { teamIndex[t.abbr] = i; });

  // Pre-compute Elo for each team (based on current season PPG)
  const eloRatings: Record<string, number> = {};
  for (const team of teams) {
    eloRatings[team.abbr] = teamElo(team);
  }

  // Pre-compute modification lookup
  const modMap: Record<string, TeamModification> = {};
  for (const mod of modifications) {
    modMap[mod.teamAbbr] = mod;
  }

  // Pre-compute base probabilities for ALL 380 fixtures
  // These are Elo-derived, with modifications applied
  const allFixtures = fixtures.filter(f =>
    // Include ALL fixtures: completed AND scheduled
    teamIndex[f.homeTeam] !== undefined && teamIndex[f.awayTeam] !== undefined
  );

  interface PrecomputedFixture {
    homeIdx: number;
    awayIdx: number;
    homeWinProb: number;
    drawProb: number;
    awayWinProb: number;
  }

  const precomputed: PrecomputedFixture[] = allFixtures.map(f => {
    const homeElo = eloRatings[f.homeTeam] ?? 1500;
    const awayElo = eloRatings[f.awayTeam] ?? 1500;
    const base = eloProb(homeElo, awayElo);

    // Apply modifications
    const homeMod = modMap[f.homeTeam];
    const awayMod = modMap[f.awayTeam];

    let hProb = base.homeWin;
    let dProb = base.draw;
    let aProb = base.awayWin;

    // Home team modifications (when playing at home)
    if (homeMod) {
      hProb += homeMod.homeWinDelta;
      dProb += homeMod.drawDelta;
      // Redistribute: what's added to homeWin comes from draw + awayWin
    }

    // Away team modifications (when playing away)
    if (awayMod) {
      aProb += awayMod.awayWinDelta;
      dProb += awayMod.drawDelta;
    }

    // Clamp and normalise
    hProb = Math.max(0.02, Math.min(0.95, hProb));
    dProb = Math.max(0.02, Math.min(0.50, dProb));
    aProb = Math.max(0.02, Math.min(0.95, aProb));
    const total = hProb + dProb + aProb;

    return {
      homeIdx: teamIndex[f.homeTeam],
      awayIdx: teamIndex[f.awayTeam],
      homeWinProb: hProb / total,
      drawProb: dProb / total,
      awayWinProb: aProb / total,
    };
  });

  const n = teams.length;
  const positionCounts = new Array(n).fill(null).map(() => new Array(n).fill(0));
  const totalPoints = new Array(n).fill(0);
  const totalPositions = new Array(n).fill(0);

  for (let sim = 0; sim < numSims; sim++) {
    // Start from ZERO — no banked points
    const points = new Array(n).fill(0);
    const gd = new Array(n).fill(0);
    const gf = new Array(n).fill(0);

    for (const pf of precomputed) {
      const rand = Math.random();
      let homeGoals: number;
      let awayGoals: number;

      if (rand < pf.homeWinProb) {
        homeGoals = sampleGoals(GOAL_PARAMS.homeWin.home);
        awayGoals = sampleGoals(GOAL_PARAMS.homeWin.away);
        if (homeGoals <= awayGoals) homeGoals = awayGoals + 1;
        points[pf.homeIdx] += 3;
      } else if (rand < pf.homeWinProb + pf.drawProb) {
        homeGoals = sampleGoals(GOAL_PARAMS.draw.home);
        awayGoals = homeGoals;
        points[pf.homeIdx] += 1;
        points[pf.awayIdx] += 1;
      } else {
        homeGoals = sampleGoals(GOAL_PARAMS.awayWin.home);
        awayGoals = sampleGoals(GOAL_PARAMS.awayWin.away);
        if (awayGoals <= homeGoals) awayGoals = homeGoals + 1;
        points[pf.awayIdx] += 3;
      }

      gd[pf.homeIdx] += homeGoals - awayGoals;
      gd[pf.awayIdx] += awayGoals - homeGoals;
      gf[pf.homeIdx] += homeGoals;
      gf[pf.awayIdx] += awayGoals;
    }

    // Sort by points → GD → GF (EPL tiebreakers)
    const indices = teams.map((_, i) => i);
    indices.sort((a, b) => {
      if (points[b] !== points[a]) return points[b] - points[a];
      if (gd[b] !== gd[a]) return gd[b] - gd[a];
      return gf[b] - gf[a];
    });

    indices.forEach((teamIdx, position) => {
      positionCounts[teamIdx][position]++;
      totalPoints[teamIdx] += points[teamIdx];
      totalPositions[teamIdx] += position + 1;
    });
  }

  return teams.map((team, i) => ({
    team: team.abbr,
    positionDistribution: positionCounts[i],
    top4Pct: positionCounts[i].slice(0, 4).reduce((a, b) => a + b, 0) / numSims * 100,
    top5Pct: positionCounts[i].slice(0, 5).reduce((a, b) => a + b, 0) / numSims * 100,
    top6Pct: positionCounts[i].slice(0, 6).reduce((a, b) => a + b, 0) / numSims * 100,
    top7Pct: positionCounts[i].slice(0, 7).reduce((a, b) => a + b, 0) / numSims * 100,
    relegationPct: positionCounts[i].slice(-3).reduce((a, b) => a + b, 0) / numSims * 100,
    championPct: positionCounts[i][0] / numSims * 100,
    survivalPct: (1 - positionCounts[i].slice(-3).reduce((a, b) => a + b, 0) / numSims) * 100,
    avgPoints: totalPoints[i] / numSims,
    avgPosition: totalPositions[i] / numSims,
  }));
}
```

### Updating the `runSimulationTool`

The `run_simulation` tool in `app/api/what-if/route.ts` must be changed to call `simulateFullSeason()` instead of `simulateFull()`.

**Current behaviour** (in `createToolExecutors`):
```typescript
// WRONG: Only modifies remaining fixtures
case 'run_simulation': {
  const modifiedFixtures = applyModifications(fixtures, args.modifications);
  const results = simulateFull(teams, modifiedFixtures, args.simCount ?? 10000);
  // ...
}
```

**Replace with:**
```typescript
case 'run_simulation': {
  const results = simulateFullSeason({
    teams,
    fixtures,         // Pass ALL fixtures — the function handles them internally
    modifications: args.modifications,
    numSims: args.simCount ?? 10000,
  });

  const targetResult = results.find(r => r.team === targetTeam);
  const baselineResults = simulateFullSeason({
    teams,
    fixtures,
    modifications: [],  // No modifications = baseline
    numSims: 10000,
  });
  const baselineResult = baselineResults.find(r => r.team === targetTeam);

  return {
    targetMetricPct: targetResult?.[targetMetric] ?? 0,
    baselinePct: baselineResult?.[targetMetric] ?? 0,
    delta: (targetResult?.[targetMetric] ?? 0) - (baselineResult?.[targetMetric] ?? 0),
    expectedPoints: targetResult?.avgPoints ?? 0,
    expectedPosition: targetResult?.avgPosition ?? 0,
    baselineExpectedPoints: baselineResult?.avgPoints ?? 0,
    baselineExpectedPosition: baselineResult?.avgPosition ?? 0,
  };
}
```

### Important: Cache the baseline

The baseline (no modifications) should be computed ONCE at the start of the What-If pipeline, not re-computed on every tool call. Store it and pass it through:

```typescript
// At the start of the 'hypothesise' action, compute once:
const baselineFullSeason = simulateFullSeason({
  teams,
  fixtures,
  modifications: [],
  numSims: 10000,
});
const baselineTargetResult = baselineFullSeason.find(r => r.team === targetTeam);
const baselineOdds = baselineTargetResult?.[targetMetric] ?? 0;
const baselineExpectedPoints = baselineTargetResult?.avgPoints ?? 0;
```

This baseline tells the agent: "Without any modifications, if we simulate the whole season 10,000 times using Elo, West Ham finish with X expected points and Y% chance of Top 7." This will NOT be 0% — it will be a meaningful number that reflects their underlying squad strength, which is exactly what we want. The agent can then see how modifications move the needle.

### Why This Works

With the current system (remaining-games-only), West Ham's 29 banked points from 31 games are immovable. The maximum they can reach is 50 points (29 + 21), and 7th place typically requires 55-65 points.

With full-season simulation, the engine asks: "Given West Ham's Elo rating (derived from their current season PPG), what's the probability distribution of their final points total if we simulated the entire season?" If West Ham are a ~1.13 PPG team, their baseline expected total is ~43 points. But if we boost their probabilities by +0.10/+0.08 (representing a better squad), their expected total might rise to ~55 points — which starts to overlap with the European places. Now the scenarios produce meaningful, non-zero numbers that the agent can reason about.

### Validation Test

After implementing, run this sanity check:

```typescript
// Baseline full-season sim with no modifications:
const baseline = simulateFullSeason({ teams, fixtures, modifications: [], numSims: 10000 });

// Check: Arsenal (likely top of table) should finish 1st ~60-80% of sims
// Check: Teams with high PPG should have high avgPoints
// Check: Expected points should roughly correlate with actual current points
//        (teams aren't being randomly reshuffled)
// Check: West Ham's baseline top7Pct should NOT be 0% — it should be
//        something like 2-10% reflecting their underlying quality
```

---

## Fix 2: Temporal Grounding (Season Confusion)

### The Problem

The agent confuses 2024-25 and 2025-26 season data because:
1. Web searches return results from both seasons
2. The LLM's training data includes 2024-25 results but not 2025-26
3. The system prompt doesn't provide authoritative current-season data
4. There is no mechanism to reject stale information

The West Ham analysis referenced "7th-place Nottingham Forest" — that was 2024-25. In 2025-26, Forest are near relegation.

### The Fix: Inject Current Standings as Hard Truth

The system prompt for ALL What-If agent phases must include the full current league table as immutable ground truth. The agent must be instructed to treat this data as authoritative and to reject any web search results that contradict it.

### Changes to Agent Prompts

**Add this block to the TOP of every What-If system prompt (diagnosis, hypothesise, stress-test, and synthesise):**

```typescript
function buildTemporalContext(teams: Team[], fixtures: Fixture[]): string {
  const sortedTeams = [...teams].sort(
    (a, b) => b.points - a.points || b.goalDifference - a.goalDifference
  );

  const currentDate = new Date().toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric'
  });

  const maxPlayed = Math.max(...teams.map(t => t.played));

  const standingsTable = sortedTeams
    .map((t, i) => {
      const gd = t.goalDifference > 0 ? `+${t.goalDifference}` : `${t.goalDifference}`;
      return `${(i + 1).toString().padStart(2)}. ${t.name.padEnd(22)} ${t.played}  ${t.points}pts  GD ${gd}`;
    })
    .join('\n');

  // Calculate completed and remaining fixture counts
  const completed = fixtures.filter(f => f.status === 'FINISHED').length;
  const remaining = fixtures.filter(f => f.status === 'SCHEDULED').length;

  return `## CRITICAL: TEMPORAL CONTEXT — READ THIS FIRST

Today's date: ${currentDate}
Current season: 2025-26 Premier League
Gameweek: ~${maxPlayed} of 38
Fixtures completed: ${completed} of 380
Fixtures remaining: ${remaining}

### AUTHORITATIVE CURRENT STANDINGS (2025-26)
These standings are LIVE DATA from football-data.org. They are CORRECT.
If ANY web search result contradicts these standings, the web result is
STALE or refers to a DIFFERENT SEASON. Discard it.

\`\`\`
Pos  Team                   P   Pts   GD
${standingsTable}
\`\`\`

### SEASON DISAMBIGUATION RULES
1. The CURRENT season is 2025-26. We are in March 2026.
2. The PREVIOUS season was 2024-25. It ended in May 2025.
3. When you search, ALWAYS include "2025-26" in your query.
4. If a search result mentions league positions that don't match the
   table above, it is from a DIFFERENT SEASON. Ignore it.
5. Transfers that happened "last summer" means summer 2025 (between
   2024-25 and 2025-26 seasons).
6. Players who left a club "at the end of last season" means they left
   in May-August 2025 and are NOT at the club for 2025-26.

### COMMON TRAPS TO AVOID
- Nottingham Forest finished 7th in 2024-25. Check their CURRENT position
  in the table above before referencing them.
- Players who were at a club in 2024-25 may have transferred. ALWAYS
  verify with the FIFA dataset (compare_squads tool) or web search
  with "2025-26" in the query.
- Managers change between seasons. Search "[team] manager 2025-26" not
  just "[team] manager".`;
}
```

### Where to inject this

This function must be called and its output prepended to the system prompt in ALL four What-If phases:

1. **Diagnosis prompt** (`buildDiagnosisPrompt`) — prepend temporal context
2. **Hypothesise prompt** (`buildHypothesisePrompt`) — prepend temporal context
3. **Stress-test prompt** (`buildStressTestPrompt`) — prepend temporal context
4. **Synthesise prompt** (`buildSynthesisePrompt`) — prepend temporal context

```typescript
// In each prompt builder:
function buildDiagnosisPrompt(context: DiagnosisContext): { system: string; user: string } {
  const temporal = buildTemporalContext(context.teams, context.fixtures);
  const system = `${temporal}\n\n${/* rest of system prompt */}`;
  // ...
}
```

### Enforce season in web searches

The `web_search` tool executor should automatically append "2025-26" to queries that mention football teams but don't include a season:

```typescript
case 'web_search': {
  let query = args.query as string;

  // If the query mentions a PL team but no season, add "2025-26"
  const teamNames = teams.map(t => t.name.toLowerCase());
  const teamAbbrs = teams.map(t => t.abbr.toLowerCase());
  const mentionsTeam = teamNames.some(n => query.toLowerCase().includes(n)) ||
                       teamAbbrs.some(a => query.toLowerCase().includes(a));
  const hasSeason = /20\d\d[-\/]\d\d/.test(query) || /20\d\d/.test(query);

  if (mentionsTeam && !hasSeason) {
    query = `${query} 2025-26`;
  }

  const results = await executeWebSearch(query);
  return summariseSearchResults(results, query);
}
```

---

## Fix 3: Squad Verification (Hallucination Prevention)

### The Problem

The agent references players who no longer play for the club. The Kudus example is the clearest case: Kudus transferred to Spurs at the end of 2024-25, but the agent's Scenario 2 treats "keeping Kudus" as a counterfactual, its diagnosis lists Kudus as a current asset, and the narrative sections contradict themselves about whether he was sold during or after the season.

The FIFA dataset has current club assignments (2025-26 squads). This data is not being used as a guardrail.

### The Fix: Mandatory Squad Verification Step

Before the agent generates ANY scenarios, it must receive a verified squad list derived from the FIFA dataset. This list is injected into the system prompt as immutable truth, identical in authority to the league table.

### New Function: `buildSquadContext()`

```typescript
import { loadFIFAData } from './fifa-data';

interface SquadContextEntry {
  name: string;
  overall: number;
  age: number;
  positions: string;
}

/**
 * Build a verified squad list for a team using FIFA data.
 * This becomes part of the system prompt and is treated as ground truth.
 */
export async function buildSquadContext(
  teamName: string,
  teamAbbr: string
): Promise<string> {
  const players = await loadFIFAData();
  const squad = players
    .filter(p => normaliseClubName(p.club) === teamName)
    .sort((a, b) => b.overall - a.overall);

  if (squad.length === 0) {
    return `## SQUAD DATA: No FIFA data found for ${teamName}. Use web search to verify all player claims.`;
  }

  const startingXI = squad.slice(0, 11);
  const bench = squad.slice(11, 22);
  const avgOverall = (squad.reduce((s, p) => s + p.overall, 0) / squad.length).toFixed(1);
  const avgStarting = (startingXI.reduce((s, p) => s + p.overall, 0) / 11).toFixed(1);

  const formatPlayer = (p: PlayerQuality) =>
    `${p.name} (${p.overall} OVR, age ${p.age}, ${p.positions.join('/')})`;

  return `## VERIFIED SQUAD: ${teamName} (2025-26 season)
Source: FIFA/FC 26 dataset (reflects current season rosters)
Average overall: ${avgOverall} | Starting XI average: ${avgStarting}

### Current Squad (by overall rating)
STARTERS (top 11):
${startingXI.map((p, i) => `${i + 1}. ${formatPlayer(p)}`).join('\n')}

SQUAD PLAYERS (12-22):
${bench.map((p, i) => `${i + 12}. ${formatPlayer(p)}`).join('\n')}

### SQUAD VERIFICATION RULES
1. ONLY the players listed above are confirmed at ${teamName} for 2025-26.
2. If you want to reference a player NOT on this list, they are NOT at
   the club. They may have transferred. Check with web_search if needed.
3. "Keeping" a departed player is a VALID COUNTERFACTUAL — but you must
   label it correctly: "What if ${teamName} had kept [player] instead of
   selling them?" not "What if [player] is used differently?"
4. When generating squad upgrade scenarios, use the SPECIFIC overall
   ratings from this list. Don't estimate — use the actual numbers.
5. The weakest position group should be computed from these players,
   not assumed from general knowledge.`;
}
```

### Inject into all What-If prompts

The squad context must be included alongside the temporal context in every agent phase:

```typescript
function buildDiagnosisPrompt(context: DiagnosisContext): { system: string; user: string } {
  const temporal = buildTemporalContext(context.teams, context.fixtures);
  const squad = context.squadContext; // Pre-computed, passed in

  const system = `${temporal}\n\n${squad}\n\n${/* rest of system prompt */}`;
  // ...
}
```

### Pre-compute at pipeline start

In the What-If API route, compute the squad context ONCE at the start and pass it through all phases:

```typescript
// At the top of the What-If pipeline (before diagnosis):
const squadContext = await buildSquadContext(teamName, targetTeam);

// Pass to every prompt builder:
const diagnosisPrompt = buildDiagnosisPrompt({
  ...context,
  squadContext,  // <-- new field
});
```

### Notable players who LEFT

For the stress-test and synthesis phases, it's useful to also know who left. Add a function that compares the current FIFA squad to web search results about recent departures:

```typescript
/**
 * Generate a "departed players" context block.
 * This helps the agent frame counterfactuals correctly.
 *
 * Called once during pipeline setup. Uses a single web search
 * to find major departures.
 */
export async function buildDepartedPlayersContext(
  teamName: string
): Promise<string> {
  // This is populated by the diagnosis agent's web searches.
  // The instruction in the diagnosis prompt tells the agent to
  // identify departed players and include them in the diagnosis output.
  //
  // The returned string is injected into later phase prompts.
  //
  // Alternatively, this can be a single web search at pipeline start:
  // Search: "[teamName] transfers departures summer 2025 2025-26"
  return ''; // Populated dynamically by diagnosis phase
}
```

Add this instruction to the **diagnosis system prompt**:

```
## ADDITIONAL DIAGNOSIS TASK: DEPARTED PLAYERS
As part of your diagnosis, use web_search to identify any significant
players who LEFT ${teamName} between the 2024-25 and 2025-26 seasons.
For each departed player, note:
- Player name and position
- Where they went and for how much (if known)
- Their FIFA overall rating (use lookup_player if needed)
- Whether their departure left a gap in squad quality

Include this in your diagnosis output as a "departedPlayers" array:
[{ "name": "Mohammed Kudus", "to": "Tottenham", "fee": "£55m", "overall": 80, "position": "AM" }]

This is CRITICAL for helping later phases frame counterfactuals correctly.
If a scenario involves "keeping" a departed player, it must be explicitly
framed as a counterfactual about the transfer decision, not as if the
player is still at the club.
```

### Updated Diagnosis Output Type

```typescript
interface WhatIfDiagnosis {
  squadQualityRank: number;
  gapToTopSquad: number;
  keyBottlenecks: string[];
  narrativeSummary: string;
  // NEW:
  departedPlayers: {
    name: string;
    to: string;
    fee: string;
    overall: number;
    position: string;
  }[];
}
```

The `departedPlayers` array is then injected into the hypothesise and stress-test prompts:

```typescript
// In buildHypothesisePrompt:
const departedSection = diagnosis.departedPlayers?.length
  ? `## DEPARTED PLAYERS (left before 2025-26)
These players are NO LONGER at ${teamName}. You may propose "keeping"
them as a counterfactual, but frame it correctly.
${diagnosis.departedPlayers.map(p =>
  `- ${p.name} (${p.overall} OVR, ${p.position}) → ${p.to} for ${p.fee}`
).join('\n')}`
  : '';
```

---

## Fix 4: Updated Agent Prompts (Hypothesise Phase)

The hypothesise prompt needs significant updates to reflect the full-season simulation and temporal/squad grounding. Here is the updated version:

### Replace `buildHypothesisePrompt` with:

```typescript
function buildHypothesisePrompt(context: HypothesiseContext): { system: string; user: string } {
  const temporal = buildTemporalContext(context.teams, context.fixtures);
  const squad = context.squadContext;

  const departedSection = context.departedPlayers?.length
    ? `\n## DEPARTED PLAYERS (left before 2025-26 season)
These players are NO LONGER at ${context.teamName}. Referencing them
as current players is a CRITICAL ERROR. You may propose "What if we
had kept [player]?" as a counterfactual — label it correctly.
${context.departedPlayers.map(p =>
  `- ${p.name} (${p.overall} OVR, ${p.position}) → transferred to ${p.to} for ${p.fee}`
).join('\n')}\n`
    : '';

  const system = `${temporal}

${squad}
${departedSection}
You are Keepwatch's counterfactual analysis agent. You explore alternate
realities: "What if this team's season had been constructed differently?"

## CRITICAL: FULL-SEASON SIMULATION
The run_simulation tool simulates the ENTIRE 38-game season from scratch.
It does NOT start from current standings. It ignores the current league
table and replays all 380 fixtures using Elo-derived base probabilities,
with your modifications applied across EVERY match.

This means:
- When you apply a +0.10 homeWinDelta to ${context.teamName}, it boosts
  their home win probability in ALL 19 home matches, not just remaining ones.
- The simulation asks: "If ${context.teamName} had been this strong ALL
  SEASON, where would they finish?"
- A team currently at 29 points is NOT stuck at 29 points. The simulation
  re-rolls everything.
- Expected points from the simulation reflect FULL-SEASON projections.

When you call run_simulation, it returns:
- targetMetricPct: the probability of achieving the target
- expectedPoints: the FULL-SEASON expected points total
- baselinePct: what the team gets with no modifications
- baselineExpectedPoints: the baseline full-season expected points
- delta: the improvement from your modifications

## YOUR MISSION
${context.teamName} currently sits ${context.position}th with ${context.points}
points from ${38 - context.gamesRemaining} games in the ACTUAL 2025-26 season.

Their full-season baseline simulation (no modifications) gives them
${context.baselineExpectedPoints?.toFixed(1) ?? '??'} expected points and
${context.baselineOdds?.toFixed(1) ?? '??'}% chance of ${context.targetLabel}.

Your job: explore what structural changes — squad upgrades, tactical pivots,
competition prioritisation, injury prevention — could improve that number.

## DIAGNOSIS
${context.diagnosisNarrative}

Squad quality ranking: ${context.squadRank}th of 20
Gap to top squad: ${context.gapToTop} rating points
Key bottlenecks: ${context.bottlenecks.join(', ')}

## YOUR TOOLS
1. **compare_squads** — Compare squad quality numerically
2. **lookup_player** — Get FIFA ratings for specific players
3. **web_search** — Verify transfers, fees, availability (ALWAYS include "2025-26")
4. **run_simulation** — Run FULL-SEASON Monte Carlo (10K sims). USE THIS FOR EVERY SCENARIO.
5. **evaluate_plausibility** — Score each scenario's realism
6. **store_scenario** — Save scenarios worth including

## WORKFLOW
Explore AT LEAST 5 scenarios in this order:

### 1. Baseline Understanding
First, call run_simulation with NO modifications to understand the baseline.
Report: "${context.teamName}'s baseline expected points are X, with Y%
chance of ${context.targetLabel}." This is your reference point.

### 2. Perfect World
Apply maximum realistic boosts to ${context.teamName} (e.g. +0.15/+0.12)
AND maximum penalties to key rivals. This is the mathematical ceiling.

### 3-4. Targeted Upgrades
Using FIFA data and the squad list above, identify the weakest positions.
Find realistic upgrade targets. Translate to probability deltas and simulate.

### 5+. Creative Scenarios
Competition prioritisation, tactical changes, combinations. Always simulate.

## QUANTIFICATION (FULL-SEASON SCALE)
Because modifications now apply across ALL 38 games, the impact is larger:

| Change | Home Win Delta | Full-Season Impact |
|--------|---------------|-------------------|
| Minor upgrade (1-2 OVR) | +0.03 | ~2-4 extra points |
| Moderate upgrade (3-5 OVR) | +0.07 | ~5-8 extra points |
| Major upgrade (6+ OVR) | +0.12 | ~8-13 extra points |
| World-class addition | +0.15 | ~10-16 extra points |

## CRITICAL RULES
1. NEVER claim an impact without running run_simulation.
2. NEVER reference a player as being at ${context.teamName} unless they
   appear in the VERIFIED SQUAD section above.
3. ALL web searches must include "2025-26" when referencing teams.
4. Departed players can be "kept" as counterfactuals — label them correctly.
5. Be HARSH with plausibility scores. Fantasy scenarios get 0-5/100.`;

  const user = `Explore counterfactual scenarios for ${context.teamName} achieving
${context.targetLabel} in the 2025-26 Premier League season. Start by
running the baseline simulation, then work through at least 5 scenarios
of increasing ambition. Store each one.`;

  return { system, user };
}
```

---

## Fix 5: Updated Stress-Test and Synthesis Prompts

### Stress-Test Prompt Additions

Add to the stress-test system prompt:

```
## TEMPORAL REMINDER
All scenarios are about the 2025-26 season. When stress-testing:
- Check if proposed signings actually moved clubs in summer 2025
- Verify managers are correct for 2025-26 (not 2024-25)
- If a scenario says "keep [player]", verify that player actually LEFT
  the club — check the DEPARTED PLAYERS list.
- If a scenario references a rival's strength, verify against the
  CURRENT STANDINGS table, not general reputation.

## COMMON STRESS-TEST FAILURES
Flag any scenario that:
- References a player not in the VERIFIED SQUAD list as being at the club
- Assumes a rival is strong/weak based on LAST season's position
- Claims a player "was sold mid-season" when they actually left between seasons
- Assumes European competition participation that didn't happen in 2025-26
```

### Synthesis Prompt Additions

Add to the narrative synthesis system prompt:

```
## NARRATIVE RULES
1. When referencing league positions, use ONLY the positions from the
   AUTHORITATIVE CURRENT STANDINGS table. Never say "7th-place Forest"
   if the table shows Forest at 17th.
2. When referencing transfers, be precise about WHEN they happened.
   "Kudus was sold to Spurs in the summer of 2025" is correct.
   "Kudus was sold mid-season" is WRONG if it happened between seasons.
3. The full-season simulation numbers are hypothetical. Frame them as:
   "In our simulation of the full season with these modifications,
   ${teamName} averaged X points" — not "they would have got X points."
4. ALWAYS include the baseline simulation numbers as the reference point.
   The reader needs to understand: "Without changes, the simulation
   projected X points. With this modification, it projected Y points."
```

---

## Summary of Changes

| File | Change | Fixes |
|------|--------|-------|
| `lib/what-if/full-season-sim.ts` | NEW — full-season Monte Carlo engine | Bug 1 |
| `app/api/what-if/route.ts` | Use `simulateFullSeason()` in tool executor | Bug 1 |
| `app/api/what-if/route.ts` | Cache baseline full-season sim at pipeline start | Bug 1 |
| `app/api/what-if/prompts.ts` | Add `buildTemporalContext()` to all prompts | Bug 2 |
| `app/api/what-if/route.ts` | Auto-append "2025-26" to web search queries | Bug 2 |
| `app/api/what-if/prompts.ts` | Add `buildSquadContext()` to all prompts | Bug 3 |
| `app/api/what-if/prompts.ts` | Add departed players to diagnosis output | Bug 3 |
| `app/api/what-if/prompts.ts` | Rewrite hypothesise prompt for full-season framing | All 3 |
| `app/api/what-if/prompts.ts` | Update stress-test prompt with temporal checks | Bug 2, 3 |
| `app/api/what-if/prompts.ts` | Update synthesis prompt with narrative rules | Bug 2, 3 |
| `lib/what-if/types.ts` | Add `departedPlayers` to `WhatIfDiagnosis` | Bug 3 |

## Validation After Fixes

Run the West Ham → Top 7 analysis again. Verify:

1. **Baseline is non-zero.** The full-season sim should give West Ham ~5-15% Top 7 probability at baseline (reflecting their Elo, which is weak but not zero). This is the "starting point" the agent works from.

2. **Scenarios produce meaningful deltas.** A squad upgrade scenario should move West Ham from ~8% to ~20-30% Top 7. The "perfect world" should push to ~40-60%. These are numbers worth reasoning about.

3. **No season confusion.** The narrative should reference Forest at their CURRENT 2025-26 position, not their 2024-25 7th place finish.

4. **No squad hallucinations.** Kudus should be identified as a DEPARTED player. Scenarios involving him should be framed as "What if West Ham had kept Kudus?" not "What if Kudus performs better?"

5. **Expected points are full-season scale.** The simulation should report expected points in the 40-70 range (full season), not the 29-50 range (banked + remaining).
