# CLAUDE-V5B.md — What-If Narrative Structure Fix

## Context

The What-If V5A fixes resolved the three critical bugs (full-season simulation, temporal grounding, squad verification). The numbers are now meaningful and the factual accuracy is dramatically improved. However, the narrative output is scatterbrained — it jumps between ideas without a clear argumentative spine, repeats itself across sections, and fails to deliver a positive redirect.

This document specifies exact changes to the synthesis prompt (`lib/what-if/prompts.ts`, `buildSynthesisPrompt`) and the overall narrative structure to produce output that reads like the V4 Deep Analysis gold standard: structured, building, honest, and ultimately actionable.

---

## Problem Diagnosis

### 1. The Perfect World section mixes two analytical frames

The current output opens with remaining-games arithmetic ("17-point gap, 7 games left, 21 points available") and then pivots to full-season simulation numbers ("20.2% probability at 50.2 expected points"). These are two different frames:

- **Remaining-games frame:** "Can West Ham qualify from their current position?" (Answer: no, and this is already shown by the dashboard. The What-If feature exists precisely because this answer is already known.)
- **Full-season frame:** "If the whole season were replayed with structural changes, could they qualify?" (Answer: maybe, and this is what the reader came here to learn.)

The Perfect World section should lead with the full-season frame exclusively. The remaining-games impossibility is context, not the analysis.

### 2. The Reality Check section has no narrative spine

The current output jumps: defensive transformation → Todibo correction → Paquetá counterfactual → managerial stability → Nuno factoid. Each point is individually good but there's no building argument. Compare with the Villa V1 analysis which had clear escalation: "We tried X (didn't work) → we tried Y (still didn't work) → we tried Z (still zero) → even the nuclear option barely moves the needle."

The fix: order scenarios by plausibility (most realistic first), building from "this almost could have worked" to "even this fantasy isn't enough."

### 3. The Pragmatic Path section doesn't redirect

The Villa analysis had a beautiful pivot: "The title is impossible, but Champions League is 81% — that's the real prize." The West Ham analysis just says "everything is bad" in two different ways. There's no equivalent of "forget Europe, here's what IS achievable and why it matters."

The fix: the synthesis agent must identify a LOWER, ACHIEVABLE target and run a simulation for it. If Europe is impossible, what about mid-table safety? What about finishing 10th-12th? What about simply avoiding relegation comfortably? The pragmatic path should always end with a positive number the reader can hold onto.

### 4. The Long View repeats the Pragmatic Path

Both sections currently say "multi-year rebuild." The Long View should provide historical context and emotional framing that the Pragmatic Path doesn't — it should make the reader feel something, not just think something.

### 5. The Bottom Line is too long

48 words with three em-dashes. The V4 bottom line was punchy: "Newcastle's path to Europe runs through the Emirates on April 25th." The What-If bottom line should be max 2 sentences: the verdict, then the redirect.

---

## The Narrative Structure (What Each Section Must Do)

### Section 1: The Perfect World

**Purpose:** Establish the ceiling. "Even in a fantasy scenario, here's as good as it gets."

**Structure:**
1. Open with the full-season BASELINE. "Our simulation of the full 2025-26 season, using Elo-derived match probabilities, projects West Ham to finish with X expected points and a Y% chance of reaching the top 7. That's the starting point."
2. Then the CEILING. "We threw every conceivable advantage at this — maximum squad boosts, rival collapses — and the ceiling is Z%."
3. Close with what the gap between baseline and ceiling tells you. "The distance between Y% and Z% represents the total structural headroom. Even maximising every lever only gets you this far."

**Tone:** Clinical, numbers-first. This section is the data foundation for everything that follows.

**DO NOT:** Reference remaining games, current points, or the live league table. The full-season sim ignores all of that. The What-If feature exists because the current-season situation is already known to be impossible — don't re-explain it here.

### Section 2: The Reality Check

**Purpose:** Walk through what was tried and why it didn't work. Build from most realistic to least.

**Structure:**
1. Open with the most plausible scenario (highest plausibility score). "The most believable single change we modelled was [X]. Here's what happened."
2. Escalate to the next scenario. "Going further, we combined [X] with [Y]."
3. Continue escalating until you reach the aggressive combination. Each step should explicitly reference the previous one: "Even adding [Z] on top of [X and Y] only pushed the needle to..."
4. Close with the pattern. "The consistent message across all scenarios is [X]."

**Key rule:** Order by PLAUSIBILITY descending, not by impact descending. The reader should feel like the analysis tried the reasonable things first, then got progressively more creative, and none of it was enough. This creates a building sense of "we really did try everything."

**Tone:** Empathetic but unflinching. Acknowledge that each scenario has logic behind it before explaining why it falls short.

### Section 3: The Pragmatic Path

**Purpose:** The positive redirect. "Europe is off the table, but here's what IS achievable."

**Structure:**
1. Open with the explicit pivot. "If [target] is off the table — and at X% across every realistic scenario, it is — then the real question becomes: what IS achievable?"
2. Identify a LOWER, REALISTIC target. For a team at 18th targeting Top 7, the pragmatic target might be "comfortable mid-table" (10th-14th) or "avoid relegation with room to spare." For a team at 4th targeting Champion, it might be "lock down Champions League."
3. Reference the simulation numbers for this lower target. "The same squad improvements that produce Y% for Europe produce Z% for [lower target] — a much more compelling proposition."
4. Close with WHY this lower target matters for the bigger picture. "Finishing 12th with a settled squad and a clear identity is worth more than finishing 14th in chaos, because it creates the platform for..."

**Key rule:** This section MUST contain a positive number. If every What-If scenario produces depressing odds for the original target, the pragmatic path finds a different target where the numbers are encouraging.

**Tone:** Constructive, forward-looking. This is the section where the reader stops feeling deflated and starts seeing a path forward.

### Section 4: The Long View

**Purpose:** Emotional and historical framing. Make the reader feel the trajectory.

**Structure:**
1. Open with history. Where was this club 3-5 years ago? What's the arc?
2. Contextualise the current moment. Is this a blip in an upward trajectory, or a symptom of structural decline?
3. Name the 2-3 things that need to change for the original target to become realistic in future seasons. Be specific: "Sustained investment of £X over Y windows," "Managerial stability for Z consecutive seasons," "Academy development producing N first-team players."
4. Close with perspective. Not empty optimism, but honest framing of the timeline.

**Key rule:** Do NOT repeat the pragmatic path. This section is about the multi-year arc, not next season's targets. If the Pragmatic Path says "finish 12th," the Long View says "and here's why finishing 12th this year is the first step in a 3-year plan to reach Europe."

**Tone:** Warm, historical, slightly philosophical. This is the Gary Neville "let me tell you what I've seen over the years" voice, not the McKinsey slide deck.

### The Bottom Line

**Purpose:** One punchy verdict + one actionable redirect.

**Format:** Exactly 2 sentences. Maximum 40 words total.

**Structure:**
- Sentence 1: The verdict on the original target. "West Ham's path to Europe this season was structurally impossible from August — no realistic combination of changes moves the needle past 10%."
- Sentence 2: The redirect. "The real prize is a stable 12th-place finish that ends the cycle of chaos and builds the foundation for a genuine push in 2027-28."

---

## Updated Synthesis Prompt

Replace the current `buildSynthesisPrompt` function in `lib/what-if/prompts.ts`:

```typescript
export function buildSynthesisPrompt(ctx: SynthesisContext): {
  system: string;
  user: string;
} {
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

  const scenarioSummaries = ctx.scenarios
    .map(
      (s) =>
        `- "${s.title}" [${s.category}] plausibility: ${s.plausibility.score}/100\n` +
        `  Baseline: ${s.simulationResult.baselineOdds.toFixed(1)}% → Modified: ${s.simulationResult.modifiedOdds.toFixed(1)}% (Δ${s.simulationResult.delta.toFixed(1)}pp)\n` +
        `  Expected points: baseline ${ctx.baselineExpectedPoints?.toFixed(1) ?? '?'} → modified ~${(ctx.baselineExpectedPoints + s.simulationResult.delta * 0.5)?.toFixed(1) ?? '?'}\n` +
        `  ${s.description}`
    )
    .join('\n\n');

  // Determine the pragmatic redirect target
  const pragmaticTarget = determinePragmaticTarget(ctx);

  return {
    system: `You are Keepwatch's editorial writer. You produce strategic analysis
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

## WRITING RULES
1. Name players, cite transfer fees, reference specific tactical issues.
2. Every claim must reference an actual simulation number from the scenarios.
3. When citing simulation results, say "the simulation projects" not
   "they would have got" — these are hypothetical estimates.
4. Do not reference "Scenario 2" or "Scenario 5" by number — describe
   them by what they contain ("the Paquetá retention scenario").
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
${perfectWorld.title}: ${perfectWorld.simulationResult.modifiedOdds.toFixed(1)}% (Δ${perfectWorld.simulationResult.delta.toFixed(1)}pp)

## SCENARIOS (ordered by plausibility for your Reality Check section)
${byPlausibility.map((s, i) =>
  `${i + 1}. "${s.title}" — plausibility ${s.plausibility.score}/100, result: ${s.simulationResult.modifiedOdds.toFixed(1)}% (Δ${s.simulationResult.delta.toFixed(1)}pp)\n   ${s.description}\n   Stress test: ${s.plausibility.reasoning}`
).join('\n\n')}

## BEST COMBINATION SCENARIO
${bestCombination
  ? `"${bestCombination.title}" — ${bestCombination.simulationResult.modifiedOdds.toFixed(1)}% (plausibility ${bestCombination.plausibility.score}/100)`
  : 'No combination scenario found.'}

## STRESS TEST FINDINGS
${ctx.stressTestFindings}

## PRAGMATIC REDIRECT TARGET
${pragmaticTarget.description}

## DIAGNOSIS CONTEXT
${ctx.diagnosisNarrative}

## DEPARTED PLAYERS
${ctx.departedPlayers?.map(p => `- ${p.name} (${p.overall} OVR, ${p.position}) → ${p.to} for ${p.fee}`).join('\n') ?? 'None identified'}

Write all four sections plus the bottom line. Follow the structure exactly.`,
  };
}
```

---

## The Pragmatic Redirect Logic

The synthesis prompt references a `pragmaticTarget` — this is computed before the agent runs, based on the team's current position and the scenarios explored.

### New Function: `determinePragmaticTarget()`

```typescript
interface PragmaticTarget {
  metric: string;          // e.g. "top14" or "survivalPct"
  label: string;           // e.g. "comfortable mid-table (10th-14th)"
  instruction: string;     // Injected into the synthesis prompt
  description: string;     // Injected into the user prompt
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
    // Relegation zone or close: redirect to comfortable survival
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
    // Mid-table: redirect to "secure top half"
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
```

---

## Updated SynthesisContext Type

The synthesis context needs additional fields to support the new prompt:

```typescript
interface SynthesisContext {
  teamName: string;
  targetLabel: string;
  targetMetric: string;
  baselineOdds: number;
  // NEW fields:
  baselineExpectedPoints: number;    // From full-season baseline sim
  baselineExpectedPosition: number;  // From full-season baseline sim
  currentPosition: number;           // From live standings
  scenarios: CounterfactualScenario[];
  diagnosisNarrative: string;
  stressTestFindings: string;
  perfectWorldOdds: number;
  // NEW:
  departedPlayers: DepartedPlayer[];
}
```

Ensure these are populated from the earlier pipeline phases before calling `buildSynthesisPrompt`.

---

## Scenario Summary Table

The synthesis prompt now pre-sorts scenarios by plausibility for the agent. But the rendered UI should also include a summary table at the top of the analysis view, giving the reader a reference as they read the narrative.

### Add to `WhatIfAnalysis.tsx`:

Before the narrative sections, render a compact scenario summary:

```tsx
{/* Scenario Summary Table */}
<div className="mb-6">
  <div className="font-oswald text-[11px] tracking-widest uppercase text-white/40 mb-2">
    Scenarios Explored
  </div>
  <div className="space-y-1">
    {[...analysis.scenarios]
      .sort((a, b) => b.plausibility.score - a.plausibility.score)
      .map((s) => (
        <div
          key={s.id}
          className="flex items-center justify-between text-[11px] py-1.5 px-3 rounded"
          style={{ background: 'rgba(255,255,255,0.02)' }}
        >
          <span className="text-white/60 flex-1 truncate">{s.title}</span>
          <span className="text-white/30 mx-3">
            {s.plausibility.score}/100 plausible
          </span>
          <span
            className="font-mono text-[11px]"
            style={{ color: s.simulationResult.delta > 0 ? '#4ade80' : '#ef4444' }}
          >
            {s.simulationResult.modifiedOdds.toFixed(1)}%
          </span>
        </div>
      ))}
  </div>
</div>
```

This gives the reader a mental map before they dive into the narrative. They can see at a glance: "Okay, the best realistic option is 6%, the ceiling is 20%, and most things land at 2-4%." Then the narrative explains *why*.

---

## Validation Criteria

After implementing V5B, run the West Ham → Top 7 analysis again. The narrative should satisfy:

### Perfect World Section
- [ ] Opens with full-season baseline numbers (expected points + probability), NOT remaining-games arithmetic
- [ ] States the ceiling clearly with one number
- [ ] Does NOT mention "7 games remaining" or "21 points available"
- [ ] 2-3 paragraphs, no more

### Reality Check Section
- [ ] Scenarios appear in plausibility order (most realistic first)
- [ ] Each scenario explicitly references the previous one ("Building on that...")
- [ ] The Todibo self-correction appears naturally within the defensive scenario
- [ ] Ends with the pattern/theme, not just the last scenario
- [ ] 3-4 paragraphs

### Pragmatic Path Section
- [ ] Contains an explicit pivot: "If [target] is off the table..."
- [ ] Identifies a LOWER, ACHIEVABLE target (e.g. mid-table safety)
- [ ] Contains at least one POSITIVE number (e.g. "92% survival probability")
- [ ] Explains WHY the lower target matters for the bigger picture
- [ ] Does NOT just say "everything is bad" in new words
- [ ] 2-3 paragraphs

### Long View Section
- [ ] Opens with historical context (where the club was 3-5 years ago)
- [ ] Does NOT repeat the pragmatic path
- [ ] Names 2-3 specific things that need to change for future seasons
- [ ] Closes with a timeline perspective
- [ ] 2-3 paragraphs

### Bottom Line
- [ ] Exactly 2 sentences
- [ ] Maximum 40 words
- [ ] Sentence 1: verdict with a number
- [ ] Sentence 2: the positive redirect

### Cross-Section Rules
- [ ] No point is repeated across sections
- [ ] No paragraph opens with "Let's"
- [ ] Every percentage cited traces to a specific scenario's simulation result
- [ ] Departed players are correctly framed as counterfactuals, not current squad
- [ ] No references to 2024-25 season data as if it were current
