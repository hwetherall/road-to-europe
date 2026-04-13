# CLAUDE-RIVALS.md — Rival Context Research: Improvement Spec

## Context

This document specifies changes to the Deep Analysis pipeline (`app/api/deep-analysis/route.ts`) to add **rival context research** — a new research tier that investigates the teams competing for the same objective as the target team.

The problem: when Arsenal's report says City have "an improbable lifeline," but City just won three straight including 4-0 vs Liverpool and 3-0 at Chelsea, the writing agent has no idea. It can only work with what the research agent provides, and the research agent currently only investigates decisive-match teams (deep tier) and matches-to-watch teams (light tier). It never looks at the direct rivals whose trajectory defines the entire narrative.

This matters most for:
- **Title races**: Arsenal's story is incomplete without City's form, and vice versa
- **Relegation battles**: Spurs' survival odds depend on what West Ham, Forest, Ipswich are doing
- **European qualification**: Newcastle's push for 7th depends on Brentford, Everton, Villa's results

The fix is a new research tier — **Rival Research** — that sits between deep and light, and a corresponding update to the writing prompt so it actually uses the rival context.

---

## Problem Diagnosis

### 1. The writing agent frames narratives in isolation
The Arsenal bottom line said City have "an improbable lifeline" because the research only showed Arsenal's table position (1st, 67 points) and baseline odds (83%). It never saw City's last four results (L, W, W, W including demolishing Liverpool and Chelsea). The writing agent treated the title race as a static table snapshot, not a dynamic momentum story.

### 2. Rival trajectory is the missing narrative dimension
Every positional race has two stories: "how is our team doing?" and "what are the rivals doing?" The current pipeline only answers the first question. A team can be performing identically week-on-week, but their narrative changes completely depending on whether their rival is surging or collapsing.

### 3. The writing prompt asks for rival framing but the research doesn't provide it
Line 392 of the existing writing prompt says: `"This is a TITLE analysis. Frame everything through the lens of maintaining/closing the gap, and rivals dropping points."` But the fact sheet contains zero information about the rival's form, results, or momentum. The writing agent is being asked to do something without the material to do it.

---

## Design: Rival Identification Logic

Rivals are identified automatically based on the `targetMetric` and current table position. This runs in `narrateAnalysis()` before the research phases.

```typescript
function identifyRivals(
  config: PathSearchConfig,
  teamName: string,
  targetTeam: string,
  position: number,
  points: number,
  gamesRemaining: number
): { name: string; abbr: string; reason: string }[] {
  const rivals: { name: string; abbr: string; reason: string }[] = [];

  if (config.targetMetric === 'championPct') {
    // Title race: find the team(s) closest in points within the top 3
    // Look at teams ranked 1-3 that are NOT the target team
    // Include any team within (gamesRemaining * 3) points of the leader
    const maxGap = gamesRemaining * 3;
    for (const team of config.teams) {
      if (team.abbr === targetTeam) continue;
      const teamPosition = getTeamPosition(team.abbr, config); // helper to get current position
      const teamPoints = getTeamPoints(team.abbr, config); // helper to get current points
      if (teamPosition <= 3 && Math.abs(teamPoints - points) <= maxGap) {
        rivals.push({
          name: team.name,
          abbr: team.abbr,
          reason: `Direct title rival — ${teamPosition}${ordinal(teamPosition)} on ${teamPoints} points`
        });
      }
    }
    // Cap at 2 rivals max for title races (it's almost always a 2-horse race)
    return rivals.slice(0, 2);
  }

  if (config.targetMetric === 'relegationPct') {
    // Relegation battle: find teams within 4 points above or below,
    // positioned between 15th-20th
    for (const team of config.teams) {
      if (team.abbr === targetTeam) continue;
      const teamPosition = getTeamPosition(team.abbr, config);
      const teamPoints = getTeamPoints(team.abbr, config);
      if (teamPosition >= 15 && teamPosition <= 20 && Math.abs(teamPoints - points) <= 4) {
        rivals.push({
          name: team.name,
          abbr: team.abbr,
          reason: `Relegation rival — ${teamPosition}${ordinal(teamPosition)} on ${teamPoints} points`
        });
      }
    }
    // Cap at 3 rivals for relegation (multiple teams typically involved)
    return rivals.slice(0, 3);
  }

  // European qualification (top4, top6, top7)
  // Find teams within 5 points, positioned around the target threshold
  const targetPosition = config.targetMetric === 'top4Pct' ? 4
    : config.targetMetric === 'top6Pct' ? 6 : 7;

  for (const team of config.teams) {
    if (team.abbr === targetTeam) continue;
    const teamPosition = getTeamPosition(team.abbr, config);
    const teamPoints = getTeamPoints(team.abbr, config);
    // Teams between 2 positions above and 2 below the target threshold
    if (teamPosition >= targetPosition - 2 && teamPosition <= targetPosition + 3
        && Math.abs(teamPoints - points) <= 6) {
      rivals.push({
        name: team.name,
        abbr: team.abbr,
        reason: `Competing for ${targetPosition}${ordinal(targetPosition)} — ${teamPosition}${ordinal(teamPosition)} on ${teamPoints} points`
      });
    }
  }
  return rivals.slice(0, 3);
}
```

> **Implementation note:** The helper functions `getTeamPosition()` and `getTeamPoints()` should pull from the standings data already available in `config`. If the standings aren't directly in `config`, they can be derived from the simulation's initial state. The exact implementation depends on where standings data lives — this spec defines the logic, not the data plumbing.

---

## Change 1: Add Rival Research Tier to `narrateAnalysis()`

After identifying tier 1 (deep) and tier 2 (light) teams, add a rival identification step:

```typescript
// ── Existing: Tier 1 (deep) and Tier 2 (light) team selection ──
// ... (as per claude-deepdive.md)

// ── NEW: Identify rivals for context ──
const rivals = identifyRivals(config, teamName, config.targetTeam, position, points, gamesRemaining);

// Filter out any rivals already covered in tier 1 or tier 2
const rivalTeams = rivals.filter(r =>
  !tier1Teams.has(r.name) && !tier2Teams.has(r.name)
);

// ── Phase A1: Deep research (decisive match teams) ──
const { factSheet: deepFactSheet, sources: deepSources, searchCount: deepCount } =
  await runResearchPhase(pathResult, config, teamName, [...tier1Teams], 'deep');

// ── NEW: Phase A1.5: Rival research ──
const { factSheet: rivalFactSheet, sources: rivalSources, searchCount: rivalCount } =
  rivalTeams.length > 0
    ? await runResearchPhase(pathResult, config, teamName, rivalTeams.map(r => r.name), 'rival', rivals)
    : { factSheet: '', sources: [], searchCount: 0 };

// ── Phase A2: Light research (matches-to-watch teams) ──
const { factSheet: lightFactSheet, sources: lightSources, searchCount: lightCount } =
  await runResearchPhase(pathResult, config, teamName, [...tier2Teams], 'light');

// Combine all fact sheets — rival context goes AFTER the deep research
// so the writing agent sees: target team + decisive match opponent + rivals + supporting fixtures
const combinedFactSheet = [deepFactSheet, rivalFactSheet, lightFactSheet].filter(Boolean).join('\n\n');
const allSources = [...deepSources, ...rivalSources, ...lightSources];
const totalSearchCount = deepCount + rivalCount + lightCount;
```

---

## Change 2: New Rival Research Prompt

Add `buildRivalResearchPrompt` alongside the existing deep and light prompts.

The rival prompt is focused on **form trajectory, recent results, and remaining fixture difficulty** — not tactical depth. We don't need to know how City press; we need to know they just demolished Liverpool 4-0 and Chelsea 3-0.

```typescript
function buildRivalResearchPrompt(
  teamName: string,
  rivalsToResearch: { name: string; abbr: string; reason: string }[],
  targetMetric: string
): string {
  const currentDate = new Date().toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric'
  });

  const rivalList = rivalsToResearch
    .map(r => `- ${r.name} (${r.reason})`)
    .join('\n');

  const objectiveContext = targetMetric === 'championPct'
    ? 'title race'
    : targetMetric === 'relegationPct'
      ? 'relegation battle'
      : 'European qualification race';

  return `You are a football research assistant investigating the RIVALS of ${teamName} in the ${objectiveContext}. The current date is ${currentDate}. The Premier League season is 2025-26.

## YOUR TASK
Research each rival's RECENT TRAJECTORY to provide comparative context for ${teamName}'s analysis. The goal is to answer: "While ${teamName} has been doing X, their rivals have been doing Y." This is about momentum and direction, not tactical detail.

## RIVALS TO RESEARCH
${rivalList}

## REQUIRED SEARCHES — RIVAL TIER
For EACH rival, perform these searches:

### 1. Recent form and results (2 searches per rival — MOST IMPORTANT)
1. "[rival] results April 2026" or "[rival] last 5 results 2026" — Get the ACTUAL SCORES of their last 4-6 matches. Include cup matches — they tell the form story. This is the single most important search.
2. "[rival] form run momentum 2025-26" — Are they surging, wobbling, or collapsing? Look for streak data, points-per-game over last 10 matches, any narrative about their trajectory.

### 2. Remaining fixtures (1 search per rival)
3. "[rival] remaining fixtures schedule 2025-26" — What's left? Is the run-in easy or brutal? Are there direct clashes with other rivals?

### 3. Key context (1 search per rival — if budget allows)
4. "[rival] injuries absences April 2026" — Any major absences that change their trajectory?

You have a budget of up to 12 searches. Prioritise searches 1-2 (form and results) above everything else — the recent results with actual scores are what the writing agent needs most.

## OUTPUT FORMAT
\`\`\`rival-context
RIVAL: [rival name]
ROLE IN RACE: [e.g. "Direct title rival — 2nd on 64 points, 3 behind Arsenal"]
LAST 6 RESULTS (MOST RECENT FIRST):
- [date or matchday] [opponent] [score] [competition] [H/A]
- [date or matchday] [opponent] [score] [competition] [H/A]
- ...
FORM TRAJECTORY: [1-2 sentences — are they surging, steady, or collapsing? How do the last 4-6 results compare to their season average?]
REMAINING FIXTURES: [List remaining PL fixtures if found, note difficulty]
KEY ABSENCES: [Current injuries/suspensions if found]
MOMENTUM NARRATIVE: [2-3 sentences capturing the rival's story ARC over the last month. This is the critical output — it should read like a pundit summary. E.g. "City have gone up a gear at exactly the moment Arsenal are wobbling — three consecutive wins including a 4-0 demolition of Liverpool and 3-0 at Chelsea suggest Guardiola's side have found their best form of the season at the business end."]
---
\`\`\`

Repeat for each rival.

## CRITICAL RULES
- Get ACTUAL SCORES with opponents. "Won 3-0 at Chelsea" tells a story. "W W W" does not.
- Include cup results — they are part of the form/momentum picture (a Carabao Cup final win or FA Cup exit shapes narrative).
- The MOMENTUM NARRATIVE is the most valuable output. It's what the writing agent will use to frame the comparative story. Make it specific and punchy.
- If you cannot find recent results, write "RESULTS NOT FOUND" — do NOT invent scores.
- Verify the rival's current points total and position — these change every gameweek.`;
}
```

---

## Change 3: Update `runResearchPhase` to Support Rival Tier

Extend the existing depth parameter and prompt selection:

```typescript
async function runResearchPhase(
  pathResult: PathSearchResult,
  config: PathSearchConfig,
  teamName: string,
  teamsToResearch: string[],
  depth: 'deep' | 'rival' | 'light' = 'deep',
  rivals?: { name: string; abbr: string; reason: string }[]
): Promise<{ factSheet: string; sources: string[]; searchCount: number }> {
  if (teamsToResearch.length === 0) {
    return { factSheet: '', sources: [], searchCount: 0 };
  }

  let systemPrompt: string;
  let maxRounds: number;

  switch (depth) {
    case 'deep':
      systemPrompt = buildDeepResearchPrompt(pathResult, config, teamName, teamsToResearch);
      maxRounds = 18;
      break;
    case 'rival':
      systemPrompt = buildRivalResearchPrompt(teamName, rivals ?? [], config.targetMetric);
      maxRounds = 8; // Rival research is focused — 3-4 searches per rival, 2-3 rivals max
      break;
    case 'light':
      systemPrompt = buildLightResearchPrompt(teamName, teamsToResearch);
      maxRounds = 10;
      break;
  }

  const conversation: OpenRouterMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: 'Research all the teams listed and build the fact sheet. Start searching now.' },
  ];

  // ... rest of the agentic search loop stays the same ...
}
```

---

## Change 4: Update the Writing Prompt to Use Rival Context

This is the critical change. The writing agent needs to know rival context exists in the fact sheet, and it needs explicit instructions on where and how to use it.

### 4A: Add rival context to the writing prompt preamble

In `buildWritingPrompt()`, after the `## VERIFIED FACT SHEET` section, add:

```typescript
const rivalContextSection = rivals.length > 0
  ? `
## RIVAL CONTEXT (USE THIS)
The fact sheet contains a "rival-context" section with recent form, results, and momentum narratives for ${teamName}'s direct rivals in this ${objectiveContext}. This is ESSENTIAL context for your analysis.

Rivals identified: ${rivals.map(r => `${r.name} (${r.reason})`).join(', ')}

You MUST use this rival context in at least two places:
1. **contextNarrative (State of Play)**: The story of ${teamName}'s season is incomplete without the rival trajectory. If ${teamName} is wobbling while their rival surges (or vice versa), THAT is the story — not just ${teamName}'s form in isolation.
2. **bottomLine summary**: The central tension of any positional race is comparative. "Arsenal are folding at the exact moment City are surging" is a fundamentally different story from "Arsenal have lost three of four." Frame the bottom line as a two-sided narrative when the rival context supports it.

You may also reference rivals in:
- **matchesToWatch**: When a rival's fixture appears in the sensitivity data, the "whyItsPlausible" should reference the rival's current form from the rival-context section.
- **keyScenario**: If the optimal path depends on a rival dropping points, name the rival and acknowledge whether that's likely given their trajectory.

DO NOT just append rival info as an afterthought. Weave it into the narrative. The best analyses make the reader feel the competitive tension between teams, not just the target team's situation in a vacuum.
`
  : '';
```

### 4B: Update the objective-type framing (line 392)

Replace the existing line 392 conditional with richer rival-aware instructions:

```typescript
const objectiveFraming = isRelegation
  ? `This is a RELEGATION analysis. Frame everything through survival — but survival is RELATIVE. If ${teamName}'s rivals in the drop zone are also losing, the picture is less dire than if rivals are picking up points while ${teamName} stalls. Use the rival context to calibrate the urgency: are the teams around them pulling away, or are they all drowning together?`
  : isChampion
    ? `This is a TITLE analysis. The title race is ALWAYS a two-team (or three-team) story. Use the rival context to frame whether ${teamName}'s current form represents a growing advantage, a narrowing gap, or a collapsing lead. "Still top of the table" means something very different if the rival has won 6 straight versus lost 3 of 4. The TRAJECTORY COMPARISON is the story.`
    : `This is a EUROPEAN QUALIFICATION analysis. Frame everything through the lens of climbing the table — but climbing requires others to slip. Use the rival context to assess whether the teams above ${teamName} are vulnerable or pulling away. If a rival is wobbling, name it and explain why that opens a door.`;
```

### 4C: Update the bottomLine instructions

Replace the existing bottomLine guidance with:

```
### Good "bottomLine"
- "summary": 2-3 sentences. A pundit wrapping up the segment. Name the central tension — and if rival context is available, the tension should be COMPARATIVE.

GOOD (with rival context): "Arsenal's title challenge has reached the point where form matters more than the table — and the form tells a terrifying story. Three defeats in four matches, including a cup final loss to City and a home defeat to Bournemouth, would be concerning in isolation. But it's City's simultaneous surge — demolishing Liverpool 4-0, winning 3-0 at Chelsea, and beating Arsenal themselves in the Carabao Cup final — that transforms a wobble into a crisis. The gap is still three points in Arsenal's favour, but the momentum has inverted completely."

BAD (without rival context): "Arsenal's title challenge has reached the stage where the maths is overwhelmingly in their favour but the football is sending warning signals. Consecutive defeats suggest the strain of a three-front campaign is beginning to tell. The next three weeks will determine whether Arteta's squad can close this out, or whether the wobble becomes a collapse that hands Man City an improbable lifeline."

The BAD example treats the title race as Arsenal's story alone. The word "improbable" reveals the writer doesn't know what City have been doing. The GOOD example makes the reader feel the momentum shift because it names specific City results.

- "keyScenario": ONE concrete sentence. If a rival's trajectory makes a scenario more/less plausible, acknowledge it. ("If Arsenal beat Fulham and win at the Etihad their title probability reaches 99.9% — but City's current four-match winning run, including a 4-0 demolition of Liverpool, suggests that Etihad trip is no longer the formality it looked a month ago.")
```

---

## Change 5: Pass Rivals to the Writing Phase

The `rivals` array needs to be passed through to `buildWritingPrompt()` so the rival context instructions can reference the specific rival names.

```typescript
// In narrateAnalysis(), update the writing phase call:
const analysis = await runWritingPhase(
  pathResult, config, teamName, position, points, gapToTarget, gamesRemaining,
  combinedFactSheet,
  rivals // NEW parameter
);

// In runWritingPhase(), pass rivals to the prompt builder:
function runWritingPhase(
  pathResult: PathSearchResult,
  config: PathSearchConfig,
  teamName: string,
  position: number,
  points: number,
  gapToTarget: number,
  gamesRemaining: number,
  factSheet: string,
  rivals: { name: string; abbr: string; reason: string }[] = [] // NEW
) {
  const prompt = buildWritingPrompt(
    pathResult, config, teamName, position, points,
    gapToTarget, gamesRemaining, factSheet, rivals // NEW
  );
  // ... rest stays the same
}
```

---

## Search Budget Impact

| Tier | Searches per team | Typical teams | Budget |
|------|------------------|---------------|--------|
| Deep (decisive match) | 10-12 | 2-3 teams | 20-35 |
| **Rival (NEW)** | **3-4** | **1-3 teams** | **3-12** |
| Light (matches to watch) | 2-3 | 3-5 teams | 6-15 |
| **Total** | | | **29-62** |

The rival tier adds 3-12 searches depending on the number of rivals. This is a modest increase — the rival searches are highly focused (recent results + form trajectory), not the broad tactical research of the deep tier. Total budget should stay within the existing 25-65 range established by the deep + light tiers.

---

## When Rivals Are NOT Added

The rival identification returns an empty array (and the rival research phase is skipped entirely) when:

- **Mid-table with no objective pressure**: A team sitting 10th with no realistic path to Europe and no relegation risk has no meaningful rivals. The `identifyRivals` function returns nothing because no team within range is competing for the same positional threshold.
- **Dominant leader**: If a team is 15+ points clear, there's no active title rival. The function's gap check (`Math.abs(teamPoints - points) <= maxGap`) filters this out.
- **Already researched**: If the rival is already in tier 1 (decisive match opponent) or tier 2 (matches-to-watch), it's filtered out to avoid duplicate research.

---

## Quality Checklist (After Implementation)

Run Deep Analysis for these test cases and verify:

### Test 1: Arsenal (title race)
- [ ] Rival context section appears in the fact sheet for Man City
- [ ] City's last 4-6 results with actual scores are present
- [ ] contextNarrative references City's trajectory, not just Arsenal's form
- [ ] bottomLine frames the title race as a comparative momentum story
- [ ] The word "improbable" does NOT appear when City are on a winning run

### Test 2: Tottenham (relegation battle)
- [ ] Rival context appears for 1-3 of: West Ham, Ipswich, Forest, Leicester (whoever is in the zone)
- [ ] bottomLine references whether rival results are helping or hurting Spurs
- [ ] keyScenario acknowledges rival form when assessing plausibility

### Test 3: Newcastle (European qualification)
- [ ] Rival context appears for teams around 7th (Brentford, Everton, Villa, etc.)
- [ ] contextNarrative acknowledges whether the teams above are pulling away or are catchable
- [ ] If rivals are also struggling, the tone should reflect that the door is open — not just that Newcastle are far behind

### Test 4: Mid-table team with nothing to play for (e.g., Fulham)
- [ ] No rival context section appears (correct — no rivals identified)
- [ ] Report functions normally without rival data
- [ ] No errors from empty rivals array

---

## Summary of All Changes

| # | Area | What Changes | Why |
|---|------|-------------|-----|
| 1 | `narrateAnalysis()` | Add rival identification + rival research phase between deep and light | Provide comparative context to the writing agent |
| 2 | New function | `buildRivalResearchPrompt()` — focused on form trajectory, recent scores, momentum | The writing agent needs to know what rivals are DOING, not how they play tactically |
| 3 | `runResearchPhase()` | Add `'rival'` depth option with 8 max rounds | Support the new tier |
| 4 | `buildWritingPrompt()` | Add rival context instructions, update objective framing, rewrite bottomLine guidance with good/bad examples | Tell the writing agent WHERE and HOW to use rival data |
| 5 | `runWritingPhase()` | Pass `rivals` array through to prompt builder | Writing prompt needs rival names for its instructions |
