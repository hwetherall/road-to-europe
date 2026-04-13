import { NextRequest, NextResponse } from 'next/server';
import { pathSearch } from '@/lib/path-search';
import {
  createDeepAnalysisScenarioKey,
  getCachedDeepAnalysis,
  isDeepAnalysisCacheConfigured,
  upsertDeepAnalysisCache,
} from '@/lib/deep-analysis-cache';
import {
  Team,
  Fixture,
  PathSearchConfig,
  PathSearchResult,
  DeepAnalysis,
  SensitivityResult,
  CandidatePath,
} from '@/lib/types';
import { executeWebSearch } from '@/lib/web-search';
import {
  callOpenRouter,
  OpenRouterMessage,
  OpenRouterError,
  OpenRouterTool,
} from '@/lib/openrouter';
import {
  getInjuriesForClubs,
  formatInjuriesForPrompt,
  isInjuryDataConfigured,
  InjuryRecord,
} from '@/lib/injuries';

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

const TOOLS: OpenRouterTool[] = [
  {
    type: 'function',
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

// ── Narrative Agent ──

function formatOptimalPath(path: CandidatePath): string {
  return path.locks
    .map(
      (l) =>
        `  - ${l.homeTeam} vs ${l.awayTeam}: ${l.resultLabel} (${(l.individualPlausibility * 100).toFixed(0)}% likely)`
    )
    .join('\n');
}

function formatPlausibilityPercent(value: number): string {
  const pct = value * 100;
  if (pct === 0) return '0.0%';
  if (pct < 0.1) return '<0.1%';
  return `${pct.toFixed(1)}%`;
}

function formatCandidatePath(path: CandidatePath, index: number): string {
  return `Path ${index + 1} (plausibility: ${formatPlausibilityPercent(path.compositePlausibility)}, resulting odds: ${path.resultingOdds.toFixed(1)}%):
${path.locks.map((l) => `  - ${l.homeTeam} vs ${l.awayTeam}: ${l.resultLabel}`).join('\n')}`;
}

function getTeamStatusLabel(position: number): string {
  if (position <= 1) return 'title race';
  if (position <= 4) return 'Champions League contender';
  if (position <= 7) return 'European contender';
  if (position <= 14) return 'mid-table';
  if (position <= 17) return 'relegation threatened';
  return 'relegation zone';
}

function formatSensitivity(s: SensitivityResult, sortedTeams?: Team[]): string {
  const best = Math.max(s.deltaIfHomeWin, s.deltaIfDraw, s.deltaIfAwayWin);
  const worst = Math.min(s.deltaIfHomeWin, s.deltaIfDraw, s.deltaIfAwayWin);

  if (!sortedTeams) {
    return `  ${s.homeTeam} vs ${s.awayTeam}: best +${best.toFixed(1)}pp / worst ${worst.toFixed(1)}pp`;
  }

  const homeIdx = sortedTeams.findIndex(t => t.abbr === s.homeTeam);
  const awayIdx = sortedTeams.findIndex(t => t.abbr === s.awayTeam);
  const homePos = homeIdx >= 0 ? homeIdx + 1 : null;
  const awayPos = awayIdx >= 0 ? awayIdx + 1 : null;
  const homePts = homePos ? sortedTeams[homeIdx].points : null;
  const awayPts = awayPos ? sortedTeams[awayIdx].points : null;
  const homeLabel = homePos ? getTeamStatusLabel(homePos) : '';
  const awayLabel = awayPos ? getTeamStatusLabel(awayPos) : '';

  return `  ${s.homeTeam} (${homePos ? `${homePos}th, ${homePts}pts, ${homeLabel}` : 'unknown'}) vs ${s.awayTeam} (${awayPos ? `${awayPos}th, ${awayPts}pts, ${awayLabel}` : 'unknown'}): best +${best.toFixed(1)}pp / worst ${worst.toFixed(1)}pp`;
}

function formatStandingsTable(sortedTeams: Team[]): string {
  const header = 'Pos | Team | Pts | GD | P | W | D | L';
  const separator = '--- | ---- | --- | -- | - | - | - | -';
  const rows = sortedTeams.map((t, i) => {
    const pos = i + 1;
    const label = getTeamStatusLabel(pos);
    return `${pos} | ${t.name} (${t.abbr}) | ${t.points} | ${t.goalDifference >= 0 ? '+' : ''}${t.goalDifference} | ${t.played} | ${t.won} | ${t.drawn} | ${t.lost} | ${label}`;
  });
  return [header, separator, ...rows].join('\n');
}

// ── Two-Phase Narrative Pipeline ──
// Phase A: Research agent builds a verified fact sheet via web searches
// Phase B: Writing agent composes the analysis using ONLY facts from the sheet

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
3. "[team] injuries suspensions ${currentDate.split(' ').slice(1).join(' ')}" — who is currently OUT? **SKIP this search if PRE-LOADED INJURY DATA is provided below — use that data directly instead.**

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
2. "[team] injuries key absences 2026" — who's missing? **SKIP this search if PRE-LOADED INJURY DATA is provided below — use that data directly instead.**
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
4. "[rival] injuries absences April 2026" — Any major absences that change their trajectory? **SKIP this search if PRE-LOADED INJURY DATA is provided below — use that data directly instead.**

You have a budget of up to 12 searches. Prioritise searches 1-2 (form and results) above everything else — the recent results with actual scores are what the writing agent needs most.

## OUTPUT FORMAT
\`\`\`factsheet
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

function buildWritingPrompt(
  pathResult: PathSearchResult,
  config: PathSearchConfig,
  teamName: string,
  position: number,
  points: number,
  gapToTarget: number,
  gamesRemaining: number,
  factSheet: string,
  sortedTeams: Team[],
  rivals: { name: string; abbr: string; reason: string }[] = []
): string {
  const isRelegation = config.targetMetric === 'relegationPct';
  const isChampion = config.targetMetric === 'championPct';
  const objectiveLabel = isChampion
    ? 'winning the league title'
    : isRelegation
      ? 'avoiding relegation'
      : 'qualifying for Europe';

  const objectiveContext = isChampion
    ? 'title race'
    : isRelegation
      ? 'relegation battle'
      : 'European qualification race';

  // Get the decisive match info
  const decisive = pathResult.sensitivityData[0];
  const decisiveHome = decisive?.homeTeam ?? '';
  const decisiveAway = decisive?.awayTeam ?? '';

  return `You are Keepwatch's Deep Analysis writer. You produce a narrative-rich analysis document about ${teamName}'s chances of ${objectiveLabel}. Your output should read like a Monday Night Football deep-dive segment: specific, data-informed, occasionally surprising.

## YOUR HARD CONSTRAINT
You have been given a VERIFIED FACT SHEET from a research agent. You may ONLY reference facts that appear in this fact sheet. If a player, manager, tactic, or stat is not in the fact sheet, do NOT mention them. If the fact sheet says "UNVERIFIED" for something, do not reference it. This is non-negotiable — accuracy over eloquence.

## VERIFIED FACT SHEET
${factSheet}
${rivals.length > 0 ? `
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
` : ''}
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

## FULL LEAGUE STANDINGS (use this to verify team motivations)
${formatStandingsTable(sortedTeams)}

Top sensitivity fixtures (NOTE: sensitivity measures impact on ${teamName}'s odds, NOT the competitiveness of the fixture — a one-sided match can still be high-leverage):
${pathResult.sensitivityData.slice(0, 10).map(s => formatSensitivity(s, sortedTeams)).join('\n')}

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
Frame each match from ${teamName}'s perspective. A fan of ${teamName} should understand why they need to care about a match they're not even playing in. Note: matchesToWatch CAN include ${teamName}'s own fixtures when they appear in the sensitivity data as high-leverage — it doesn't have to be exclusively other people's matches.

For each match:
- "whyItMatters": 2-3 sentences. Start with the simulation impact in plain language, then explain the football logic. ("The biggest external swing fixture — if Arsenal beat West Ham, it drags a direct relegation rival further into trouble, shifting Spurs' odds by +14.5pp.")
- "whyItsPlausible": 2-3 sentences grounded in fact sheet data about both teams. ("Arsenal are runaway league leaders with 70 points and a W9 D5 L2 away record. West Ham's home form is dismal at W3 D3 L8.")
- "idealResult": Name the result clearly. ("Arsenal win.")
- "simulationImpact": Use the format "+Xpp" from the sensitivity data.

Produce 3-4 matches to watch. Include a MIX: some should be the target team's own fixtures (if they appear in the sensitivity data), some should be rival fixtures.

### Good "bottomLine"
- "summary": 2-3 sentences. A pundit wrapping up the segment. Name the central tension — and if rival context is available, the tension should be COMPARATIVE.

GOOD (with rival context): "Arsenal's title challenge has reached the point where form matters more than the table — and the form tells a terrifying story. Three defeats in four matches, including a cup final loss to City and a home defeat to Bournemouth, would be concerning in isolation. But it's City's simultaneous surge — demolishing Liverpool 4-0, winning 3-0 at Chelsea, and beating Arsenal themselves in the Carabao Cup final — that transforms a wobble into a crisis. The gap is still three points in Arsenal's favour, but the momentum has inverted completely."

BAD (without rival context): "Arsenal's title challenge has reached the stage where the maths is overwhelmingly in their favour but the football is sending warning signals. Consecutive defeats suggest the strain of a three-front campaign is beginning to tell. The next three weeks will determine whether Arteta's squad can close this out, or whether the wobble becomes a collapse that hands Man City an improbable lifeline."

The BAD example treats the title race as one team's story alone. The word "improbable" reveals the writer doesn't know what the rival has been doing. The GOOD example makes the reader feel the momentum shift because it names specific rival results.

- "keyScenario": ONE concrete sentence. If a rival's trajectory makes a scenario more/less plausible, acknowledge it. ("If Arsenal beat Fulham and win at the Etihad their title probability reaches 99.9% — but City's current four-match winning run, including a 4-0 demolition of Liverpool, suggests that Etihad trip is no longer the formality it looked a month ago.")

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
6. ${isRelegation ? `This is a RELEGATION analysis. Frame everything through survival — but survival is RELATIVE. If ${teamName}'s rivals in the drop zone are also losing, the picture is less dire than if rivals are picking up points while ${teamName} stalls. Use the rival context to calibrate the urgency: are the teams around them pulling away, or are they all drowning together?` : isChampion ? `This is a TITLE analysis. The title race is ALWAYS a two-team (or three-team) story. Use the rival context to frame whether ${teamName}'s current form represents a growing advantage, a narrowing gap, or a collapsing lead. "Still top of the table" means something very different if the rival has won 6 straight versus lost 3 of 4. The TRAJECTORY COMPARISON is the story.` : `This is a EUROPEAN QUALIFICATION analysis. Frame everything through the lens of climbing the table — but climbing requires others to slip. Use the rival context to assess whether the teams above ${teamName} are vulnerable or pulling away. If a rival is wobbling, name it and explain why that opens a door.`}
7. NEVER duplicate fixtures in matchesToWatch. Each fixture must appear EXACTLY ONCE. If you find yourself listing the same matchup twice, remove the duplicate. Produce exactly 3-4 UNIQUE matches.
7. VERIFY TEAM MOTIVATIONS AGAINST THE STANDINGS TABLE. Before claiming a team is "in the European race", "fighting for the title", "battling relegation", or has any competitive motivation, CHECK their actual league position in the standings table above. A 17th-placed team is NOT in a European race. A 3rd-placed team is NOT in a relegation battle. Get this right — it destroys credibility when you get it wrong.
8. SENSITIVITY ≠ COMPETITIVENESS. A fixture appearing in the sensitivity data means its result significantly affects ${teamName}'s odds — it does NOT mean the fixture is closely matched or competitive. A dominant favourite beating a bottom-half team can be high-leverage. Do not describe a fixture as "competitive" or "closely contested" based solely on its presence in sensitivity data. Check the standings and form data to make actual competitiveness claims.`;
}

async function runResearchPhase(
  pathResult: PathSearchResult,
  config: PathSearchConfig,
  teamName: string,
  teamsToResearch: string[],
  depth: 'deep' | 'rival' | 'light' = 'deep',
  rivals?: { name: string; abbr: string; reason: string }[],
  injuryMap?: Record<string, InjuryRecord[]>
): Promise<{ factSheet: string; sources: string[]; searchCount: number }> {
  if (teamsToResearch.length === 0) {
    return { factSheet: '', sources: [], searchCount: 0 };
  }

  // Build pre-loaded injury block from Supabase data
  let injuryBlock = '';
  if (injuryMap && Object.keys(injuryMap).length > 0) {
    const sections: string[] = [];
    for (const teamNameEntry of teamsToResearch) {
      const teamObj = config.teams.find(t => t.name === teamNameEntry);
      if (!teamObj) continue;
      const injuries = injuryMap[teamObj.abbr.toUpperCase()];
      if (injuries) {
        sections.push(formatInjuriesForPrompt(injuries, teamNameEntry));
      }
    }
    if (sections.length > 0) {
      injuryBlock = `\n\n## PRE-LOADED INJURY DATA (from premierinjuries.com — scraped today)\nThe following injury/availability data has been pre-fetched from a verified database. Do NOT search for injuries — use this data directly and copy it into the INJURIES/SUSPENSIONS field of your fact sheet.\n\n${sections.join('\n\n')}`;
    }
  }

  let systemPrompt: string;
  let maxRounds: number;

  switch (depth) {
    case 'deep':
      systemPrompt = buildDeepResearchPrompt(pathResult, config, teamName, teamsToResearch) + injuryBlock;
      maxRounds = 18;
      break;
    case 'rival':
      systemPrompt = buildRivalResearchPrompt(teamName, rivals ?? [], config.targetMetric) + injuryBlock;
      maxRounds = 8;
      break;
    case 'light':
      systemPrompt = buildLightResearchPrompt(teamName, teamsToResearch) + injuryBlock;
      maxRounds = 10;
      break;
  }

  const conversation: OpenRouterMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `Research all the teams listed and build the fact sheet. Start searching now.` },
  ];

  const sources: string[] = [];
  let searchCount = 0;
  const MAX_ROUNDS = maxRounds;

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const message = await callOpenRouter(conversation, { tools: TOOLS });

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
  const finalMsg = await callOpenRouter(conversation);
  const content = finalMsg.content ?? '';
  const factMatch = content.match(/```factsheet\s*([\s\S]*?)```/);
  return { factSheet: factMatch ? factMatch[1].trim() : content, sources, searchCount };
}

// ── Deterministic Post-Generation Validation ──
// Checks the generated analysis against hard facts (standings, sensitivity data)
// and returns specific violations that can be used to request corrections.

interface ValidationViolation {
  field: string;       // JSON path to the problematic field
  claim: string;       // What the text claims
  reality: string;     // What the data actually says
  severity: 'high' | 'medium';
}

const MOTIVATION_PATTERNS: { pattern: RegExp; minPos?: number; maxPos?: number; label: string }[] = [
  { pattern: /\b(?:European|Europa|Champions League|UCL|Conference League)\s*(?:race|push|chase|contend|hunt|bid|ambition|qualification|spot|place)/i, maxPos: 10, label: 'European contention' },
  { pattern: /\b(?:title|championship)\s*(?:race|push|chase|contend|hunt|bid|ambition|challenge)/i, maxPos: 5, label: 'title contention' },
  { pattern: /\b(?:relegation|survival|drop|go down)\s*(?:battle|fight|scrap|threat|danger|fear|risk)/i, minPos: 12, label: 'relegation battle' },
  { pattern: /\bnothing to play for\b/i, minPos: 8, maxPos: 17, label: 'nothing to play for' },
];

function validateAnalysis(
  analysis: Partial<DeepAnalysis>,
  sortedTeams: Team[],
  sensitivityData: SensitivityResult[]
): ValidationViolation[] {
  const violations: ValidationViolation[] = [];

  // Build a lookup: abbr → position
  const positionMap = new Map<string, number>();
  const nameToAbbr = new Map<string, string>();
  sortedTeams.forEach((t, i) => {
    positionMap.set(t.abbr, i + 1);
    positionMap.set(t.name.toLowerCase(), i + 1);
    nameToAbbr.set(t.name.toLowerCase(), t.abbr);
  });

  // Collect all text fields from the analysis to scan
  const textFields: { path: string; text: string }[] = [];

  if (analysis.stateOfPlay?.contextNarrative) {
    textFields.push({ path: 'stateOfPlay.contextNarrative', text: analysis.stateOfPlay.contextNarrative });
  }
  if (analysis.decisiveMatch?.risks) {
    analysis.decisiveMatch.risks.forEach((r, i) => {
      textFields.push({ path: `decisiveMatch.risks[${i}]`, text: r });
    });
  }
  if (analysis.decisiveMatch?.angles) {
    analysis.decisiveMatch.angles.forEach((a, i) => {
      textFields.push({ path: `decisiveMatch.angles[${i}]`, text: `${a.title} ${a.analysis}` });
    });
  }
  if (analysis.decisiveMatch?.whatToWatch) {
    analysis.decisiveMatch.whatToWatch.forEach((w, i) => {
      textFields.push({ path: `decisiveMatch.whatToWatch[${i}]`, text: w });
    });
  }
  if (analysis.matchesToWatch) {
    analysis.matchesToWatch.forEach((m, i) => {
      textFields.push({ path: `matchesToWatch[${i}].whyItMatters`, text: m.whyItMatters });
      textFields.push({ path: `matchesToWatch[${i}].whyItsPlausible`, text: m.whyItsPlausible });
    });
  }
  if (analysis.bottomLine) {
    textFields.push({ path: 'bottomLine.summary', text: analysis.bottomLine.summary });
    textFields.push({ path: 'bottomLine.keyScenario', text: analysis.bottomLine.keyScenario });
  }

  // Check each text field for motivation claims that don't match standings
  for (const { path, text } of textFields) {
    // For each team name found in the text, check motivation claims
    for (const team of sortedTeams) {
      const teamNameLower = team.name.toLowerCase();
      const textLower = text.toLowerCase();

      // Only check if this team is actually mentioned in this text
      if (!textLower.includes(teamNameLower) && !textLower.includes(team.abbr.toLowerCase())) {
        continue;
      }

      const teamPos = positionMap.get(team.abbr) ?? 99;

      for (const mp of MOTIVATION_PATTERNS) {
        if (!mp.pattern.test(text)) continue;

        // Check if the motivation claim is near the team mention (within ~200 chars)
        const teamIdx = Math.max(
          textLower.indexOf(teamNameLower),
          textLower.indexOf(team.abbr.toLowerCase())
        );
        const patternMatch = text.match(mp.pattern);
        if (!patternMatch) continue;
        const patternIdx = text.indexOf(patternMatch[0]);
        if (Math.abs(teamIdx - patternIdx) > 200) continue;

        // Check if position is plausible for this claim
        if (mp.maxPos && teamPos > mp.maxPos) {
          violations.push({
            field: path,
            claim: `${team.name} described as being in ${mp.label}`,
            reality: `${team.name} are actually ${teamPos}th in the table with ${team.points} points — ${mp.label} is not a credible description of their situation`,
            severity: 'high',
          });
        }
        if (mp.minPos && teamPos < mp.minPos) {
          violations.push({
            field: path,
            claim: `${team.name} described as being in ${mp.label}`,
            reality: `${team.name} are actually ${teamPos}th in the table with ${team.points} points — ${mp.label} is not a credible description of their situation`,
            severity: 'high',
          });
        }
      }
    }
  }

  // Check matchesToWatch simulation impact values against actual sensitivity data
  if (analysis.matchesToWatch) {
    for (let i = 0; i < analysis.matchesToWatch.length; i++) {
      const match = analysis.matchesToWatch[i];
      const sensEntry = sensitivityData.find(s => s.fixtureId === match.fixtureId);

      if (sensEntry && match.simulationImpact) {
        // Parse the claimed impact (e.g., "+4.2pp" or "-3.1pp")
        const claimedMatch = match.simulationImpact.match(/([+-]?\d+\.?\d*)\s*pp/);
        if (claimedMatch) {
          const claimedValue = parseFloat(claimedMatch[1]);
          const actualMax = Math.max(
            Math.abs(sensEntry.deltaIfHomeWin),
            Math.abs(sensEntry.deltaIfDraw),
            Math.abs(sensEntry.deltaIfAwayWin)
          );
          // Allow some rounding tolerance but flag large discrepancies
          if (Math.abs(Math.abs(claimedValue) - actualMax) > 2.0) {
            violations.push({
              field: `matchesToWatch[${i}].simulationImpact`,
              claim: `Simulation impact stated as ${match.simulationImpact}`,
              reality: `Actual max sensitivity delta is ${actualMax.toFixed(1)}pp (home: ${sensEntry.deltaIfHomeWin.toFixed(1)}, draw: ${sensEntry.deltaIfDraw.toFixed(1)}, away: ${sensEntry.deltaIfAwayWin.toFixed(1)})`,
              severity: 'medium',
            });
          }
        }
      }
    }
  }

  return violations;
}

async function runWritingPhase(
  pathResult: PathSearchResult,
  config: PathSearchConfig,
  teamName: string,
  position: number,
  points: number,
  gapToTarget: number,
  gamesRemaining: number,
  factSheet: string,
  sortedTeams: Team[],
  rivals: { name: string; abbr: string; reason: string }[] = []
): Promise<Partial<DeepAnalysis>> {
  const systemPrompt = buildWritingPrompt(
    pathResult, config, teamName, position, points, gapToTarget, gamesRemaining, factSheet, sortedTeams, rivals
  );

  const conversation: OpenRouterMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `Write the Deep Analysis JSON for ${teamName}. Use ONLY facts from the fact sheet. Do not invent any names or claims.` },
  ];

  const message = await callOpenRouter(conversation, { maxTokens: 80000 });
  const content = message.content ?? '';

  // Parse JSON
  let analysis: Partial<DeepAnalysis> | null = null;
  const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/);
  if (jsonMatch) {
    try {
      analysis = JSON.parse(jsonMatch[1]);
    } catch (e) {
      console.error('Failed to parse writing phase JSON:', e);
    }
  }

  // Fallback: find any JSON object
  if (!analysis) {
    const fallbackMatch = content.match(/\{[\s\S]*\}/);
    if (fallbackMatch) {
      try {
        analysis = JSON.parse(fallbackMatch[0]);
      } catch {
        // give up
      }
    }
  }

  if (!analysis) return {};

  // ── Deduplicate matchesToWatch ──
  if (analysis.matchesToWatch && Array.isArray(analysis.matchesToWatch)) {
    const seen = new Set<string>();
    analysis.matchesToWatch = analysis.matchesToWatch.filter((m) => {
      const key = m.fixtureId
        ? m.fixtureId
        : `${m.homeTeam}:${m.awayTeam}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  // ── Post-generation validation ──
  const violations = validateAnalysis(analysis, sortedTeams, pathResult.sensitivityData);
  const highSeverity = violations.filter(v => v.severity === 'high');

  if (highSeverity.length > 0) {
    console.log(`[Deep Analysis] Found ${highSeverity.length} high-severity violations, requesting corrections`);

    // Build a correction prompt with specific violations
    const correctionList = highSeverity.map((v, i) =>
      `${i + 1}. In "${v.field}": You wrote that ${v.claim}. CORRECTION: ${v.reality}. Rewrite this section to fix the error.`
    ).join('\n');

    conversation.push(message);
    conversation.push({
      role: 'user',
      content: `Your analysis contains factual errors that contradict the league standings. Fix ONLY these specific errors and return the complete corrected JSON. Do not change anything else.\n\n${correctionList}\n\nReturn the corrected full JSON wrapped in \`\`\`json blocks.`,
    });

    const correctedMessage = await callOpenRouter(conversation, { maxTokens: 80000 });
    const correctedContent = correctedMessage.content ?? '';

    const correctedMatch = correctedContent.match(/```json\s*([\s\S]*?)\s*```/);
    if (correctedMatch) {
      try {
        const corrected = JSON.parse(correctedMatch[1]);
        // Validate again — if still bad, use it anyway (one retry max)
        const remainingViolations = validateAnalysis(corrected, sortedTeams, pathResult.sensitivityData);
        if (remainingViolations.filter(v => v.severity === 'high').length > 0) {
          console.log(`[Deep Analysis] ${remainingViolations.filter(v => v.severity === 'high').length} violations remain after correction — using corrected version anyway`);
        }
        return corrected;
      } catch {
        console.error('[Deep Analysis] Failed to parse corrected JSON, using original');
      }
    }
  }

  return analysis;
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function identifyRivals(
  config: PathSearchConfig,
  teamName: string,
  targetTeam: string,
  position: number,
  points: number,
  gamesRemaining: number,
  sortedTeams: Team[]
): { name: string; abbr: string; reason: string }[] {
  const rivals: { name: string; abbr: string; reason: string }[] = [];

  const getPos = (abbr: string) => sortedTeams.findIndex(t => t.abbr === abbr) + 1;
  const getPts = (abbr: string) => sortedTeams.find(t => t.abbr === abbr)?.points ?? 0;

  if (config.targetMetric === 'championPct') {
    const maxGap = gamesRemaining * 3;
    for (const team of config.teams) {
      if (team.abbr === targetTeam) continue;
      const teamPosition = getPos(team.abbr);
      const teamPoints = getPts(team.abbr);
      if (teamPosition <= 3 && Math.abs(teamPoints - points) <= maxGap) {
        rivals.push({
          name: team.name,
          abbr: team.abbr,
          reason: `Direct title rival — ${ordinal(teamPosition)} on ${teamPoints} points`,
        });
      }
    }
    return rivals.slice(0, 2);
  }

  if (config.targetMetric === 'relegationPct') {
    for (const team of config.teams) {
      if (team.abbr === targetTeam) continue;
      const teamPosition = getPos(team.abbr);
      const teamPoints = getPts(team.abbr);
      if (teamPosition >= 15 && teamPosition <= 20 && Math.abs(teamPoints - points) <= 4) {
        rivals.push({
          name: team.name,
          abbr: team.abbr,
          reason: `Relegation rival — ${ordinal(teamPosition)} on ${teamPoints} points`,
        });
      }
    }
    return rivals.slice(0, 3);
  }

  // European qualification (top4, top5, top6, top7)
  const targetPosition = config.targetMetric === 'top4Pct' ? 4
    : config.targetMetric === 'top6Pct' ? 6 : 7;

  for (const team of config.teams) {
    if (team.abbr === targetTeam) continue;
    const teamPosition = getPos(team.abbr);
    const teamPoints = getPts(team.abbr);
    if (teamPosition >= targetPosition - 2 && teamPosition <= targetPosition + 3
        && Math.abs(teamPoints - points) <= 6) {
      rivals.push({
        name: team.name,
        abbr: team.abbr,
        reason: `Competing for ${ordinal(targetPosition)} — ${ordinal(teamPosition)} on ${teamPoints} points`,
      });
    }
  }
  return rivals.slice(0, 3);
}

async function narrateAnalysis(
  pathResult: PathSearchResult,
  config: PathSearchConfig,
  teamName: string,
  position: number,
  points: number,
  gapToTarget: number,
  gamesRemaining: number,
  sortedTeams: Team[]
): Promise<{ analysis: Partial<DeepAnalysis>; sources: string[]; searchCount: number }> {
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

  // ── Identify rivals for comparative context ──
  const rivals = identifyRivals(config, teamName, config.targetTeam, position, points, gamesRemaining, sortedTeams);
  const rivalTeams = rivals.filter(r =>
    !tier1Teams.has(r.name) && !tier2Teams.has(r.name)
  );

  // ── Pre-fetch injury data from Supabase for all teams ──
  // One batch query replaces ~10+ unreliable web searches across all tiers
  let injuryMap: Record<string, InjuryRecord[]> = {};
  if (isInjuryDataConfigured()) {
    const allTeamNames = new Set([...tier1Teams, ...tier2Teams, ...rivalTeams.map(r => r.name)]);
    const allAbbrs = [...allTeamNames]
      .map(name => config.teams.find(t => t.name === name)?.abbr)
      .filter((a): a is string => !!a);
    injuryMap = await getInjuriesForClubs(allAbbrs);
    console.log(`[Deep Analysis] Pre-fetched injury data for ${Object.keys(injuryMap).length} clubs`);
  }

  // Phase A1: Deep research on decisive match teams (10-12 searches per team)
  const { factSheet: deepFactSheet, sources: deepSources, searchCount: deepCount } =
    await runResearchPhase(pathResult, config, teamName, [...tier1Teams], 'deep', undefined, injuryMap);

  // Phase A1.5: Rival research (form trajectory + recent results)
  const { factSheet: rivalFactSheet, sources: rivalSources, searchCount: rivalCount } =
    rivalTeams.length > 0
      ? await runResearchPhase(pathResult, config, teamName, rivalTeams.map(r => r.name), 'rival', rivals, injuryMap)
      : { factSheet: '', sources: [], searchCount: 0 };

  // Phase A2: Light research on matches-to-watch teams (2-3 searches per team)
  const { factSheet: lightFactSheet, sources: lightSources, searchCount: lightCount } =
    await runResearchPhase(pathResult, config, teamName, [...tier2Teams], 'light', undefined, injuryMap);

  const combinedFactSheet = [deepFactSheet, rivalFactSheet, lightFactSheet].filter(Boolean).join('\n\n');
  const allSources = [...deepSources, ...rivalSources, ...lightSources];
  const totalSearchCount = deepCount + rivalCount + lightCount;

  // Phase B: Write
  const analysis = await runWritingPhase(
    pathResult, config, teamName, position, points, gapToTarget, gamesRemaining, combinedFactSheet, sortedTeams, rivals
  );

  return { analysis, sources: allSources, searchCount: totalSearchCount };
}

// ── Main Handler ──

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      targetTeam,
      targetMetric = 'top7Pct',
      teams,
      fixtures,
      forceRefresh = false,
      checkCacheOnly = false,
    } = body as {
      targetTeam: string;
      targetMetric?: string;
      teams: Team[];
      fixtures: Fixture[];
      forceRefresh?: boolean;
      checkCacheOnly?: boolean;
    };

    if (!teams?.length || !fixtures?.length || !targetTeam) {
      return NextResponse.json(
        { error: 'Missing required fields: teams, fixtures, targetTeam' },
        { status: 400 }
      );
    }

    const scenarioKey = createDeepAnalysisScenarioKey({
      targetTeam,
      targetMetric,
      teams,
      fixtures,
    });

    if (checkCacheOnly) {
      if (!isDeepAnalysisCacheConfigured()) {
        return NextResponse.json({
          cacheEnabled: false,
          cached: false,
        });
      }

      const cached = await getCachedDeepAnalysis({
        scenarioKey,
        targetTeam,
        targetMetric,
      });
      return NextResponse.json({
        cacheEnabled: true,
        cached: Boolean(cached),
        cacheMatchType: cached?.cacheMatchType ?? null,
        cachedAt: cached?.generatedAt ?? null,
        preview: cached
          ? {
              targetMetric: cached.analysis.targetMetric,
              summary: cached.analysis.bottomLine?.summary ?? '',
              keyScenario: cached.analysis.bottomLine?.keyScenario ?? '',
            }
          : null,
      });
    }

    if (!forceRefresh && isDeepAnalysisCacheConfigured()) {
      const cached = await getCachedDeepAnalysis({
        scenarioKey,
        targetTeam,
        targetMetric,
      });
      if (cached) {
        return NextResponse.json({
          analysis: cached.analysis,
          aiWarning: cached.aiWarning,
          pathResult: cached.pathResult,
          cacheStatus: 'hit',
          cacheEnabled: true,
          cacheMatchType: cached.cacheMatchType,
          cachedAt: cached.generatedAt,
        });
      }
    }

    // ── Phase 1: Path Search ──
    const config: PathSearchConfig = {
      teams,
      fixtures,
      targetTeam,
      targetMetric: targetMetric as keyof import('@/lib/types').SimulationResult,
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
    let aiWarning = '';

    if (OPENROUTER_API_KEY) {
      try {
        const result = await narrateAnalysis(
          pathResult,
          config,
          teamName,
          position,
          teamPoints,
          gapToTarget,
          gamesRemaining,
          sortedTeams
        );
        narrativeData = result.analysis;
        sources = result.sources;
        searchCount = result.searchCount;
      } catch (error) {
        if (error instanceof OpenRouterError && error.status === 402) {
          aiWarning =
            'AI insights are temporarily unavailable because OpenRouter returned HTTP 402 (credits/billing issue). Showing simulation-only analysis.';
        } else {
          aiWarning =
            'AI insights are temporarily unavailable due to an OpenRouter provider error. Showing simulation-only analysis.';
        }

        console.error('Deep Analysis narration failed; returning fallback analysis:', error);
      }
    }

    // ── Build final DeepAnalysis object ──
    const analysis: DeepAnalysis = {
      id: crypto.randomUUID(),
      generatedAt: Date.now(),
      targetTeam,
      targetMetric,

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
          `${teamName} sit ${position}th on ${teamPoints} points with ${gamesRemaining} matches remaining. The baseline simulation gives them a ${pathResult.baselineOdds.toFixed(1)}% chance of achieving the target. The optimal path — where everything breaks their way — pushes this to ${pathResult.optimalPath.resultingOdds.toFixed(1)}%, but the probability of all those results occurring together is just ${formatPlausibilityPercent(pathResult.optimalPath.compositePlausibility)}.`,
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
        [
          // Include 1-2 of the target team's own highest-leverage fixtures
          ...pathResult.sensitivityData
            .filter(
              (s) =>
                s.fixtureId !== decisiveFixture?.fixtureId &&
                (s.homeTeam === targetTeam || s.awayTeam === targetTeam)
            )
            .slice(0, 2)
            .map((s) => {
              const bestDelta = Math.max(s.deltaIfHomeWin, s.deltaIfDraw, s.deltaIfAwayWin);
              const isHome = s.homeTeam === targetTeam;
              const idealResult = isHome
                ? (s.deltaIfHomeWin >= s.deltaIfDraw && s.deltaIfHomeWin >= s.deltaIfAwayWin
                    ? `${s.homeTeam} win`
                    : s.deltaIfDraw >= s.deltaIfAwayWin ? 'Draw' : `${s.awayTeam} win`)
                : (s.deltaIfAwayWin >= s.deltaIfDraw && s.deltaIfAwayWin >= s.deltaIfHomeWin
                    ? `${s.awayTeam} win`
                    : s.deltaIfDraw >= s.deltaIfHomeWin ? 'Draw' : `${s.homeTeam} win`);
              return {
                fixtureId: s.fixtureId,
                homeTeam: s.homeTeam,
                awayTeam: s.awayTeam,
                whyItMatters: `A ${teamName} match with a ${s.maxAbsDelta.toFixed(1)}pp swing on ${targetMetric} odds.`,
                idealResult,
                whyItsPlausible: 'Based on current form and bookmaker odds.',
                simulationImpact: `+${bestDelta.toFixed(1)}pp`,
              };
            }),
          // Then 2-3 rival fixtures
          ...pathResult.sensitivityData
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
        ].slice(0, 4),

      bottomLine: narrativeData.bottomLine ?? {
        summary: `${teamName}'s path to their target runs through the fixtures identified in this analysis. The baseline odds are ${pathResult.baselineOdds.toFixed(1)}%, but the right combination of results can push this significantly higher.`,
        keyScenario: pathResult.candidatePaths[0]
          ? `The most plausible path requires: ${pathResult.candidatePaths[0].locks.map((l) => l.resultLabel).join(', ')}. This would push odds to ${pathResult.candidatePaths[0].resultingOdds.toFixed(1)}%.`
          : 'No viable path found that materially improves the current outlook.',
      },

      sources: [...new Set(sources)],
      searchBudgetUsed: searchCount,
    };

    const pathResultPayload = {
      baselineOdds: pathResult.baselineOdds,
      optimalPath: pathResult.optimalPath,
      candidatePaths: pathResult.candidatePaths,
      sensitivityData: pathResult.sensitivityData,
      searchStats: pathResult.searchStats,
    };

    if (isDeepAnalysisCacheConfigured()) {
      // Derive the finishing-position threshold from the metric name
      const thresholdMap: Record<string, number> = {
        championPct: 1,
        top4Pct: 4,
        top5Pct: 5,
        top6Pct: 6,
        top7Pct: 7,
        relegationPct: 18,
        survivalPct: 18,
      };
      const targetThreshold = thresholdMap[targetMetric] ?? 7;

      await upsertDeepAnalysisCache({
        scenarioKey,
        targetTeam,
        targetMetric,
        targetThreshold,
        analysis,
        pathResult: pathResultPayload,
        aiWarning,
      });
    }

    return NextResponse.json({
      analysis,
      aiWarning,
      pathResult: pathResultPayload,
      cacheStatus: forceRefresh ? 'refreshed' : 'miss',
      cacheEnabled: isDeepAnalysisCacheConfigured(),
      cachedAt: analysis.generatedAt,
    });
  } catch (error) {
    console.error('Deep Analysis API error:', error);
    return NextResponse.json(
      { error: `Deep Analysis failed: ${error instanceof Error ? error.message : 'Unknown error'}` },
      { status: 500 }
    );
  }
}
