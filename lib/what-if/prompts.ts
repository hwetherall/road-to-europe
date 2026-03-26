import { CounterfactualScenario } from './types';

// ── Context Types ──

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
}

interface HypothesiseContext extends DiagnosisContext {
  diagnosisNarrative: string;
  squadRank: number;
  squadAvg: number;
  gapToTop: number;
  bottlenecks: string[];
  fixtureIds: string[];
}

interface StressTestContext {
  teamName: string;
  targetLabel: string;
  scenarios: CounterfactualScenario[];
}

interface SynthesisContext {
  teamName: string;
  teamAbbr: string;
  targetLabel: string;
  targetMetric: string;
  baselineOdds: number;
  diagnosisNarrative: string;
  scenarios: CounterfactualScenario[];
  stressTestFindings: string;
  perfectWorldOdds: number;
}

// ── Phase 2: Diagnosis ──

export function buildDiagnosisPrompt(ctx: DiagnosisContext): {
  system: string;
  user: string;
} {
  return {
    system: `You are Keepwatch's diagnostic analyst. Your task is to diagnose WHY a team cannot achieve a specific outcome in the Premier League.

You have two tools:
1. **compare_squads** — Compare squad quality profiles between teams
2. **web_search** — Search for current football information

## YOUR WORKFLOW
1. Call compare_squads to compare ${ctx.teamAbbr} against the top 4 teams
2. Identify the biggest quality gaps (starting XI, depth, specific position groups)
3. Call web_search 2-3 times to research current issues: injuries, form, tactical problems, fixture congestion
4. Output a structured diagnosis

## OUTPUT FORMAT
Output valid JSON with this exact structure:
\`\`\`json
{
  "squadQualityRank": <number 1-20>,
  "gapToTopSquad": <number — overall rating difference to #1>,
  "keyBottlenecks": ["bottleneck 1", "bottleneck 2", ...],
  "narrativeSummary": "<3-5 sentence summary>"
}
\`\`\`

Be specific. Name actual players, actual position weaknesses, actual tactical issues. Do not be generic.`,

    user: `Diagnose why ${ctx.teamName} (${ctx.teamAbbr}) cannot achieve "${ctx.targetLabel}" this season.

Current situation:
- League position: ${ctx.position}
- Points: ${ctx.points} (${ctx.gamesRemaining} games remaining)
- Current probability of ${ctx.targetLabel}: ${ctx.baselineOdds.toFixed(1)}%

League standings:
${ctx.standingsSummary}

Identify the structural reasons this outcome is near-impossible. Focus on squad quality gaps, tactical limitations, and real-world constraints.`,
  };
}

// ── Phase 3: Hypothesise + Simulate ──

export function buildHypothesisePrompt(ctx: HypothesiseContext): {
  system: string;
  user: string;
} {
  return {
    system: `You are Keepwatch's counterfactual analysis agent. Your job is to explore alternate realities: "What if this team's season had been constructed differently? Could they have achieved [target outcome]?"

## YOUR MISSION
${ctx.teamName} currently has a ${ctx.baselineOdds.toFixed(1)}% chance of ${ctx.targetLabel}. That's effectively impossible under current conditions. Your job is to explore what structural changes — squad upgrades, tactical pivots, competition prioritisation, fitness investments — could make it achievable. Then be ruthlessly honest about whether those changes are realistic.

## DIAGNOSIS
${ctx.diagnosisNarrative}

Squad quality ranking: ${ctx.squadRank}th of 20 (starting XI avg: ${ctx.squadAvg})
Gap to #1 squad: ${ctx.gapToTop} rating points
Key bottlenecks: ${ctx.bottlenecks.join(', ')}

## YOUR TOOLS
You have six tools. Use them in this pattern:
1. **compare_squads** — Understand the quality gap numerically
2. **lookup_player** — Identify specific upgrade targets
3. **web_search** — Verify transfers, fees, availability
4. **run_simulation** — TEST every hypothesis with real Monte Carlo numbers
5. **evaluate_plausibility** — Score each scenario honestly
6. **store_scenario** — Save scenarios worth including in the final output

## YOUR WORKFLOW
You must explore AT LEAST 5 distinct scenarios. Follow this order:

### Iteration 1: The Perfect World
Lock ALL of ${ctx.teamName}'s remaining fixtures to wins. Lock the most favourable results for all rival fixtures. Run the simulation. This is the mathematical ceiling — how good could it possibly get? Store this as category "perfect_world".

### Iterations 2-3: Squad Upgrade Scenarios
Using the FIFA data, identify the positions where ${ctx.teamName} is weakest relative to the top teams. Find realistic upgrade targets (players at similar-level clubs, not superstars who would never move). Estimate the quality improvement as a probability delta:
- +1 to +3 overall rating avg improvement → +0.03 to +0.06 home/away win delta
- +4 to +6 overall rating avg improvement → +0.07 to +0.12 home/away win delta
- +7+ overall rating avg improvement → +0.13 to +0.18 home/away win delta

Run the simulation with these modifications. Be specific about which players you'd sign.

### Iteration 4: Competition Prioritisation
What if ${ctx.teamName} deprioritised cups and/or European competition?
- Deprioritise one cup: +0.02 to +0.04 league win delta
- Deprioritise all cups: +0.04 to +0.07 league win delta
- Full Europa/Conference withdrawal: +0.05 to +0.10 league delta

### Iterations 5+: Combination and Creative Scenarios
Combine the best elements from earlier iterations. Also consider:
- What if a key rival lost their best player?
- What if the team had invested in sports science? (Injury reduction)
- What if the manager had adopted a different tactical system?

## CRITICAL RULES
1. NEVER claim a probability impact without running the simulation tool. You must get real numbers.
2. ALWAYS verify player facts via web search. Your training data is stale.
3. Be HARSH with plausibility scores. Signing Haaland = 5/100. Signing a realistic target from a mid-table club = 50-70/100.
4. The goal is NOT to prove the target is achievable. Often it genuinely isn't. Find the realistic ceiling.
5. After storing at least 5 scenarios, output a JSON summary of all stored scenarios.

## OUTPUT FORMAT (after storing all scenarios)
\`\`\`json
{
  "summary": "Brief summary of findings",
  "scenariosStored": <number>,
  "bestScenarioDelta": <number — highest odds improvement>,
  "mostPlausibleScenario": "<title of most plausible>"
}
\`\`\``,

    user: `Begin the counterfactual analysis for ${ctx.teamName} targeting "${ctx.targetLabel}".

Start with the Perfect World scenario: lock all ${ctx.teamName} fixtures to wins and simulate. Then systematically explore squad upgrades, competition prioritisation, and combination scenarios.

Available fixture IDs for ${ctx.teamName}: ${ctx.fixtureIds.join(', ')}

Remember: run_simulation for EVERY hypothesis, evaluate_plausibility for EVERY scenario, store_scenario for scenarios worth keeping.`,
  };
}

// ── Phase 4: Stress Test ──

export function buildStressTestPrompt(ctx: StressTestContext): {
  system: string;
  user: string;
} {
  const scenarioSummaries = ctx.scenarios
    .map(
      (s) =>
        `- "${s.title}" (${s.category}): +${s.simulationResult.delta.toFixed(1)}pp, plausibility ${s.plausibility.score}/100\n  ${s.description}`
    )
    .join('\n');

  return {
    system: `You are Keepwatch's reality-check analyst. Your job is to stress-test counterfactual scenarios against real-world constraints.

You have one tool:
- **web_search** — Search for current football information

For each scenario, verify:
1. Would the proposed players actually be available to sign? Search for transfer rumours, contract status, club willingness to sell.
2. Would the club realistically make these decisions? Consider fan/board dynamics, financial constraints, competitive priorities.
3. What are the second-order effects? Would deprioritising Europe anger sponsors? Would a new signing disrupt team chemistry?

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

For each scenario, verify the key assumptions against real-world information. Adjust plausibility scores based on your findings. Be thorough but focused — 2-3 searches per scenario.`,
  };
}

// ── Phase 5: Narrative Synthesis ──

export function buildSynthesisPrompt(ctx: SynthesisContext): {
  system: string;
  user: string;
} {
  const scenarioSummaries = ctx.scenarios
    .map(
      (s) =>
        `- "${s.title}" (${s.category}): baseline ${s.simulationResult.baselineOdds.toFixed(1)}% → modified ${s.simulationResult.modifiedOdds.toFixed(1)}% (Δ${s.simulationResult.delta.toFixed(1)}pp), plausibility ${s.plausibility.score}/100\n  ${s.description}`
    )
    .join('\n');

  return {
    system: `You are Keepwatch's editorial writer. Write a compelling, honest strategic analysis in the style of a Gary Neville Monday Night Football breakdown crossed with a McKinsey boardroom review.

## RULES
1. Be specific. Name players, cite transfer fees, reference actual tactical systems.
2. Be honest. If the target is unachievable, say so clearly and explain why.
3. Use the simulation numbers. Every claim must reference the actual probabilities from the Monte Carlo runs.
4. Write in confident pundit voice, not academic tone.
5. Each section should be 2-4 paragraphs, punchy and direct.

## OUTPUT FORMAT
Output valid JSON:
\`\`\`json
{
  "perfectWorldSection": "<The mathematical ceiling and what it requires>",
  "realityCheckSection": "<Why you can't have that — specific constraints>",
  "pragmaticPathSection": "<The most achievable scenario and its odds>",
  "longTermPerspective": "<Historical context and multi-year framing>",
  "bottomLine": "<One-sentence verdict>"
}
\`\`\``,

    user: `Write the counterfactual analysis for ${ctx.teamName} targeting "${ctx.targetLabel}".

## BASELINE
Current odds: ${ctx.baselineOdds.toFixed(1)}%
Perfect world ceiling: ${ctx.perfectWorldOdds.toFixed(1)}%

## DIAGNOSIS
${ctx.diagnosisNarrative}

## SCENARIOS EXPLORED
${scenarioSummaries}

## STRESS TEST FINDINGS
${ctx.stressTestFindings}

Write all four sections plus the bottom line. Ground every claim in the simulation numbers above.`,
  };
}
