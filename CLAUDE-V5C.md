# CLAUDE-V5C.md — What-If Final Polish

## Context

The What-If feature is producing 9/10 output. The full-season simulation works, temporal grounding is solid, narrative structure flows correctly, and the pragmatic redirect lands. This document covers the final polish items to close the gap.

---

## Fix 1: Relegation Zone Awareness

### The Problem

The Pragmatic Path section said West Ham are "four points above the relegation zone" while sitting 18th. In the Premier League, 18th IS the relegation zone (bottom 3 go down: 18th, 19th, 20th). The agent doesn't understand EPL relegation structure.

### The Fix

Add relegation context to `buildTemporalContext()` in `lib/what-if/prompts.ts`:

```typescript
// Append to the end of buildTemporalContext():

const relegationContext = `
### LEAGUE STRUCTURE REMINDERS
- Positions 18th, 19th, and 20th ARE the relegation zone. Being 18th
  means you ARE in the relegation zone, not "above" it.
- 17th is the LAST safe position — "just above the relegation zone."
- Top 4 = Champions League. Top 5 = UCL expanded. Top 6 = Europa League.
  Top 7 = Conference League / any European football.
- Bottom 3 get relegated to the Championship.

If ${teamName} is in 18th, 19th, or 20th, they are IN the relegation
zone. Do not say they are "above" or "near" it. They are IN it.`;

return temporalBlock + relegationContext;
```

---

## Fix 2: Pragmatic Redirect Gets a Real Simulation Number

### The Problem

The Pragmatic Path references survival probability "rising from the low 80s to above 95%" — but these are estimates, not simulation outputs. Every Top 7 scenario ran through the Monte Carlo engine, but the pragmatic redirect target (survival / mid-table) did not. This undermines the section's credibility since the rest of the analysis is grounded in hard numbers.

### The Fix

After the hypothesise phase completes and before the synthesis phase begins, run ONE additional simulation using the best realistic scenario's modifications but measuring the pragmatic target metric instead.

In `app/api/what-if/route.ts`, add to the `synthesise` action, before calling `buildSynthesisPrompt`:

```typescript
// ── Compute pragmatic redirect numbers ──

// Find the best realistic scenario (highest plausibility among those with meaningful delta)
const bestRealistic = scenarios
  .filter(s => s.category !== 'perfect_world' && s.plausibility.score >= 15)
  .sort((a, b) => b.simulationResult.delta * b.plausibility.score
                 - a.simulationResult.delta * a.plausibility.score)[0];

// Determine the pragmatic target metric based on current position
const pragmaticMetric = determinePragmaticMetric(position);
// e.g. position >= 15 → 'survivalPct'
//      position >= 8  → 'top10' (computed as positions 1-10)
//      position >= 4  → next tier down from targetMetric

let pragmaticSimResult = null;

if (bestRealistic && pragmaticMetric !== targetMetric) {
  // Run the full-season sim with the best realistic modifications
  // but read a DIFFERENT metric from the results
  const pragmaticResults = simulateFullSeason({
    teams,
    fixtures,
    modifications: bestRealistic.modifications.map(m => ({
      teamAbbr: m.teamAbbr ?? '',
      homeWinDelta: m.homeWinDelta ?? 0,
      awayWinDelta: m.awayWinDelta ?? 0,
      drawDelta: m.drawDelta ?? 0,
    })),
    numSims: 10000,
  });

  const pragmaticTarget = pragmaticResults.find(r => r.team === targetTeam);
  const pragmaticBaseline = baselineFullSeason.find(r => r.team === targetTeam);

  pragmaticSimResult = {
    metric: pragmaticMetric,
    metricLabel: PRAGMATIC_METRIC_LABELS[pragmaticMetric],
    baselineValue: readMetric(pragmaticBaseline, pragmaticMetric),
    modifiedValue: readMetric(pragmaticTarget, pragmaticMetric),
    scenarioTitle: bestRealistic.title,
    baselineExpectedPoints: pragmaticBaseline?.avgPoints ?? 0,
    modifiedExpectedPoints: pragmaticTarget?.avgPoints ?? 0,
    baselineExpectedPosition: pragmaticBaseline?.avgPosition ?? 0,
    modifiedExpectedPosition: pragmaticTarget?.avgPosition ?? 0,
  };
}

// Helper to determine the pragmatic metric
function determinePragmaticMetric(position: number): string {
  if (position >= 15) return 'survivalPct';
  if (position >= 8) return 'top10';
  return 'top7Pct'; // fallback
}

// Helper to read any metric from SimulationResult
function readMetric(result: SimulationResult | undefined, metric: string): number {
  if (!result) return 0;
  if (metric === 'survivalPct') return result.survivalPct;
  if (metric === 'top10') {
    return result.positionDistribution.slice(0, 10).reduce((a, b) => a + b, 0)
      / result.positionDistribution.reduce((a, b) => a + b, 0) * 100;
  }
  return (result as any)[metric] ?? 0;
}

const PRAGMATIC_METRIC_LABELS: Record<string, string> = {
  survivalPct: 'Premier League survival',
  top10: 'a top-10 finish',
  top7Pct: 'European qualification',
  top4Pct: 'Champions League qualification',
};
```

Then inject `pragmaticSimResult` into the synthesis prompt's user message:

```typescript
// Add to the user prompt in buildSynthesisPrompt:

const pragmaticNumbers = ctx.pragmaticSimResult
  ? `
## PRAGMATIC TARGET: REAL SIMULATION NUMBERS
Using the "${ctx.pragmaticSimResult.scenarioTitle}" modifications:
- ${ctx.pragmaticSimResult.metricLabel} probability: ${ctx.pragmaticSimResult.baselineValue.toFixed(1)}% baseline → ${ctx.pragmaticSimResult.modifiedValue.toFixed(1)}% modified
- Expected points: ${ctx.pragmaticSimResult.baselineExpectedPoints.toFixed(1)} → ${ctx.pragmaticSimResult.modifiedExpectedPoints.toFixed(1)}
- Expected position: ${ctx.pragmaticSimResult.baselineExpectedPosition.toFixed(1)} → ${ctx.pragmaticSimResult.modifiedExpectedPosition.toFixed(1)}

Use THESE numbers in the Pragmatic Path section. Do not estimate — cite them directly.`
  : '';
```

This means the Pragmatic Path can now say things like "The same managerial stability that produces a negligible 2.4% for Top 7 lifts survival probability from 82.3% to 96.7%" — grounded in an actual sim run, not a guess.

---

## Fix 3: Tone Calibration

### The Problem

The writing occasionally tips into melodrama. Examples from V3:
- "The simulation's baseline expected position of 16.2 is not an aberration. It is the squad speaking."
- "A one-in-seven lottery ticket purchased with a universe of good fortune."
- "You are not a contender with bad luck. You are a squad ranked 15th."

These aren't terrible, but one per section is enough. When every paragraph has a dramatic flourish, it becomes exhausting.

### The Fix

Add tone calibration to the synthesis system prompt. Insert after the existing writing rules:

```
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
```

---

## Fix 4: Scenario Summary Table in UI

### The Problem

The reader encounters six scenarios across four narrative sections without a reference table. They have to hold scenario names, numbers, and plausibility scores in their head while reading. The V4 Deep Analysis had stat cards at the top — the What-If analysis needs an equivalent.

### The Fix

Add a compact scenario reference table between the stat cards and the first narrative section in `app/components/WhatIfAnalysis.tsx`:

```tsx
{/* Scenario Reference Table — appears after stat cards, before narrative */}
<div className="mb-6">
  <div
    className="font-oswald text-[11px] tracking-widest uppercase mb-3"
    style={{ color: `${accentColor}90` }}
  >
    Scenarios Explored
  </div>
  <div
    className="rounded-lg overflow-hidden border"
    style={{ borderColor: 'rgba(255,255,255,0.06)' }}
  >
    {/* Header row */}
    <div
      className="grid grid-cols-[1fr_80px_80px_80px] gap-2 px-3 py-2 text-[10px] uppercase tracking-wider text-white/30"
      style={{ background: 'rgba(255,255,255,0.03)' }}
    >
      <span>Scenario</span>
      <span className="text-right">Plausibility</span>
      <span className="text-right">Exp. Pts</span>
      <span className="text-right">{analysis.targetMetricLabel}</span>
    </div>

    {/* Baseline row */}
    <div
      className="grid grid-cols-[1fr_80px_80px_80px] gap-2 px-3 py-2 text-[11px]"
      style={{
        background: 'rgba(255,255,255,0.01)',
        borderBottom: '1px solid rgba(255,255,255,0.04)',
      }}
    >
      <span className="text-white/40 italic">Baseline (no changes)</span>
      <span className="text-right text-white/30">—</span>
      <span className="text-right text-white/50 font-mono">
        {analysis.baselineExpectedPoints?.toFixed(1) ?? '—'}
      </span>
      <span className="text-right text-white/50 font-mono">
        {analysis.baselineOdds.toFixed(1)}%
      </span>
    </div>

    {/* Scenario rows, sorted by plausibility descending */}
    {[...analysis.scenarios]
      .sort((a, b) => b.plausibility.score - a.plausibility.score)
      .map((s, i) => (
        <div
          key={s.id}
          className="grid grid-cols-[1fr_80px_80px_80px] gap-2 px-3 py-2 text-[11px]"
          style={{
            background: i % 2 === 0
              ? 'rgba(255,255,255,0.015)'
              : 'rgba(255,255,255,0.005)',
            borderBottom: '1px solid rgba(255,255,255,0.03)',
          }}
        >
          <span className="text-white/60 truncate" title={s.title}>
            {s.title}
          </span>
          <span className="text-right text-white/40 font-mono">
            {s.plausibility.score}/100
          </span>
          <span className="text-right text-white/50 font-mono">
            {s.simulationResult.modifiedExpectedPoints?.toFixed(1)
              ?? (analysis.baselineExpectedPoints + s.simulationResult.delta * 0.5).toFixed(1)}
          </span>
          <span
            className="text-right font-mono font-medium"
            style={{
              color: s.simulationResult.delta > 2
                ? '#4ade80'
                : s.simulationResult.delta > 0
                  ? '#a3e635'
                  : '#ef4444',
            }}
          >
            {s.simulationResult.modifiedOdds.toFixed(1)}%
          </span>
        </div>
      ))}
  </div>
</div>
```

This gives the reader an immediate mental map: "The best realistic option is 8%, the ceiling is 15%, and most single interventions land at 2-4%." They can then read the narrative with context.

### Supporting Data: Add Expected Points to Scenario Output

For the scenario table to show expected points, each scenario's `simulationResult` should include the expected points. Update the `store_scenario` tool to capture this from the `run_simulation` response:

```typescript
// In the run_simulation tool response, add:
return {
  targetMetricPct: targetResult?.[targetMetric] ?? 0,
  expectedPoints: targetResult?.avgPoints ?? 0,       // ← make sure this is returned
  expectedPosition: targetResult?.avgPosition ?? 0,   // ← and this
  baselinePct: baselineResult?.[targetMetric] ?? 0,
  baselineExpectedPoints: baselineResult?.avgPoints ?? 0,
  delta: (targetResult?.[targetMetric] ?? 0) - (baselineResult?.[targetMetric] ?? 0),
};

// In the store_scenario tool, add to the stored object:
simulationResult: {
  targetMetric: args.simulationResult.targetMetric,
  baselineOdds: args.simulationResult.baselineOdds,
  modifiedOdds: args.simulationResult.modifiedOdds,
  delta: args.simulationResult.delta,
  modifiedExpectedPoints: args.simulationResult.expectedPoints,     // ← new
  modifiedExpectedPosition: args.simulationResult.expectedPosition, // ← new
}
```

Update the `CounterfactualScenario` type in `lib/what-if/types.ts`:

```typescript
simulationResult: {
  targetMetric: string;
  baselineOdds: number;
  modifiedOdds: number;
  delta: number;
  // NEW:
  modifiedExpectedPoints?: number;
  modifiedExpectedPosition?: number;
};
```

And add `baselineExpectedPoints` to the top-level `WhatIfAnalysis` type:

```typescript
interface WhatIfAnalysis {
  // ... existing fields ...
  baselineExpectedPoints?: number;    // NEW: from full-season baseline sim
  baselineExpectedPosition?: number;  // NEW: from full-season baseline sim
}
```

Populate these at pipeline start when the baseline sim runs.

---

## Fix 5: Populate Metadata Counters

### The Problem

`totalWebSearches`, `totalLLMCalls`, `wallClockTimeMs`, and `costEstimate` are being tracked in V3 (45 searches, 59 LLM calls, 594826ms) but `costEstimate` is still 0. For the demo, showing "45 web searches, 59 LLM calls, ~$1.80, 9.9 minutes" adds credibility.

### The Fix

Compute a rough cost estimate when assembling the final analysis:

```typescript
// In the synthesise action, before returning the final analysis:

const estimatedCost =
  (analysis.totalLLMCalls * 0.025) +    // ~$0.025 per LLM call (avg input+output)
  (analysis.totalWebSearches * 0.005);    // ~$0.005 per Serper/Tavily search

analysis.costEstimate = Math.round(estimatedCost * 100) / 100;
```

Display in the methodology footer in `WhatIfAnalysis.tsx`:

```tsx
<div className="text-[10px] text-white/25 pt-4 border-t border-white/5">
  Generated by Keepwatch V5 in {(analysis.wallClockTimeMs / 60000).toFixed(1)} minutes.
  {analysis.totalSimulations} Monte Carlo simulations ({(analysis.totalSimulations * 10000).toLocaleString()} season outcomes).
  {analysis.totalWebSearches} web searches across {analysis.totalIterations} scenarios.
  {analysis.totalLLMCalls} LLM reasoning steps.
  Estimated cost: ${analysis.costEstimate?.toFixed(2) ?? '—'}.
  Squad quality data from FC 26.
</div>
```

---

## Summary

| Fix | File(s) | Impact |
|-----|---------|--------|
| Relegation zone awareness | `lib/what-if/prompts.ts` | Prevents "above relegation zone" error for 18th-place teams |
| Pragmatic redirect simulation | `app/api/what-if/route.ts` | Grounds the Pragmatic Path in real sim numbers, not estimates |
| Tone calibration | `lib/what-if/prompts.ts` | Reduces melodrama, keeps one punchy line per section |
| Scenario summary table | `app/components/WhatIfAnalysis.tsx` | Gives readers a reference map before the narrative |
| Expected points in scenarios | `lib/what-if/types.ts`, tool executors | Enables the scenario table to show full data |
| Metadata counters | `app/api/what-if/route.ts`, UI | Shows search count, LLM calls, cost, and duration in footer |

Total estimated implementation time: 3-4 hours.

After these, run West Ham → Top 7 one more time. The output should have: correct relegation language, a Pragmatic Path citing an actual survival probability number from a sim run, no more than one dramatic flourish per section, a scenario reference table at the top, and a methodology footer with real stats.

That's the 10/10.
