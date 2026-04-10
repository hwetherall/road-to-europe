# claude-deepdive.md — Deep Analysis Brain: Improvement Spec

## Context

This document contains instructions for improving the Deep Analysis feature (V4) of Keepwatch — specifically the **research prompt**, **writing prompt**, **research orchestration**, and **API configuration** in `app/api/deep-analysis/route.ts`.

The Deep Analysis pipeline has two phases:
- **Phase A (Research Agent):** Receives a list of teams, performs web searches, outputs a structured fact sheet.
- **Phase B (Writing Agent):** Receives the fact sheet + simulation data, writes the final analysis JSON.

Both phases are working, but the output quality falls short of the gold-standard example in `keepwatch-v4-example.md`. This document specifies exactly what to change and why.

---

## Problem Diagnosis (What's Wrong Now)

### 1. Research is spread too thin across too many teams
The current `narrateAnalysis()` adds teams from the top 6 sensitivity fixtures, which can be 10-12 unique teams. The research agent has ~30 searches to spread across all of them — roughly 3 per team. That's barely enough to confirm the manager, let alone find tactical nuances about set-piece records, defensive shapes, or transition vulnerabilities. The decisive match teams need deep research; the matches-to-watch teams just need a quick context check.

### 2. Research prompt doesn't ask for tactical specifics
The current search instructions are generic: `"[team] tactics playing style 2025-26"`. This returns surface-level results. The gold-standard example references things like "zonal-personal hybrid system at corners", "3+2 rest defence", "inverting full-back" — these come from tactical analysis sites, preview articles, and set-piece data that the current prompt never asks for.

### 3. Writing prompt's brevity instructions are too aggressive
The prompt says `"risks": 1-2 sentences each` and `"angles": 2-3 sentences each`. The gold standard has 3-4 sentences per risk and 5-8 sentences per angle. The current constraints force the writing agent to compress into bland summaries instead of building specific, evidence-backed arguments.

### 4. Angles are statistical, not tactical
The writing prompt says `"angles = specific mismatches"` but doesn't define what a good angle looks like. The actual output produces things like "Spurs' away record offers genuine hope" (just restating a stat) instead of "Tudor's counter-pressing system suits away fixtures because [specific mechanism] which exploits [specific opponent weakness]". The prompt needs to explicitly demand mechanical reasoning.

### 5. `max_tokens: 4000` is too low for the writing phase
The gold-standard output, serialized as JSON, runs ~3500-4500 tokens. With a 4000 ceiling, the model is being forced to compress. This directly causes thin angles and truncated risks.

### 6. Matches to Watch lack narrative framing
The gold standard frames each match from the target team fan's perspective ("Whoever loses drops points that Newcastle can capitalise on"). The current outputs are more formulaic. The writing prompt needs to instruct: write as if explaining to a fan of the target team why they should care about a match they're not even in.

---

## Changes to `app/api/deep-analysis/route.ts`

### Change 1: Restructure Research Team Selection in `narrateAnalysis()`

**Current code (lines ~416-434):**
```typescript
const teamsToResearch = new Set<string>();
teamsToResearch.add(teamName);
// Add teams from the decisive match
// Add teams from top sensitivity fixtures (matches to watch candidates)
for (const s of pathResult.sensitivityData.slice(0, 6)) { ... }
```

**Replace with tiered research:**
```typescript
// ── Tier 1: Deep research (decisive match teams + target team) ──
const tier1Teams = new Set<string>();
tier1Teams.add(teamName);

if (pathResult.sensitivityData[0]) {
  const s = pathResult.sensitivityData[0];
  const homeTeamObj = config.teams.find(t => t.abbr === s.homeTeam);
  const awayTeamObj = config.teams.find(t => t.abbr === s.awayTeam);
  if (homeTeamObj) tier1Teams.add(homeTeamObj.name);
  if (awayTeamObj) tier1Teams.add(awayTeamObj.name);
}

// ── Tier 2: Light research (matches-to-watch teams, excluding already-covered) ──
const tier2Teams = new Set<string>();
const matchesToWatchFixtures = pathResult.sensitivityData
  .filter(s => s.fixtureId !== pathResult.sensitivityData[0]?.fixtureId)
  .slice(0, 5);

for (const s of matchesToWatchFixtures) {
  const homeTeamObj = config.teams.find(t => t.abbr === s.homeTeam);
  const awayTeamObj = config.teams.find(t => t.abbr === s.awayTeam);
  if (homeTeamObj && !tier1Teams.has(homeTeamObj.name)) tier2Teams.add(homeTeamObj.name);
  if (awayTeamObj && !tier1Teams.has(awayTeamObj.name)) tier2Teams.add(awayTeamObj.name);
}

// Phase A1: Deep research on decisive match teams (10-12 searches per team)
const { factSheet: deepFactSheet, sources: deepSources, searchCount: deepCount } =
  await runResearchPhase(pathResult, config, teamName, [...tier1Teams], 'deep');

// Phase A2: Light research on matches-to-watch teams (2-3 searches per team)
const { factSheet: lightFactSheet, sources: lightSources, searchCount: lightCount } =
  await runResearchPhase(pathResult, config, teamName, [...tier2Teams], 'light');

const combinedFactSheet = deepFactSheet + '\n\n' + lightFactSheet;
const allSources = [...deepSources, ...lightSources];
const totalSearchCount = deepCount + lightCount;

// Phase B: Write
const analysis = await runWritingPhase(
  pathResult, config, teamName, position, points, gapToTarget, gamesRemaining, combinedFactSheet
);

return { analysis, sources: allSources, searchCount: totalSearchCount };
```

Then update `runResearchPhase` to accept a `depth: 'deep' | 'light'` parameter and use different prompts (see below). For the deep tier, use `MAX_ROUNDS = 15`. For the light tier, use `MAX_ROUNDS = 8`.

---

### Change 2: Rewrite the Research Prompt (`buildResearchPrompt`)

**Replace the entire function with two variants.**

#### Deep Research Prompt (for decisive match teams + target team)

```typescript
function buildDeepResearchPrompt(
  pathResult: PathSearchResult,
  config: PathSearchConfig,
  teamName: string,
  teamsToResearch: string[]
): string {
  const currentDate = new Date().toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric'
  });

  return `You are a football research assistant building a VERIFIED FACT SHEET for a Deep Analysis document. The current date is ${currentDate}. The Premier League season is 2025-26.

## YOUR TASK
Research the following teams IN DEPTH and produce a structured fact sheet. You MUST search for every single claim. Do NOT use training knowledge — it is outdated and unreliable.

Teams to research: ${teamsToResearch.join(', ')}

## REQUIRED SEARCHES — DEEP TIER
For EACH team listed, perform ALL of these searches. Do not skip any.

### Core verification (3 searches per team)
1. "[team] manager head coach 2025-26" — WHO is the current manager? This is the #1 source of errors. Managers get sacked constantly.
2. "[team] squad key players 2025-26 season" — WHO plays for this team NOW? Verify every name. Players transfer and get loaned.
3. "[team] injuries suspensions ${currentDate.split(' ').slice(1).join(' ')}" — who is currently OUT?

### Form and results (2 searches per team)
4. "[team] recent results form 2026" — last 5-6 results with scores
5. "[team] home away record 2025-26 Premier League" — split home/away points and record

### Tactical depth (3-4 searches per team — THIS IS CRITICAL)
6. "[team] tactical analysis formation pressing style 2025-26" — how do they play under the current manager? What formation? How do they press? What's their build-up pattern?
7. "[team] set piece record corners goals conceded 2025-26" — set piece attacking AND defending record. Goals from corners, free kicks. Defensive set piece system (zonal, man-marking, hybrid).
8. "[team] defensive vulnerabilities weaknesses 2025-26" — specific weaknesses identified by analysts or pundits. Transition defence, high-line risks, wide areas, aerial duels.
9. "[team] [opponent from decisive match] tactical preview" — if a preview article exists for the upcoming head-to-head, it will contain matchup-specific insights.

### Context (1-2 searches per team)
10. "[team] European campaign cup fixtures schedule 2026" — are they in Europe? How does fixture congestion affect them?

You have a budget of up to 35 web searches. Use them. Prioritise tactical depth searches (items 6-9) — these are what make the analysis valuable. If you have to skip anything, skip item 10, never skip 6-8.

## OUTPUT FORMAT
After completing your research, output a fact sheet in this exact format:

\`\`\`factsheet
TEAM: [team name]
MANAGER: [verified name] (since [date if known])
FORMATION: [primary formation used this season, e.g. "4-2-3-1" or "3-4-2-1"]
KEY PLAYERS (CONFIRMED ON CURRENT SQUAD): [comma-separated list — ONLY players confirmed to be at this club RIGHT NOW]
PLAYERS WHO HAVE LEFT: [any notable former players you discovered have moved — include where they went]
RECENT FORM: [last 5-6 results with scores if available]
HOME RECORD: [W-D-L and points from home games this season]
AWAY RECORD: [W-D-L and points from away games this season]
INJURIES/SUSPENSIONS: [current absences with expected return dates if known]
TACTICAL STYLE: [2-3 sentences on how they play — formation in and out of possession, pressing intensity, build-up pattern]
DEFENSIVE SHAPE: [how they defend — high line vs deep block, pressing triggers, transition defence]
SET PIECE RECORD: [goals scored/conceded from set pieces, defensive system at corners (zonal/man-mark/hybrid), notable aerial threats]
STRENGTHS: [3-4 specific strengths with evidence]
WEAKNESSES: [3-4 specific weaknesses with evidence — be precise: "vulnerable in transition down the left" not just "inconsistent"]
KEY MATCHUP NOTES: [any specific player-vs-player or tactical matchup insights found in preview articles]
FIXTURE CONGESTION: [European commitments, upcoming schedule density]
---
\`\`\`

Repeat this block for each team.

## CRITICAL RULES
- If a search says a player has TRANSFERRED or been LOANED OUT, they are NOT on the current squad. Do not list them.
- If you find conflicting information about a manager, use the MOST RECENT source.
- If you cannot verify something, write "UNVERIFIED" rather than guessing.
- Better to have fewer verified facts than many speculative ones.
- For TACTICAL STYLE, DEFENSIVE SHAPE, and SET PIECE RECORD: if your search returns nothing specific, write "No detailed tactical analysis found" — do NOT invent tactical descriptions from general knowledge.`;
}
```

#### Light Research Prompt (for matches-to-watch teams)

```typescript
function buildLightResearchPrompt(
  teamName: string,
  teamsToResearch: string[]
): string {
  const currentDate = new Date().toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric'
  });

  return `You are a football research assistant. Build a BRIEF fact sheet for these teams. The current date is ${currentDate}.

Teams: ${teamsToResearch.join(', ')}

## REQUIRED SEARCHES — LIGHT TIER
For each team, do 2-3 searches:
1. "[team] manager form results March 2026" — current manager + recent form
2. "[team] injuries key absences 2026" — who's missing?
3. "[team] home away record 2025-26" — only if the team's home/away split is relevant

You have a budget of up to 15 searches. Be efficient.

## OUTPUT FORMAT
\`\`\`factsheet
TEAM: [team name]
MANAGER: [verified name]
RECENT FORM: [last 3-5 results]
KEY ABSENCES: [current injuries/suspensions]
HOME/AWAY RECORD: [if found]
BRIEF CONTEXT: [1-2 sentences on their season — are they in a relegation fight, pushing for Europe, mid-table with nothing to play for?]
---
\`\`\`

## RULES
- Verify the manager. This is the most common error.
- If you can't find something, write "UNVERIFIED".
- Do NOT pad with generic analysis. Keep it factual and brief.`;
}
```

---

### Change 3: Rewrite the Writing Prompt (`buildWritingPrompt`)

**Replace the entire function.** The new prompt is significantly more detailed about what makes a good angle, risk, and narrative.

```typescript
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
  const objectiveLabel = isChampion
    ? 'winning the league title'
    : isRelegation
      ? 'avoiding relegation'
      : 'qualifying for Europe';

  const metricLabel = isChampion
    ? 'Champion'
    : isRelegation
      ? 'Relegation'
      : config.targetMetric.replace('Pct', '').replace('top', 'Top ');

  // Get the decisive match info
  const decisive = pathResult.sensitivityData[0];
  const decisiveHome = decisive?.homeTeam ?? '';
  const decisiveAway = decisive?.awayTeam ?? '';

  return `You are Keepwatch's Deep Analysis writer. You produce a narrative-rich analysis document about ${teamName}'s chances of ${objectiveLabel}. Your output should read like a Monday Night Football deep-dive segment: specific, data-informed, occasionally surprising.

## YOUR HARD CONSTRAINT
You have been given a VERIFIED FACT SHEET from a research agent. You may ONLY reference facts that appear in this fact sheet. If a player, manager, tactic, or stat is not in the fact sheet, do NOT mention them. If the fact sheet says "UNVERIFIED" for something, do not reference it. This is non-negotiable — accuracy over eloquence.

## VERIFIED FACT SHEET
${factSheet}

## SIMULATION DATA
Team: ${teamName} (${config.targetTeam})
Position: ${position}th, ${points} points
Gap to target: ${gapToTarget} points ${isRelegation ? '(above the drop zone — higher is safer)' : '(behind the target position — lower is better)'}
Games remaining: ${gamesRemaining}
Baseline ${config.targetMetric}: ${pathResult.baselineOdds.toFixed(1)}%

Optimal path (mathematical ceiling: ${pathResult.optimalPath.resultingOdds.toFixed(1)}%):
${formatOptimalPath(pathResult.optimalPath)}
Combined plausibility: ${(pathResult.optimalPath.compositePlausibility * 100).toFixed(2)}%

Candidate paths (plausible scenarios):
${pathResult.candidatePaths.map(formatCandidatePath).join('\n\n')}

Top sensitivity fixtures:
${pathResult.sensitivityData.slice(0, 10).map(formatSensitivity).join('\n')}

Decisive match: ${decisiveHome} vs ${decisiveAway} (fixture ID: ${decisive?.fixtureId ?? ''})

## WHAT MAKES A GOOD ANALYSIS (READ THIS CAREFULLY)

### Good "contextNarrative" (State of Play)
Tell the STORY of this team's season in 4-6 sentences. Don't just list stats — weave a narrative. Reference specific events from the fact sheet: a key transfer, a managerial change, an injury that changed the trajectory, a run of form. The stat pills in the UI already show position, gap, remaining games, and baseline odds — do NOT repeat those numbers in prose. Instead, give the reader context that the numbers alone can't convey.

GOOD: "Newcastle's season has been a slow unravelling since selling Alexander Isak to Liverpool for £125m — the goal threat has visibly dried up and the defensive fragility Eddie Howe acknowledged earlier this season hasn't been fixed. Bruno Guimarães's hamstring injury has ripped the midfield engine out at the worst possible time, and a run of form that saw them 19th in the form table tells you everything about momentum."

BAD: "Newcastle are 12th on 42 points, 4 points behind 7th place, with 7 games remaining. They have a 7% chance of qualifying for Europe." (This just restates the stat pills.)

### Good "risks" (Decisive Match — Key Risks)
Each risk is a SPECIFIC OPPONENT THREAT in the decisive match. 3-4 sentences each. Structure: Name the threat → explain the mechanism → say why it's dangerous for THIS team specifically.

GOOD: "Unai Emery's Villa are a fortress at home — W9 D2 L4 with 29 points from 15 games — and are renowned as a 'brilliant second-half team' who consistently improve after half-time tactical adjustments. Spurs have been dreadful in away second halves all season."

BAD: "Villa are a strong team at home and will be difficult to beat." (Generic, no mechanism, no matchup-specific danger.)

Produce 3 risks. The first should be the highest-threat, most specific danger. Use the fact sheet's DEFENSIVE SHAPE, STRENGTHS, and KEY MATCHUP NOTES fields.

### Good "angles" (Where the Matchup Favours ${teamName})
THIS IS THE MOST IMPORTANT SECTION. Each angle needs 4-6 sentences and must identify a TACTICAL MECHANISM — not just a stat line.

An angle has three parts:
1. THE MECHANISM: A specific tactical pattern, set-piece vulnerability, formation mismatch, or transition opportunity. ("Arsenal operate a zonal-personal hybrid system at corners, and opponents who attack the near post have found gaps.")
2. THE EVIDENCE: Data or observations from the fact sheet that support this mechanism. ("${teamName} have scored X goals from set pieces this season" or "Under [manager], they run a high press that leaves space behind the full-backs.")
3. THE SO-WHAT: Why this specific mechanism matters for THIS match. ("If ${teamName} can win the corner count in the first half, their aerial advantage is in play.")

GOOD ANGLE: "Set pieces are the crack in Arsenal's wall. Arsenal's defensive structure in open play is near-flawless, but from set pieces, they're more vulnerable than their overall record suggests. They operate a zonal system at corners that opponents attacking the near post have exposed. ${teamName}, meanwhile, are one of the most dangerous set-piece teams in the league — [player names from fact sheet] all provide aerial targets. This is a genuine statistical mismatch."

BAD ANGLE: "${teamName}'s away record offers genuine hope. They have picked up 20 of their 30 points on the road." (This is just a stat restatement with no tactical mechanism. WHY is their away form good? What about their playing style suits away matches? What about the OPPONENT's home setup creates opportunities?)

Produce 3 angles. Each needs a punchy 5-8 word title.

### Good "whatToWatch" (In-Match Indicators)
These are SPECIFIC, OBSERVABLE things a viewer can track in the first 30-60 minutes. Not "the first 15 minutes will be important" — that's meaningless. Instead: "Whether Tudor sets up to absorb Villa's first-half pressure and hit them on transitions — or whether he commits to his usual high press, which could be suicidal against Emery's patient build-up."

Produce 3 items. Each should be 1-2 sentences naming a specific tactical indicator, player behaviour, or formation tell.

### Good "matchesToWatch" (Non-Target-Team Fixtures)
Frame each match from ${teamName}'s perspective. A fan of ${teamName} should understand why they need to care about a match they're not even playing in.

For each match:
- "whyItMatters": 2-3 sentences. Start with the simulation impact in plain language, then explain the football logic. ("The biggest external swing fixture — if Arsenal beat West Ham, it drags a direct relegation rival further into trouble, shifting Spurs' odds by +14.5pp.")
- "whyItsPlausible": 2-3 sentences grounded in fact sheet data about both teams. ("Arsenal are runaway league leaders with 70 points and a W9 D5 L2 away record. West Ham's home form is dismal at W3 D3 L8.")
- "idealResult": Name the result clearly. ("Arsenal win.")
- "simulationImpact": Use the format "+Xpp" from the sensitivity data.

Produce 3-4 matches to watch. Include a MIX: some should be the target team's own fixtures (if they appear in the sensitivity data), some should be rival fixtures.

### Good "bottomLine"
- "summary": 2-3 sentences. A pundit wrapping up the segment. Name the central tension. ("Tottenham's survival hinges on their bizarre split personality — they need to keep performing like a mid-table side on the road while somehow not being the worst home team in the division.")
- "keyScenario": ONE concrete sentence naming the specific combination of results that crosses the threshold. ("Beat Chelsea away in their worst form of the season, beat Everton at home to end the home drought, and let Arsenal handle West Ham — that combination drops Spurs' relegation probability to around 4%.")

## OUTPUT FORMAT
Return a JSON object wrapped in \`\`\`json blocks. Match this exact structure:

\`\`\`json
{
  "stateOfPlay": {
    "contextNarrative": "4-6 sentences. Season story, not stat recitation."
  },
  "decisiveMatch": {
    "fixtureId": "${decisive?.fixtureId ?? ''}",
    "homeTeam": "${decisiveHome}",
    "awayTeam": "${decisiveAway}",
    "date": "human-readable date if found in fact sheet, otherwise omit",
    "risks": [
      "Risk 1: 3-4 sentences. Highest-threat opponent danger.",
      "Risk 2: 3-4 sentences. Second key threat.",
      "Risk 3: 3-4 sentences. Third threat."
    ],
    "angles": [
      {"title": "5-8 word punchy title", "analysis": "4-6 sentences. Mechanism + evidence + so-what."},
      {"title": "...", "analysis": "4-6 sentences."},
      {"title": "...", "analysis": "4-6 sentences."}
    ],
    "whatToWatch": [
      "1-2 sentences. Specific observable tactical indicator.",
      "1-2 sentences. Second indicator.",
      "1-2 sentences. Third indicator."
    ]
  },
  "matchesToWatch": [
    {
      "fixtureId": "from sensitivity data",
      "homeTeam": "XXX",
      "awayTeam": "XXX",
      "whyItMatters": "2-3 sentences. Simulation impact + football logic.",
      "idealResult": "Team X win / Draw",
      "whyItsPlausible": "2-3 sentences from fact sheet data.",
      "simulationImpact": "+Xpp"
    }
  ],
  "bottomLine": {
    "summary": "2-3 sentences. Pundit sign-off. Central tension + what it all means.",
    "keyScenario": "One concrete sentence: 'If X beats Y, Z draws with W, and Q loses to R — odds cross N%.'"
  },
  "sources": []
}
\`\`\`

## HARD RULES
1. NEVER use a player name, manager name, or tactical detail that is not in the fact sheet. If the fact sheet doesn't mention someone, they don't exist for the purposes of this analysis.
2. NEVER reference "Path 1", "Path 2", or "candidate paths" — the reader hasn't seen those. Describe scenarios in plain language.
3. NEVER repeat stat-pill numbers (position, points, gap, baseline odds) in the contextNarrative — the UI already displays these prominently.
4. "risks" are about the OPPONENT's threat to ${teamName}. "angles" are about ${teamName}'s opportunity against the opponent. Don't mix them up.
5. Every "angle" must contain a TACTICAL MECHANISM. "Good away form" is NOT an angle. "Counter-pressing system suits away fixtures because it invites pressure then exploits the space behind the opponent's committed full-backs" IS an angle.
6. ${isRelegation ? 'This is a RELEGATION analysis. Frame everything through the lens of survival: points needed, safety margins, "must-not-lose" fixtures. The tone should acknowledge the precariousness without being fatalistic.' : isChampion ? 'This is a TITLE analysis. Frame everything through the lens of maintaining/closing the gap, and rivals dropping points.' : 'This is a EUROPEAN QUALIFICATION analysis. Frame everything through the lens of climbing the table and overhauling the teams above.'}`;
}
```

---

### Change 4: Increase `max_tokens` on the Writing Phase

In `callOpenRouter()`, the current setting is:
```typescript
max_tokens: 4000,
```

**Change to:** Add a parameter to `callOpenRouter` so the writing phase can use a higher token budget:

```typescript
async function callOpenRouter(
  messages: OpenRouterMessage[],
  tools?: typeof TOOLS,
  maxTokens: number = 400000  // default stays 4000 for research phase
): Promise<OpenRouterMessage> {
  const body: Record<string, unknown> = {
    model: 'anthropic/claude-opus-4.6',
    messages,
    max_tokens: maxTokens,
  };
  // ...
}
```

Then in `runWritingPhase`, call with a higher budget:
```typescript
const message = await callOpenRouter(conversation, [], 8000);
```

The research phase keeps 4000 (fact sheets don't need to be long). The writing phase gets 8000 to allow the richer output the new prompt demands.

---

### Change 5: Update `runResearchPhase` to Support Tiered Depth

Add the `depth` parameter and use the appropriate prompt:

```typescript
async function runResearchPhase(
  pathResult: PathSearchResult,
  config: PathSearchConfig,
  teamName: string,
  teamsToResearch: string[],
  depth: 'deep' | 'light' = 'deep'
): Promise<{ factSheet: string; sources: string[]; searchCount: number }> {
  if (teamsToResearch.length === 0) {
    return { factSheet: '', sources: [], searchCount: 0 };
  }

  const systemPrompt = depth === 'deep'
    ? buildDeepResearchPrompt(pathResult, config, teamName, teamsToResearch)
    : buildLightResearchPrompt(teamName, teamsToResearch);

  const conversation: OpenRouterMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `Research all the teams listed and build the fact sheet. Start searching now.` },
  ];

  const sources: string[] = [];
  let searchCount = 0;
  const MAX_ROUNDS = depth === 'deep' ? 18 : 10;

  // ... rest of the loop stays the same ...
}
```

Increase `MAX_ROUNDS` for the deep tier from 15 → 18 to accommodate the additional tactical searches (set pieces, defensive shape, match preview).

---

### Change 6: Fix the Matches-to-Watch Selection Logic

Currently `matchesToWatch` in the final analysis object (lines ~602-624) filters to non-target-team fixtures only. But the gold-standard example includes BOTH:
- The target team's own crucial fixtures (e.g., "Crystal Palace vs Newcastle — this is the easiest remaining fixture")
- Rival fixtures the target team can't control

**Update the fallback logic** (when `narrativeData.matchesToWatch` is null) to include a mix:

```typescript
matchesToWatch:
  narrativeData.matchesToWatch ??
  [
    // Include 1-2 of the target team's own highest-leverage fixtures
    ...pathResult.sensitivityData
      .filter(s =>
        s.fixtureId !== decisiveFixture?.fixtureId &&
        (s.homeTeam === targetTeam || s.awayTeam === targetTeam)
      )
      .slice(0, 2)
      .map(s => ({
        fixtureId: s.fixtureId,
        homeTeam: s.homeTeam,
        awayTeam: s.awayTeam,
        whyItMatters: `A ${targetTeam} match with ${s.maxAbsDelta.toFixed(1)}pp swing on ${metricLabel} odds.`,
        idealResult: /* best result for target team */,
        whyItsPlausible: 'Based on current form and bookmaker odds.',
        simulationImpact: `+${Math.max(s.deltaIfHomeWin, s.deltaIfDraw, s.deltaIfAwayWin).toFixed(1)}pp`,
      })),
    // Then 2-3 rival fixtures
    ...pathResult.sensitivityData
      .filter(s =>
        s.fixtureId !== decisiveFixture?.fixtureId &&
        s.homeTeam !== targetTeam &&
        s.awayTeam !== targetTeam
      )
      .slice(0, 3)
      .map(s => ({ /* same as current */ })),
  ].slice(0, 4),
```

The writing agent should also be told in the prompt that `matchesToWatch` can include the target team's own fixtures when they're high-leverage — it doesn't have to be exclusively "other people's matches".

---

## Summary of All Changes

| # | File | Function/Area | What Changes | Why |
|---|------|--------------|-------------|-----|
| 1 | route.ts | `narrateAnalysis()` | Split into tier 1 (deep) + tier 2 (light) research | Focus search budget on decisive match teams |
| 2 | route.ts | `buildResearchPrompt()` | Replace with `buildDeepResearchPrompt()` and `buildLightResearchPrompt()` | Add tactical-specific searches (set pieces, defensive shape, match previews) |
| 3 | route.ts | `buildWritingPrompt()` | Complete rewrite with richer instructions, examples of good/bad output, explicit angle structure | Fix thin angles, generic risks, stat-restating narratives |
| 4 | route.ts | `callOpenRouter()` | Add `maxTokens` parameter, use 8000 for writing phase | Give writing agent room to produce gold-standard-length output |
| 5 | route.ts | `runResearchPhase()` | Add `depth` parameter, increase MAX_ROUNDS for deep tier | Support tiered research |
| 6 | route.ts | Final analysis assembly | Update matchesToWatch fallback to include target team's own fixtures | Match the gold standard's fixture mix |

## Quality Checklist (After Implementation)

Run a Deep Analysis for any team and check:

- [ ] **contextNarrative** tells a story (references a specific event, transfer, injury, or form run) and does NOT restate the stat-pill numbers
- [ ] **risks** each name a real player or tactical concept from the fact sheet and explain WHY it's dangerous for the target team specifically
- [ ] **angles** each contain a tactical mechanism (not just "good form" or "strong away record") with evidence and a "so what"
- [ ] **whatToWatch** items are specific enough that a viewer could observe them in-match
- [ ] **matchesToWatch** includes at least one of the target team's own fixtures alongside rival fixtures
- [ ] **keyScenario** names a specific combination of results with a probability threshold
- [ ] No player/manager names appear that aren't in the fact sheet
- [ ] The analysis JSON is fully populated (no fallback/placeholder content)
- [ ] Total search count is 25-45 (not 10-15 like before, not 60+)
- [ ] End-to-end time is under 60 seconds (research + writing)
