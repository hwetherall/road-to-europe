# CLAUDE-ROUNDUP.md — Keepwatch: Weekly Roundup

## Overview

The Weekly Roundup is the companion to the Weekly Preview. The Preview looks forward; the Roundup looks back. Its job is to take the predictions, probability claims, and storylines from the Preview, hold them up against what actually happened, and tell the story of how the round reshaped the Premier League picture.

The tone is the same as the Preview — Sky Sports Monday Night Football: specific, data-informed, occasionally surprising, never prescriptive. But the Roundup has an additional quality the Preview lacks: **accountability**. The Preview makes claims. The Roundup grades them. Over time, this loop builds credibility with the reader because we're voluntarily showing our working.

### What the Roundup Delivers
- A six-section narrative document covering the completed matchday
- Before-and-after probability tables for the three races (title, Europe, relegation)
- A scorecard grading the Preview's predictions against actual results
- A deep dive on the target club's (Newcastle) match and its season impact
- A highlighted "Result That Changed Everything" with probability cascade analysis
- A rapid round covering every other fixture in 1-2 sentences each
- Goal scorers and key match facts extracted from quality source match reports

### What the Roundup Depends On
- Weekly Preview: stored in Supabase as markdown, queried by matchday number
- Simulation engine: pre-round and post-round Monte Carlo runs to compute probability deltas
- Football-data.org: match results and scores (free tier)
- Web search (Serper primary, Tavily fallback): post-match reports for goal scorers, quotes, tactical observations
- The full V1-V5 infrastructure (standings, fixtures, odds, team data)

---

## Pre-requisites (Build Before the Roundup)

### Pre-req 1: Pre-Round Simulation Snapshot

The Roundup needs before-and-after probability comparisons. This means we need to capture the simulation state BEFORE results come in.

**Solution:** When the Weekly Preview is generated, persist the full `leagueResults` array (the Monte Carlo output) alongside the Preview draft in Supabase. This is already computed during the Preview's dossier build — it just needs to be saved.

Add to the Preview's draft storage:

```typescript
// In the preview persistence step, add:
preRoundSimSnapshot: {
  leagueResults: dossier.leagueResults,       // full SimulationResult[] 
  generatedAt: dossier.generatedAt,
  matchday: dossier.matchday,
}
```

The Roundup then:
1. Loads the pre-round snapshot from the Preview
2. Fetches actual results from football-data.org
3. Updates standings with actual results
4. Runs a fresh Monte Carlo simulation on the updated table
5. Diffs the two to produce the probability movement data

**Important:** The pre-round snapshot must use the SAME simulation parameters (10,000 runs, same odds data) to make the comparison meaningful.

### Pre-req 2: Results Ingestion

The Roundup needs actual match results. Football-data.org's free tier provides scores but not goal scorers.

**For scores:** Add a `fetchMatchdayResults(matchday: number)` function that calls football-data.org and returns:

```typescript
interface MatchResult {
  fixtureId: string;
  homeTeam: string;
  awayTeam: string;
  homeGoals: number;
  awayGoals: number;
  status: 'FINISHED' | 'IN_PLAY' | 'SCHEDULED';
}
```

**For goal scorers:** Extracted from BBC/Guardian match reports during the research phase. The research agent fetches the match report URL and extracts scorers, minutes, and key events. This means goal scorers arrive as part of the LLM-extracted research, not as structured API data — which is fine for narrative use. Do NOT treat extracted scorer data as authoritative for statistical tables; use football-data.org scores for all numerical references.

### Pre-req 3: Post-Round Simulation

After results are ingested, run the Monte Carlo engine with the updated league table. This produces the post-round `leagueResults` array. The diff between pre-round and post-round gives us "The Shift" — the probability movement data that anchors the entire Roundup.

```typescript
interface ProbabilityShift {
  team: string;
  preRound: {
    titlePct: number;
    top4Pct: number;
    top7Pct: number;
    survivalPct: number;
    avgPosition: number;
    avgPoints: number;
  };
  postRound: {
    titlePct: number;
    top4Pct: number;
    top7Pct: number;
    survivalPct: number;
    avgPosition: number;
    avgPoints: number;
  };
  delta: {
    titlePct: number;
    top4Pct: number;
    top7Pct: number;
    survivalPct: number;
    avgPosition: number;
    avgPoints: number;
  };
}
```

---

## Architecture

### The Roundup Pipeline

```
User clicks "Generate Roundup" for Matchday N
    │
    ▼
┌──────────────────────────────────┐
│  PHASE R: RESULTS + SIMULATION   │   ← Pure computation, no LLM
│  ~5 seconds                      │
│                                  │
│  1. Load Preview draft (MD N)    │
│     from Supabase                │
│  2. Load pre-round sim snapshot  │
│  3. Fetch results from           │
│     football-data.org            │
│  4. Update standings with        │
│     actual results               │
│  5. Run post-round Monte Carlo   │
│  6. Compute probability shifts   │
│  7. Grade the Perfect Weekend    │
│     table against actual results │
│  8. Identify biggest probability │
│     swing fixture                │
│                                  │
│  Output: RoundupDossier          │
└──────────┬───────────────────────┘
           │
    ┌──────┴───────────────────────┐
    │  PHASE S: RESEARCH            │   ← LLM + web search
    │  ~20-40 seconds               │
    │                               │
    │  Two research tiers:          │
    │                               │
    │  TIER 1 (deep): Target club's │
    │  match + "Result That Changed │
    │  Everything" fixture          │
    │  → 5-7 searches each          │
    │  → Fetch BBC/Guardian match   │
    │    reports for full content    │
    │  → Extract: scorers, key      │
    │    events, post-match quotes,  │
    │    tactical observations      │
    │                               │
    │  TIER 2 (light): Every other  │
    │  fixture                      │
    │  → 1-2 searches each          │
    │  → Score, headline event,     │
    │    one-line narrative hook     │
    │                               │
    │  Output: ResearchBundle       │
    └──────────┬───────────────────┘
               │
    ┌──────────┴───────────────────┐
    │  PHASE W: WRITING             │   ← LLM, no search
    │  ~30-60 seconds               │
    │                               │
    │  Section-by-section generation│
    │  Same wave pattern as Preview:│
    │                               │
    │  Wave A (parallel):           │
    │   - three-races               │
    │   - newcastle-deep-dive       │
    │   - result-that-changed       │
    │   - rapid-round               │
    │                               │
    │  Wave B (sequential, sees A): │
    │   - preview-scorecard         │
    │                               │
    │  Wave C (sequential, sees all)│
    │   - the-shift (data table,    │
    │     minimal prose)            │
    │                               │
    │  Output: RoundupDraft         │
    └──────────────────────────────┘
```

### Key Design Principle: The Preview Is an Input, Not a Reference

The Roundup doesn't just mention the Preview — it structurally consumes it. The Preview's Perfect Weekend table, Game of the Week pick, numeric claims, and probability figures are loaded as structured data and diffed against reality. The writing agent receives both the Preview's claims and the actual outcomes, and its job is to narrate the gap.

---

## Section Definitions

### Section Order

```typescript
export const WEEKLY_ROUNDUP_SECTION_ORDER = [
  'the-shift',           // Probability movement table (data-heavy, light prose)
  'preview-scorecard',   // How the Preview's predictions fared
  'three-races',         // Title, Europe, Relegation impact
  'newcastle-deep-dive', // Target club match review + season impact
  'result-that-changed', // Biggest probability cascade from one result
  'rapid-round',         // Every other fixture, 1-2 sentences each
] as const;
```

---

### Section 1: The Shift

**Purpose:** The quantitative anchor. Before-and-after probability table for every team in a relevant race. Readers see the numbers first, then read the prose sections to understand why.

**Format:** Primarily a data table, rendered in UI. The writing agent produces a 2-3 sentence framing paragraph above it — NOT a full prose section.

**Framing paragraph guidance:**
- Name the single biggest mover in each race
- State the matchday number and rounds remaining
- One sentence on overall volatility ("a quiet round for the title, chaos at the bottom")

**Data table columns:**

| Team | Pre-Round Top 7 | Post-Round Top 7 | Δ | Pre-Round Survival | Post-Round Survival | Δ |
|------|----------------|-----------------|---|-------------------|-------------------|---|

Filter to teams where |Δ| > 0.5pp in any tracked metric, to keep the table readable.

**Inputs:** Pre-round sim snapshot, post-round sim results, probability shift data.

---

### Section 2: Preview Scorecard

**Purpose:** Accountability. Grade the Preview's predictions against what actually happened.

**Structure:**
1. **Perfect Weekend Table — Actual vs Predicted.** Take the Preview's Perfect Weekend table and add an "Actual Result" column and a ✓/✗ marker. State how many of the optimal results landed. Compute the actual cumulative swing vs the predicted maximum.
2. **Game of the Week — Did it deliver?** The Preview flagged a specific fixture as highest-leverage. What happened? Did the leverage materialise as predicted?
3. **The number that moved most.** What was the single largest actual probability swing this round, and did the Preview anticipate it?

**Tone:** Honest, not defensive. If the model got things wrong, say so directly. "The Preview flagged Brentford vs Everton as the highest-leverage fixture. It was right about the stakes but wrong about the outcome — Everton's win was the result nobody priced in." The credibility comes from the transparency, not from being correct.

**Inputs:** Previous Preview's structured data (perfect weekend table, game of week pick, numeric claims), actual results, post-round probability shifts.

---

### Section 3: Three Races

**Purpose:** The medium-depth narrative section. How did this round impact the title, European, and relegation races?

**Structure:** Three sub-sections, each 2-4 paragraphs.

**Title Race:**
- Is it still live or effectively over?
- If a result cracked it open (e.g., Arsenal losing), narrate the mechanism
- Reference the probability shift — not just the result, but what the simulation says the result means for the remaining fixtures

**European Qualification:**
- This should typically get the most space because it's the most volatile
- Name specific teams that gained/lost ground
- Reference the target club's (Newcastle's) position in the race — even if the deep dive covers this separately, the Three Races section should establish the table context

**Relegation:**
- Existential stakes — the writing can be slightly more dramatic here (but calibrated, per V5C tone rules)
- Name who moved into/out of danger
- If a result effectively condemned or saved a team, say so with the probability to back it up

**Inputs:** Probability shift data, actual results, research bundle (for context on why results happened).

---

### Section 4: Newcastle Deep Dive

**Purpose:** The target club's match, reviewed through both the football and the probability lens.

**Structure:** 4-5 paragraphs covering:

1. **Result and match narrative.** Score, scorers (from research), the shape of the game. Did the Preview's tactical predictions play out? (e.g., "We identified Gordon vs Sosa as the key channel — Gordon was Newcastle's most dangerous player in the first half, forcing Glasner into an early tactical switch.")
2. **Probability impact.** What did this result do to Newcastle's top-7 odds? Reference the pre-round number, the post-round number, and the delta. Compare to what the Preview predicted the swing would be.
3. **Season context.** Where does this leave Newcastle with N rounds remaining? What does the updated simulation say about the path from here? Is the European race still alive, narrowing, or effectively over?
4. **Looking ahead.** One or two sentences on what the next fixture means — this becomes the bridge to the following week's Preview.

**Tone:** This is where the "José Mourinho in your pocket" voice is most important. Specific, opinionated about what happened, but grounded in evidence. Not "Newcastle played well" — instead, "Tonali's positioning without Guimarães forced Palace into long balls they couldn't win, and that's where the game was decided."

**Inputs:** Match result, research bundle (Tier 1 — full match report), Preview's match-focus section and predictions, probability shifts for Newcastle specifically.

---

### Section 5: The Result That Changed Everything

**Purpose:** Identify the single fixture whose result produced the largest actual probability cascade across the league, and explain why.

**Selection logic (computed in Phase R):**

```typescript
// For each fixture, sum the absolute probability deltas across all teams
// in the title, European, and relegation races
const impactScore = fixtures.map(f => ({
  fixture: f,
  totalImpact: probabilityShifts
    .reduce((sum, team) => 
      sum + Math.abs(team.delta.titlePct) 
          + Math.abs(team.delta.top7Pct) 
          + Math.abs(team.delta.survivalPct), 0)
}));
// Highest totalImpact wins — but this needs to be computed per-fixture,
// isolating each fixture's contribution. This requires running the sim
// with each fixture's result applied individually. 
//
// SIMPLIFICATION FOR V1: Use the Preview's leverage data (which already
// computed per-fixture impact) and compare to actual outcomes. The fixture
// where |actual_swing - 0| is largest (i.e., a decisive result occurred 
// in a high-leverage fixture) is the winner.
```

**Note for V1:** Computing true per-fixture impact requires isolating each result, which means N additional sim runs. For V1, approximate using the Preview's leverage scores combined with actual results — if the Preview flagged Brentford vs Everton as highest leverage and a decisive result occurred, it's the likely winner. We can add precise per-fixture simulation in V2.

**Structure:** 2-3 paragraphs.
1. State the result and why it matters (which races it impacted)
2. The probability cascade — name 2-3 teams whose odds shifted significantly because of this one result
3. What this means for the remaining fixtures

**Inputs:** Actual results, probability shifts, Preview's leverage data, research bundle (Tier 1 for this fixture).

---

### Section 6: Rapid Round

**Purpose:** Every fixture NOT covered in the deep dives gets a pithy 1-2 sentence treatment.

**Format:** A list of fixtures, each with:
- Score (from football-data.org)
- Goal scorers (from research, if available)
- 1-2 sentences of commentary — the narrative hook, the surprise, or the consequence

**Tone:** Punchy, economical. These are captions, not analyses. Think live-blog energy.

**Example:**
> **Liverpool 1-1 Fulham** (Salah 34'; Iwobi 78') — Fulham's late equaliser does more damage to Liverpool's top-four cushion than it does to Fulham's mid-table comfort. Liverpool have now dropped points in three of their last four home matches.

**Ordering:** By descending probability impact, not by kick-off time. The fixture that moved the needle most goes first.

**Inputs:** All match results, research bundle (Tier 2), probability shifts.

---

## Research Approach (Phase S)

### Tier 1: Deep Research

Used for: target club's match + "Result That Changed Everything" fixture.

**Queries per fixture (5-7):**
1. `"[Home] vs [Away] match report Premier League [month] [year]"` — primary match report
2. `"[Home] vs [Away] result score goals [month] [year]"` — backup for scorers
3. `"[Home] vs [Away] post-match reaction quotes [month] [year]"` — manager quotes
4. `"[Home] vs [Away] tactical analysis [month] [year]"` — tactical observations
5. `"[target club] Premier League result impact analysis [month] [year]"` — contextual

For the target club's match, add:
6. `"[target club] player ratings match [month] [year]"` — individual performances
7. `"[target club] season form European race [year]"` — updated season trajectory

### Tier 2: Light Research

Used for: every other fixture.

**Queries per fixture (1-2):**
1. `"[Home] vs [Away] Premier League result [month] [year]"` — score + headline event
2. Only if fixture had |Δ| > 2pp impact: `"[Home] vs [Away] match report [month] [year]"`

### Research Agent Prompt

The research agent should be instructed:

```
You are a football research assistant building a MATCH REPORT FACT SHEET 
for a Weekly Roundup. The current date is ${currentDate}. 

Your task is to research completed Premier League matches and extract 
verified facts. You MUST search for every claim. Do NOT use training 
knowledge for scores, scorers, or match events — these must come from 
search results.

For EACH match, extract:
- Final score
- Goal scorers and minutes (if available in search results)
- Key match events (red cards, penalties, injuries)
- One notable tactical observation or turning point
- One post-match quote from either manager (if available)

If a search does not return goal scorers, note "scorers not confirmed" 
rather than guessing. Accuracy over completeness.

OUTPUT FORMAT:
For each match, produce:

=== [HOME TEAM] [score] - [score] [AWAY TEAM] ===
Scorers: [name (min'), name (min')] OR [scorers not confirmed from search]
Key event: [one sentence]
Tactical note: [one sentence]  
Manager quote: [one sentence, attributed] OR [no quote found]
Narrative hook: [one sentence — the storyline for the rapid round]
===
```

---

## Writing Approach (Phase W)

### System Prompt Additions for the Roundup Writer

The Roundup writer inherits the Preview's tone rules (from the existing `buildSectionPrompt`) plus these additions:

```
## ROUNDUP-SPECIFIC RULES

1. You are writing about events that HAVE HAPPENED. Use past tense for 
   match events. Use present tense for table positions and probability 
   states ("Newcastle now sit at 11.2%").

2. When referencing the Preview's predictions, be specific: "The Preview 
   identified Crystal Palace vs Newcastle as a +5.4pp swing. The actual 
   swing was +3.1pp — the direction was right, the magnitude overstated." 
   Do not vaguely say "as predicted" or "as expected."

3. Goal scorers are extracted from match reports, not from a verified 
   statistical source. Use them in narrative ("Isak's header gave Newcastle 
   the lead") but do not build statistical claims around them.

4. The Roundup is shorter than the Preview. Target ~2,500 words total 
   across all sections (Preview is ~3,500). The Rapid Round should be 
   dense — many fixtures in little space.

5. NEVER use "as we predicted" or "as the model expected" language. The 
   Preview is not a prediction engine — it's a probability framework. Say 
   "the simulation flagged this as the highest-leverage fixture" not "we 
   predicted this would be important."

6. The Shift table is DATA, not prose. Do not narrate every number in it. 
   The framing paragraph highlights 2-3 movers; the reader can scan the 
   rest themselves.

7. One punchy line per section maximum (inherited from V5C tone rules). 
   The Roundup should feel measured, not breathless.
```

### Writing Phase Structure

Each section agent receives:
- The RoundupDossier (results, probability shifts, perfect weekend grades)
- The research bundle relevant to that section
- The Preview's structured data (for comparison sections)
- Handoff notes from previously generated sections (same wave pattern as Preview)

The section agents do NOT receive the full research bundle — only the portion relevant to their section. This keeps context windows tight and prevents cross-contamination.

---

## Types

```typescript
export const WEEKLY_ROUNDUP_SECTION_ORDER = [
  'the-shift',
  'preview-scorecard',
  'three-races',
  'newcastle-deep-dive',
  'result-that-changed',
  'rapid-round',
] as const;

export type WeeklyRoundupSectionId = (typeof WEEKLY_ROUNDUP_SECTION_ORDER)[number];

export interface RoundupDossier {
  version: string;
  generatedAt: number;
  matchday: number;
  season: string;
  club: string;                              // target club (Newcastle)
  roundsRemaining: number;

  // Results
  results: MatchResult[];

  // Simulation data
  preRoundSnapshot: SimulationResult[];       // from Preview's stored snapshot
  postRoundResults: SimulationResult[];       // fresh sim after results
  probabilityShifts: ProbabilityShift[];      // computed diff

  // Preview reference
  previousPreview: {
    matchday: number;
    perfectWeekend: WeeklyPreviewPerfectWeekendEntry[];
    gameOfWeekFixtureId: string;
    gameOfWeekTeams: { home: string; away: string };
    contestSnapshots: {
      title: WeeklyPreviewContestSnapshot;
      europe: WeeklyPreviewContestSnapshot;
      survival: WeeklyPreviewContestSnapshot;
    };
    clubBaselineTop7Pct: number;
  };

  // Perfect weekend grading
  perfectWeekendGrades: PerfectWeekendGrade[];
  perfectWeekendActualSwing: number;         // actual cumulative pp swing
  perfectWeekendPredictedSwing: number;      // predicted cumulative pp swing
  perfectWeekendHitRate: number;             // fraction of correct results

  // Research
  researchBundle: ResearchBundle;

  // Computed
  resultThatChanged: {
    fixtureId: string;
    homeTeam: string;
    awayTeam: string;
    homeGoals: number;
    awayGoals: number;
    impactScore: number;                     // total |Δ| across league
  };

  // Metadata
  sources: SourceRef[];
  warnings: string[];
}

export interface MatchResult {
  fixtureId: string;
  homeTeam: string;
  awayTeam: string;
  homeGoals: number;
  awayGoals: number;
  status: 'FINISHED' | 'IN_PLAY' | 'SCHEDULED';
}

export interface PerfectWeekendGrade {
  fixtureId: string;
  homeTeam: string;
  awayTeam: string;
  predictedResult: 'home' | 'draw' | 'away';
  predictedResultLabel: string;
  actualResult: 'home' | 'draw' | 'away';
  actualScore: string;                       // "3-0"
  correct: boolean;
  predictedSwingPp: number;
  actualSwingPp: number;                     // requires per-fixture sim (V2) or approximation
}

export interface RoundupDraft {
  id: string;
  matchday: number;
  generatedAt: number;
  sections: RoundupSectionArtifact[];
  metadata: {
    llmCalls: number;
    webSearches: number;
    model: string;
    wallClockTimeMs: number;
  };
  sources: SourceRef[];
  warnings: string[];
}

export interface RoundupSectionArtifact {
  sectionId: WeeklyRoundupSectionId;
  headline: string;
  markdown: string;
  sourceRefs: string[];
  handoffNotes: string[];
}
```

---

## Implementation Plan

### Phase 1: Pre-requisites (before any Roundup code)

1. **Add pre-round snapshot to Preview persistence.** When the Preview draft is saved to Supabase, also save `leagueResults` as a JSON column. This is a one-field addition to the existing storage.

2. **Build `fetchMatchdayResults()`.** Call football-data.org, return `MatchResult[]`. Handle partial rounds (some games not yet FINISHED) by flagging in `warnings`.

3. **Build post-round simulation runner.** Takes actual results, updates standings, runs Monte Carlo, returns fresh `SimulationResult[]`. This is mostly wiring existing functions together.

4. **Build `computeProbabilityShifts()`.** Takes pre-round and post-round arrays, returns `ProbabilityShift[]`. Pure arithmetic.

### Phase 2: Dossier Builder

5. **Build `buildRoundupDossier()`.** Orchestrates all of Phase 1's outputs into a single `RoundupDossier`. Also loads the Preview from Supabase, grades the perfect weekend, and identifies the "Result That Changed Everything."

### Phase 3: Research

6. **Build Roundup research agent.** Same loop pattern as Preview's research agent but with match-report-focused queries. Two tiers as specified above.

### Phase 4: Writing

7. **Build section agents.** Same pattern as Preview's `runSectionAgent()` — one agent per section, wave-structured.

8. **Build writing prompts.** Per-section system prompts incorporating the Roundup-specific rules above.

### Phase 5: Assembly + UI

9. **Build `generateWeeklyRoundupDraft()`.** The top-level orchestrator, same pattern as `generateWeeklyPreviewDraft()`.

10. **Build UI.** The Roundup page can likely reuse the Preview's page layout with minor adjustments (different section labels, different accent logic). The Shift table is a new UI component.

11. **Manual trigger.** API route with no auth for now (manual use only). Button in the admin/dev UI.

---

## V2 Enhancements (Not for V1)

These are explicitly deferred to avoid scope creep:

- **Per-fixture simulation isolation.** Running the sim with each fixture individually to get true per-fixture impact scores. Requires N extra sim runs per round.
- **Source-biased retrieval.** Domain-scoped search queries, Firecrawl integration, or Perplexity Sonar. Build on existing Serper/Tavily for V1.
- **xG and advanced stats integration.** Requires a paid data source.
- **Automated cron trigger.** Move from manual to scheduled generation, with partial-round handling.
- **Historical Roundup archive.** Storing past Roundups and enabling cross-matchday trend analysis.

---

## Quality Checklist (After Implementation)

Run a Roundup for Matchday 32 and check:

- [ ] **The Shift table** shows correct pre/post probabilities with reasonable deltas
- [ ] **Preview Scorecard** references specific claims from the actual Preview (not generic predictions)
- [ ] **Three Races** uses probability numbers, not just results, to tell the story
- [ ] **Newcastle Deep Dive** references the Preview's tactical predictions and grades them against what happened
- [ ] **Result That Changed Everything** names the correct highest-impact fixture and explains the cascade
- [ ] **Rapid Round** covers every fixture not deep-dived, with scores and 1-2 sentences each
- [ ] **Goal scorers** appear in narrative where research found them, with no fabricated names
- [ ] **No hallucinated match events** — every factual claim traceable to a search result
- [ ] **Total word count** ~2,500 (not 4,000+)
- [ ] **Tone** is measured — one dramatic line per section maximum
- [ ] **Past tense** for match events, present tense for league state
