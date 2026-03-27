import { Team, Fixture } from '../types';
import { CounterfactualScenario, PlayerQuality } from './types';
import { loadFIFAData } from './fifa-data';

// ── Temporal Context (Fix 2) ──

export function buildTemporalContext(teams: Team[], fixtures: Fixture[]): string {
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
  just "[team] manager".

### LEAGUE STRUCTURE REMINDERS
- Positions 18th, 19th, and 20th ARE the relegation zone. Being 18th
  means you ARE in the relegation zone, not "above" it.
- 17th is the LAST safe position — "just above the relegation zone."
- Top 4 = Champions League. Top 5 = UCL expanded. Top 6 = Europa League.
  Top 7 = Conference League / any European football.
- Bottom 3 get relegated to the Championship.

If a team is in 18th, 19th, or 20th, they are IN the relegation
zone. Do not say they are "above" or "near" it. They are IN it.`;
}

// ── Squad Context (Fix 3) ──

function normaliseClubName(club: string): string {
  // Strip trailing FC and normalise common variants
  return club.replace(/ FC$/, '').trim();
}

export async function buildSquadContext(
  teamName: string
): Promise<string> {
  const players = await loadFIFAData();
  const squad = players
    .filter(p => {
      const pClub = normaliseClubName(p.club);
      const tName = normaliseClubName(teamName);
      return pClub === tName || pClub.toLowerCase() === tName.toLowerCase();
    })
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

// ── Departed Players Context (Fix 3) ──

function buildDepartedPlayersSection(
  teamName: string,
  departedPlayers?: { name: string; to: string; fee: string; overall: number; position: string }[]
): string {
  if (!departedPlayers || departedPlayers.length === 0) return '';

  return `\n## DEPARTED PLAYERS (left before 2025-26 season)
These players are NO LONGER at ${teamName}. Referencing them
as current players is a CRITICAL ERROR. You may propose "What if we
had kept [player]?" as a counterfactual — label it correctly.
${departedPlayers.map(p =>
  `- ${p.name} (${p.overall} OVR, ${p.position}) → transferred to ${p.to} for ${p.fee}`
).join('\n')}\n`;
}

// ── Context Interfaces ──

interface DiagnosisContext {
  teamName: string;
  teamAbbr: string;
  targetLabel: string;
  targetMetric: string;
  baselineOdds: number;
  position: number;
  points: number;
  gamesRemaining: number;
  standingsSummary: string;
  // New: temporal + squad grounding
  teams: Team[];
  fixtures: Fixture[];
  squadContext: string;
}

interface HypothesiseContext extends DiagnosisContext {
  diagnosisNarrative: string;
  squadRank: number;
  squadAvg: number;
  gapToTop: number;
  bottlenecks: string[];
  fixtureCatalog: string;
  departedPlayers?: { name: string; to: string; fee: string; overall: number; position: string }[];
  baselineExpectedPoints?: number;
}

interface StressTestContext {
  teamName: string;
  targetLabel: string;
  scenarios: CounterfactualScenario[];
  // New: temporal + squad grounding
  teams: Team[];
  fixtures: Fixture[];
  squadContext: string;
  departedPlayers?: { name: string; to: string; fee: string; overall: number; position: string }[];
}

interface DepartedPlayer {
  name: string;
  to: string;
  fee: string;
  overall: number;
  position: string;
}

export interface PragmaticSimResult {
  metric: string;
  metricLabel: string;
  baselineValue: number;
  modifiedValue: number;
  scenarioTitle: string;
  baselineExpectedPoints: number;
  modifiedExpectedPoints: number;
  baselineExpectedPosition: number;
  modifiedExpectedPosition: number;
}

interface SynthesisContext {
  teamName: string;
  targetLabel: string;
  targetMetric: string;
  baselineOdds: number;
  baselineExpectedPoints: number;
  baselineExpectedPosition: number;
  currentPosition: number;
  diagnosisNarrative: string;
  scenarios: CounterfactualScenario[];
  stressTestFindings: string;
  perfectWorldOdds: number;
  departedPlayers?: DepartedPlayer[];
  pragmaticSimResult?: PragmaticSimResult | null;
  // Temporal grounding
  teams: Team[];
  fixtures: Fixture[];
}

// ── Prompt Builders ──

export function buildDiagnosisPrompt(ctx: DiagnosisContext): {
  system: string;
  user: string;
} {
  const temporal = buildTemporalContext(ctx.teams, ctx.fixtures);

  return {
    system: `${temporal}

${ctx.squadContext}

You are Keepwatch's diagnostic analyst. Your task is to explain why a Premier League outcome is currently so unlikely for a team.

You have two tools:
1. compare_squads - Compare squad quality profiles between teams
2. web_search - Search for current football information

## YOUR WORKFLOW
1. Call compare_squads to compare ${ctx.teamAbbr} against the top 4 teams
2. Identify the biggest quality gaps (starting XI, depth, specific position groups)
3. Call web_search 2-3 times to research current issues: injuries, form, tactical problems, fixture congestion
4. Output a structured diagnosis

## ADDITIONAL DIAGNOSIS TASK: DEPARTED PLAYERS
As part of your diagnosis, use web_search to identify any significant
players who LEFT ${ctx.teamName} between the 2024-25 and 2025-26 seasons.
For each departed player, note:
- Player name and position
- Where they went and for how much (if known)
- Their FIFA overall rating (use lookup_player if needed)
- Whether their departure left a gap in squad quality

Include this in your diagnosis output as a "departedPlayers" array:
[{ "name": "Player Name", "to": "New Club", "fee": "£Xm", "overall": 80, "position": "AM" }]

This is CRITICAL for helping later phases frame counterfactuals correctly.
If a scenario involves "keeping" a departed player, it must be explicitly
framed as a counterfactual about the transfer decision, not as if the
player is still at the club.

## OUTPUT FORMAT
Output valid JSON with this exact structure:
\`\`\`json
{
  "squadQualityRank": <number 1-20>,
  "gapToTopSquad": <number - overall rating difference to #1>,
  "keyBottlenecks": ["bottleneck 1", "bottleneck 2"],
  "narrativeSummary": "<3-5 sentence summary>",
  "departedPlayers": [{ "name": "...", "to": "...", "fee": "...", "overall": 0, "position": "..." }]
}
\`\`\`

Be specific. Name actual players, actual position weaknesses, actual tactical issues. Do not be generic.

Important: a baseline probability of 0.0% does NOT automatically mean literal mathematical impossibility. Treat it as "the model currently rounds this down to zero" unless the standings and remaining fixtures make elimination unavoidable.`,

    user: `Diagnose why ${ctx.teamName} (${ctx.teamAbbr}) is currently so unlikely to achieve "${ctx.targetLabel}" this season.

Current situation:
- League position: ${ctx.position}
- Points: ${ctx.points} (${ctx.gamesRemaining} games remaining)
- Current probability of ${ctx.targetLabel}: ${ctx.baselineOdds.toFixed(1)}%

League standings:
${ctx.standingsSummary}

Identify the structural reasons this outcome is currently near-zero or extremely remote. Focus on squad quality gaps, tactical limitations, and real-world constraints. Separate "hard mathematical barriers" from "still possible, but needs chaos."

REMEMBER: Also identify departed players who left before this season and include them in your output.`,
  };
}

export function buildHypothesisePrompt(ctx: HypothesiseContext): {
  system: string;
  user: string;
} {
  const temporal = buildTemporalContext(ctx.teams, ctx.fixtures);
  const departedSection = buildDepartedPlayersSection(ctx.teamName, ctx.departedPlayers);

  return {
    system: `${temporal}

${ctx.squadContext}
${departedSection}
You are Keepwatch's counterfactual analysis agent. You explore alternate
realities: "What if this team's season had been constructed differently?"

## CRITICAL: FULL-SEASON SIMULATION
The run_simulation tool simulates the ENTIRE 38-game season from scratch.
It does NOT start from current standings. It ignores the current league
table and replays all 380 fixtures using Elo-derived base probabilities,
with your modifications applied across EVERY match.

This means:
- When you apply a +0.10 homeWinDelta to ${ctx.teamName}, it boosts
  their home win probability in ALL 19 home matches, not just remaining ones.
- The simulation asks: "If ${ctx.teamName} had been this strong ALL
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
${ctx.teamName} currently sits ${ctx.position}th with ${ctx.points}
points from ${38 - ctx.gamesRemaining} games in the ACTUAL 2025-26 season.

Their full-season baseline simulation (no modifications) gives them
${ctx.baselineExpectedPoints?.toFixed(1) ?? '??'} expected points and
${ctx.baselineOdds?.toFixed(1) ?? '??'}% chance of ${ctx.targetLabel}.

Your job: explore what structural changes — squad upgrades, tactical pivots,
competition prioritisation, injury prevention — could improve that number.

## DIAGNOSIS
${ctx.diagnosisNarrative}

Squad quality ranking: ${ctx.squadRank}th of 20 (starting XI avg: ${ctx.squadAvg})
Gap to #1 squad: ${ctx.gapToTop} rating points
Key bottlenecks: ${ctx.bottlenecks.join(', ')}

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
Report: "${ctx.teamName}'s baseline expected points are X, with Y%
chance of ${ctx.targetLabel}." This is your reference point.

### 2. Perfect World
Apply maximum realistic boosts to ${ctx.teamName} (e.g. +0.15/+0.12)
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
2. NEVER reference a player as being at ${ctx.teamName} unless they
   appear in the VERIFIED SQUAD section above.
3. ALL web searches must include "2025-26" when referencing teams.
4. Departed players can be "kept" as counterfactuals — label them correctly.
5. Be HARSH with plausibility scores. Fantasy scenarios get 0-5/100.

## OUTPUT FORMAT
Output valid JSON:
\`\`\`json
{
  "summary": "Brief summary of findings",
  "scenariosStored": <number>,
  "bestScenarioDelta": <number - highest odds improvement>,
  "mostPlausibleScenario": "<title of most plausible>"
}
\`\`\``,

    user: `Explore counterfactual scenarios for ${ctx.teamName} achieving
${ctx.targetLabel} in the 2025-26 Premier League season. Start by
running the baseline simulation, then work through at least 5 scenarios
of increasing ambition. Store each one.

Available remaining fixture locks:
${ctx.fixtureCatalog}

Remember: run_simulation for EVERY hypothesis, evaluate_plausibility for EVERY scenario, store_scenario for scenarios worth keeping.`,
  };
}

export function buildStressTestPrompt(ctx: StressTestContext): {
  system: string;
  user: string;
} {
  const temporal = buildTemporalContext(ctx.teams, ctx.fixtures);
  const departedSection = buildDepartedPlayersSection(ctx.teamName, ctx.departedPlayers);

  const scenarioSummaries = ctx.scenarios
    .map(
      (s) =>
        `- "${s.title}" (${s.category}): +${s.simulationResult.delta.toFixed(1)}pp, plausibility ${s.plausibility.score}/100\n  ${s.description}`
    )
    .join('\n');

  return {
    system: `${temporal}

${ctx.squadContext}
${departedSection}
You are Keepwatch's reality-check analyst. Your job is to stress-test counterfactual scenarios against real-world constraints.

You have one tool:
- web_search - Search for current football information

For each scenario, verify:
1. Would the proposed players actually be available to sign? Search for transfer rumours, contract status, club willingness to sell.
2. Would the club realistically make these decisions? Consider fan/board dynamics, financial constraints, competitive priorities.
3. What are the second-order effects? Would deprioritising Europe anger sponsors? Would a new signing disrupt team chemistry?

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

## OUTPUT FORMAT
Output valid JSON:
\`\`\`json
{
  "assessments": [
    {
      "scenarioTitle": "...",
      "originalPlausibility": <number>,
      "adjustedPlausibility": <number>,
      "keyFindings": ["finding 1", "finding 2"],
      "verdict": "feasible" | "stretch" | "infeasible"
    }
  ],
  "overallVerdict": "Brief summary"
}
\`\`\``,

    user: `Stress-test these counterfactual scenarios for ${ctx.teamName} targeting "${ctx.targetLabel}":

${scenarioSummaries}

For each scenario, verify the key assumptions against real-world information. Adjust plausibility scores based on your findings. Be thorough but focused - 2-3 searches per scenario.`,
  };
}

// ── Pragmatic Redirect Logic ──

interface PragmaticTarget {
  metric: string;
  label: string;
  instruction: string;
  description: string;
}

function determinePragmaticTarget(ctx: SynthesisContext): PragmaticTarget {
  const position = ctx.currentPosition;
  const targetMetric = ctx.targetMetric;

  // If the original target is already somewhat achievable (>15%), don't redirect
  const bestRealisticOdds = ctx.scenarios
    .filter(s => s.plausibility.score >= 15)
    .reduce((best, s) => Math.max(best, s.simulationResult.modifiedOdds), 0);

  if (bestRealisticOdds > 15) {
    return {
      metric: targetMetric,
      label: ctx.targetLabel,
      instruction: `The original target IS partially achievable. The pragmatic path
section should present the most realistic scenario that gets closest to
the target, acknowledge the odds are still against, but frame the path
as a genuine possibility worth pursuing. Include the specific combination
of changes that produces the best realistic outcome.`,
      description: `Original target is partially achievable at ${bestRealisticOdds.toFixed(1)}% under the best realistic scenario.`,
    };
  }

  // Otherwise, redirect to a lower target based on current position
  if (position >= 15) {
    return {
      metric: 'survivalPct',
      label: 'comfortable mid-table safety (10th-14th)',
      instruction: `The original target (${ctx.targetLabel}) is unachievable — the best
realistic scenario only reaches ${bestRealisticOdds.toFixed(1)}%. PIVOT to a
different, achievable target: comfortable mid-table safety (10th-14th place).

Open with: "If ${ctx.targetLabel} is off the table — and at ${bestRealisticOdds.toFixed(1)}%
under every realistic scenario, it is — then the real question becomes:
what IS achievable?"

Then reference the scenario modifications and explain what they WOULD
achieve for mid-table safety instead of European qualification. The same
+5 points that moves Top 7 from 0.8% to 3% might move survival probability
from 85% to 97%. Find the encouraging number and present it.

Close with WHY mid-table stability matters: revenue, stability, platform
for future ambition. Make the reader feel this is a worthy goal, not a
consolation prize.`,
      description: `Redirect to mid-table safety. Best realistic Top 7 scenario only reaches ${bestRealisticOdds.toFixed(1)}%. The pragmatic question is: what would these same changes achieve for survival/mid-table?`,
    };
  }

  if (position >= 8) {
    return {
      metric: 'top10',
      label: 'secure top-half finish (7th-10th)',
      instruction: `The original target (${ctx.targetLabel}) is a stretch — the best
realistic scenario only reaches ${bestRealisticOdds.toFixed(1)}%. PIVOT to a
more achievable target: a secure top-half finish.

The same modifications that barely move the needle on ${ctx.targetLabel}
may produce much stronger odds for a top-10 finish. Find and present
that number. Frame it as "the same investment in squad quality gets you
to X% for top-10 — a much more compelling return."`,
      description: `Redirect to top-half finish. Best realistic ${ctx.targetLabel} scenario reaches ${bestRealisticOdds.toFixed(1)}%. Find the top-10 probability instead.`,
    };
  }

  // Top 7 or above: redirect to the next tier down
  const redirectMap: Record<string, { metric: string; label: string }> = {
    championPct: { metric: 'top4Pct', label: 'Champions League qualification' },
    top4Pct: { metric: 'top6Pct', label: 'Europa League qualification' },
    top5Pct: { metric: 'top7Pct', label: 'any European qualification' },
    top6Pct: { metric: 'top7Pct', label: 'Conference League qualification' },
    top7Pct: { metric: 'top10', label: 'a top-10 finish' },
  };

  const redirect = redirectMap[targetMetric] ?? { metric: 'top7Pct', label: 'European qualification' };

  return {
    metric: redirect.metric,
    label: redirect.label,
    instruction: `The original target (${ctx.targetLabel}) is unachievable at
${bestRealisticOdds.toFixed(1)}% best case. PIVOT to ${redirect.label}.

Show how the same scenario modifications produce much better odds for
this lower target. The same changes that move ${ctx.targetLabel} from
X% to Y% might move ${redirect.label} from A% to B%.

Frame the redirect positively: "${redirect.label} is the real prize
this season, and the modifications that make it likely also build the
foundation for pushing higher in future years."`,
    description: `Redirect to ${redirect.label}. Best realistic ${ctx.targetLabel} is ${bestRealisticOdds.toFixed(1)}%. Present the more achievable target.`,
  };
}

// ── Synthesis Prompt ──

export function buildSynthesisPrompt(ctx: SynthesisContext): {
  system: string;
  user: string;
} {
  const temporal = buildTemporalContext(ctx.teams, ctx.fixtures);

  // Sort scenarios by plausibility descending (for reality check ordering)
  const byPlausibility = [...ctx.scenarios]
    .filter(s => s.category !== 'perfect_world')
    .sort((a, b) => b.plausibility.score - a.plausibility.score);

  const perfectWorld = ctx.scenarios.find(s => s.category === 'perfect_world')
    ?? ctx.scenarios.reduce((a, b) =>
      a.simulationResult.modifiedOdds > b.simulationResult.modifiedOdds ? a : b
    );

  const bestRealistic = byPlausibility[0];
  const bestCombination = ctx.scenarios
    .filter(s => s.category === 'combination')
    .sort((a, b) => b.simulationResult.modifiedOdds - a.simulationResult.modifiedOdds)[0];

  const pragmaticTarget = determinePragmaticTarget(ctx);

  return {
    system: `${temporal}

You are Keepwatch's editorial writer. You produce strategic analysis
that reads like a Gary Neville Monday Night Football segment crossed with
a boardroom strategic review. Specific, data-grounded, honest, and
ultimately actionable.

## THE FOUR-SECTION STRUCTURE (FOLLOW THIS EXACTLY)

### Section 1: "perfectWorldSection" — THE CEILING
Open with the full-season simulation BASELINE:
"Our full-season simulation projects ${ctx.teamName} to ${ctx.baselineExpectedPoints?.toFixed(1) ?? '?'} expected points and ${ctx.baselineOdds.toFixed(1)}% chance of ${ctx.targetLabel}."
Then state the CEILING from the perfect-world scenario.
Then explain what the gap between baseline and ceiling means.
DO NOT reference remaining games, current points, or the live table.
The reader already knows the current season is impossible — that's why
they're here. This section is about the FULL-SEASON counterfactual.
2-3 paragraphs. Numbers-first, clinical tone.

### Section 2: "realityCheckSection" — THE ESCALATION
Walk through scenarios in ORDER OF PLAUSIBILITY (most realistic first).
Build a narrative escalation:

1. Start with the most plausible scenario (${bestRealistic?.title ?? 'most realistic change'}, plausibility ${bestRealistic?.plausibility.score ?? '?'}/100). Explain the logic, state the number, explain why it's not enough.
2. Escalate to the next scenario. "Going further..." or "Building on that..."
3. Continue escalating, with each step explicitly referencing what came before.
4. End with the aggressive combination and its still-modest number.

The reader should feel: "They tried the reasonable things, then the
ambitious things, and even those weren't enough."
3-4 paragraphs. Empathetic but unflinching tone.

KEY: Reference SPECIFIC facts from the stress test. If a scenario was
adjusted downward because of a real-world finding (e.g. "Todibo was
already permanently signed"), include that. Self-corrections build
credibility.

### Section 3: "pragmaticPathSection" — THE POSITIVE REDIRECT
${pragmaticTarget.instruction}

This section MUST contain a POSITIVE NUMBER. If the original target
is unachievable, find a lower target where the numbers are encouraging.
The reader should leave this section with something to hold onto.
2-3 paragraphs. Constructive, forward-looking tone.

### Section 4: "longTermPerspective" — THE ARC
Historical context: where was this club 3-5 years ago?
Is this moment a blip or a symptom?
Name 2-3 specific things that need to change for the original target
to become realistic in FUTURE seasons.
Close with honest perspective on the timeline.
DO NOT repeat the pragmatic path. This section is about the multi-year
journey, not next season's target.
2-3 paragraphs. Warm, historical tone.

### "bottomLine" — THE VERDICT
EXACTLY 2 sentences. Maximum 40 words total.
Sentence 1: Verdict on the original target (with a number).
Sentence 2: The positive redirect (with the achievable target).

## TONE CALIBRATION
- You are allowed ONE punchy, dramatic line per section — use it for the
  most important insight in that section. The rest should be plain,
  confident, direct language.
- Avoid sentence fragments used for emphasis ("It is the squad speaking."
  "That is the gap."). Use them at most once in the entire analysis.
- Avoid extended metaphors. One brief metaphor per section maximum.
  "A lottery ticket" is fine. "A one-in-seven lottery ticket purchased
  with a universe of good fortune" is overwrought.
- Do not use rhetorical repetition structures ("not X, but Y" / "not a
  contender with bad luck, but a squad ranked 15th") more than once.
- Prefer specificity over drama. "West Ham's 39.0 expected points would
  place them 16th" is better than "the simulation speaks volumes about
  where this squad truly belongs."
- Read the draft back and cut any sentence that sounds like it's
  auditioning for a podcast intro.

## WRITING RULES
1. Name players, cite transfer fees, reference specific tactical issues.
2. Every claim must reference an actual simulation number from the scenarios.
3. When citing simulation results, say "the simulation projects" not
   "they would have got" — these are hypothetical estimates.
4. Do not reference "Scenario 2" or "Scenario 5" by number — describe
   them by what they contain ("the Paqueta retention scenario").
5. Do not open any paragraph with "Let's" — vary your sentence openings.
6. The pragmaticPathSection MUST pivot to a different, achievable target.
   It must NOT just say "everything is bad." Find the silver lining.
7. Do not repeat the same point across sections. Each section has a
   distinct job. If you've made a point in the Reality Check, don't
   repeat it in the Pragmatic Path.

## OUTPUT FORMAT
Output valid JSON:
\`\`\`json
{
  "perfectWorldSection": "...",
  "realityCheckSection": "...",
  "pragmaticPathSection": "...",
  "longTermPerspective": "...",
  "bottomLine": "..."
}
\`\`\``,

    user: `Write the counterfactual analysis for ${ctx.teamName} targeting "${ctx.targetLabel}" in the 2025-26 Premier League season.

## FULL-SEASON BASELINE (no modifications)
Expected points: ${ctx.baselineExpectedPoints?.toFixed(1) ?? '?'}
${ctx.targetLabel} probability: ${ctx.baselineOdds.toFixed(1)}%
Expected position: ${ctx.baselineExpectedPosition?.toFixed(1) ?? '?'}

## PERFECT WORLD CEILING
${perfectWorld.title}: ${perfectWorld.simulationResult.modifiedOdds.toFixed(1)}% (delta ${perfectWorld.simulationResult.delta.toFixed(1)}pp)

## SCENARIOS (ordered by plausibility for your Reality Check section)
${byPlausibility.map((s, i) =>
  `${i + 1}. "${s.title}" — plausibility ${s.plausibility.score}/100, result: ${s.simulationResult.modifiedOdds.toFixed(1)}% (delta ${s.simulationResult.delta.toFixed(1)}pp)\n   ${s.description}\n   Stress test: ${s.plausibility.reasoning}`
).join('\n\n')}

## BEST COMBINATION SCENARIO
${bestCombination
  ? `"${bestCombination.title}" — ${bestCombination.simulationResult.modifiedOdds.toFixed(1)}% (plausibility ${bestCombination.plausibility.score}/100)`
  : 'No combination scenario found.'}

## STRESS TEST FINDINGS
${ctx.stressTestFindings}

## PRAGMATIC REDIRECT TARGET
${pragmaticTarget.description}
${ctx.pragmaticSimResult
  ? `
## PRAGMATIC TARGET: REAL SIMULATION NUMBERS
Using the "${ctx.pragmaticSimResult.scenarioTitle}" modifications:
- ${ctx.pragmaticSimResult.metricLabel} probability: ${ctx.pragmaticSimResult.baselineValue.toFixed(1)}% baseline → ${ctx.pragmaticSimResult.modifiedValue.toFixed(1)}% modified
- Expected points: ${ctx.pragmaticSimResult.baselineExpectedPoints.toFixed(1)} → ${ctx.pragmaticSimResult.modifiedExpectedPoints.toFixed(1)}
- Expected position: ${ctx.pragmaticSimResult.baselineExpectedPosition.toFixed(1)} → ${ctx.pragmaticSimResult.modifiedExpectedPosition.toFixed(1)}

Use THESE numbers in the Pragmatic Path section. Do not estimate — cite them directly.`
  : ''}

## DIAGNOSIS CONTEXT
${ctx.diagnosisNarrative}

## DEPARTED PLAYERS
${ctx.departedPlayers?.map(p => `- ${p.name} (${p.overall} OVR, ${p.position}) → ${p.to} for ${p.fee}`).join('\n') ?? 'None identified'}

Write all four sections plus the bottom line. Follow the structure exactly.`,
  };
}
