# CLAUDE-ROUNDUP-V1A.md — Weekly Roundup: Post-V1 Fixes

## Context

The Weekly Roundup V1 shipped and produced a 7/10 output. This document specifies the fixes needed to reach 9/10. The issues fall into three categories: structural (section ordering and what sections exist), content (what each section should actually say), and technical (rate limiting, validation, table rendering).

---

## Fix 1: Revised Section Order and Cuts

### The Problem

The V1 section order was: The Shift → Preview Scorecard → Three Races → Newcastle Deep Dive → Result That Changed Everything → Rapid Round.

Issues:
- The Shift overview and Three Races cover similar ground, creating repetition
- The Preview Scorecard misunderstood its purpose (comparing predicted vs actual results instead of ideal Newcastle outcomes vs actual)
- "Result That Changed Everything" doesn't justify its own section — it overlaps with Three Races and adds length without enough new insight
- "Game of the Week" reference within the Scorecard has no clear reason to exist in the Roundup

### The Fix

New section order (5 sections, down from 6):

```typescript
export const WEEKLY_ROUNDUP_SECTION_ORDER = [
  'the-shift',           // Brief overview + probability table (REDESIGNED)
  'three-races',         // Title, Europe, Relegation — the main analysis
  'perfect-weekend',     // Newcastle's ideal scenario vs what actually happened
  'newcastle-deep-dive', // Target club match review + season impact
  'rapid-round',         // Every other fixture, 1-2 sentences each
] as const;
```

**Dropped:** `result-that-changed` (content absorbed into Three Races where relevant), `preview-scorecard` (replaced by `perfect-weekend` with corrected purpose).

**Renamed:** `preview-scorecard` → `perfect-weekend` to reflect its actual purpose.

---

## Fix 2: The Shift — Table Redesign

### The Problem

The current table shows every team with both Top 7 and Survival columns. This produces rows like:

```
TOT | 0.0% | 0.0% | +0.0pp | 65.6% | 35.6% | -30.1pp
```

The Top 7 data for Tottenham is useless — they were never in the European race. But it takes up half the row, and the actually important survival swing (-30.1pp) is buried on the right in teal text that's hard to read against the dark background.

### The Fix

Split the single table into **three mini-tables**, one per race. Each table only shows teams relevant to that race.

**Title Race table:** Only teams where |Δ championPct| > 0.5pp OR championPct > 5% in either pre or post. Typically 2-3 teams.

| Team | Pre Title | Post Title | Δ |
|------|-----------|------------|---|
| ARS  | 98.6%     | 92.9%      | -5.7pp |
| MCI  | 1.4%      | 7.1%       | +5.7pp |

**European Race table:** Only teams where |Δ top7Pct| > 1.0pp OR top7Pct > 5% in either pre or post.

| Team | Pre Top 7 | Post Top 7 | Δ |
|------|-----------|------------|---|

**Relegation table:** Only teams where survivalPct < 99% in either pre or post, OR |Δ survivalPct| > 2pp.

| Team | Pre Survival | Post Survival | Δ |
|------|-------------|---------------|---|

Each mini-table is preceded by a one-line label (e.g., "🏆 Title Race", "🇪🇺 European Places", "⬇️ Relegation Battle"). No prose framing paragraph needed — the Three Races section that follows provides all the narrative context.

**Implementation:** In `orchestrator.ts`, the `injectShiftTable()` function builds three filtered tables instead of one. The filtering logic:

```typescript
function buildShiftTables(shifts: ProbabilityShift[]): string {
  const titleTeams = shifts.filter(s => 
    Math.abs(s.delta.championPct) > 0.5 || 
    s.preRound.championPct > 5 || 
    s.postRound.championPct > 5
  );
  
  const europeTeams = shifts.filter(s => 
    Math.abs(s.delta.top7Pct) > 1.0 || 
    s.preRound.top7Pct > 5 || 
    s.postRound.top7Pct > 5
  );
  
  const relegationTeams = shifts.filter(s => 
    s.preRound.survivalPct < 99 || 
    s.postRound.survivalPct < 99 || 
    Math.abs(s.delta.survivalPct) > 2
  );
  
  // Build markdown tables for each, sorted by |Δ| descending
  // ...
}
```

**Colour note for UI:** The delta column should use green for positive movement and red for negative — but relative to what's GOOD for the team. For title and European tables, positive Δ = green. For relegation, positive Δ (survival going UP) = green. The current teal-on-dark is hard to read; switch to the same green/red accent scheme used elsewhere in Keepwatch.

---

## Fix 3: The Shift — Overview Paragraph

### The Problem

The overview paragraph said "all shifted materially in the same afternoon." Arsenal played Saturday, West Ham Friday, Tottenham Sunday, Man City Sunday, Man United Monday. Five days, not one afternoon.

### The Fix

Add a temporal awareness rule to the writing prompt:

```
MATCHDAY TIMING: Premier League matchdays span multiple days — typically 
Friday through Monday. NEVER say "in one afternoon" or "on the same day" 
unless ALL relevant matches genuinely occurred on the same date. Use 
"across the weekend", "over the matchday", or "in the space of four days" 
instead. Check the fixture dates in the dossier before making temporal 
claims.
```

Also: The Shift's framing paragraph should be kept to 2-3 sentences. V1 had three paragraphs — that's too much. The tables tell the story; the paragraph just names the biggest movers. Trim to:

```
Name the single biggest mover in each race (one sentence each). 
State the matchday number and rounds remaining. Do NOT write more 
than 3 sentences. The tables below carry the detail.
```

---

## Fix 4: Perfect Weekend — Corrected Purpose

### The Problem

The V1 "Preview Scorecard" compared predicted match results against actual results (e.g., "Arsenal were expected to beat Bournemouth; they lost"). This is wrong. The Perfect Weekend table in the Preview shows the IDEAL outcomes for Newcastle — the specific combination of results across the league that maximises Newcastle's top-7 probability. It doesn't predict what will happen; it defines what Newcastle NEEDS to happen.

The Roundup should therefore compare: "What did Newcastle need?" vs "What actually happened?"

### The Fix

Rename the section to `perfect-weekend`. Redefine its purpose in the prompt:

```
## PERFECT WEEKEND SECTION

This section compares the Preview's Perfect Weekend table — the ideal 
combination of results for Newcastle's European hopes — against what 
actually happened.

Structure:
1. A table showing each fixture, what Newcastle NEEDED (from the Preview's 
   Perfect Weekend), and what actually happened. Include a ✓/✗ column.
2. State how many of the 9 (or however many) ideal results landed.
3. Highlight the most damaging miss — the fixture where the gap between 
   ideal and actual hurt Newcastle most (use the predicted swing pp to 
   identify this).
4. State the cumulative impact: what was the maximum possible swing if 
   everything landed, and what was the actual swing?

This is NOT about whether the model "predicted" correctly. The Perfect 
Weekend is not a prediction — it is a wish list. Frame it as: "Newcastle 
needed X. They got Y. The gap cost them Z."

Tone: Matter-of-fact. No defensiveness. The model doesn't need to 
apologise for results going the wrong way.
```

**Format:** The Perfect Weekend table should be rendered programmatically (like The Shift table), not LLM-generated, to ensure accuracy:

```
| Fixture                    | Newcastle Needed | Actual  | ✓/✗ | Predicted Swing |
|----------------------------|-----------------|---------|-----|-----------------|
| Crystal Palace vs Newcastle | NEW win         | CRY 2-1 | ✗   | +5.37pp         |
| Arsenal vs Bournemouth      | ARS win         | BOU 2-1 | ✗   | +0.30pp         |
| Brentford vs Everton        | BRE win         | Draw    | ✗   | -0.10pp         |
| ...                         | ...             | ...     | ... | ...             |
```

Below the table, the writing agent adds 2-3 sentences of commentary: how many landed, what the biggest miss was, and what the cumulative actual swing was vs the predicted maximum.

**Drop "Game of the Week" entirely** from this section. It doesn't serve a purpose in the Roundup — the Preview flagged it for forward-looking reasons; the Roundup doesn't need to grade it.

---

## Fix 5: Three Races — Absorb "Result That Changed Everything"

### The Problem

The "Result That Changed Everything" was a separate section covering the Brentford-Everton draw's cascading impact. The content is good but the section is redundant — the mechanism (how one result affects multiple teams) belongs naturally inside the Three Races analysis.

### The Fix

Drop the standalone section. Instead, add this instruction to the Three Races writing prompt:

```
When a single result had cascading effects across multiple teams in a 
race, explain the MECHANISM — how the result transmitted through the 
standings to affect teams that weren't even playing. This is the most 
valuable analytical contribution you can make. Example: "Brentford's 
draw with Everton didn't just cost Brentford 2 points — it compressed 
the European places enough that Chelsea's margin above the cutoff 
shrank by 12.7pp without Chelsea touching a ball."

Do NOT dedicate more than one paragraph to any single cascade. Weave 
it into the race narrative rather than stopping the section to explain 
it separately.
```

---

## Fix 6: Newcastle Deep Dive — Preview Callback

### The Problem

The Deep Dive was almost entirely probability commentary with barely any football. The Preview made specific tactical predictions (Gordon vs Sosa, Nketiah's absence, Tonali/Joelinton handling Palace's press, Mateta as the central danger). The Roundup graded none of them.

### The Fix

Add to the Newcastle Deep Dive prompt:

```
## MANDATORY PREVIEW CALLBACK

The Weekly Preview made specific predictions about this match. You MUST 
reference at least 3 of them and grade them against what happened.

The Preview's key tactical claims are provided in your data. For each:
1. State what the Preview predicted (briefly, 1 sentence)
2. State what actually happened (1-2 sentences)
3. Grade it: was the prediction borne out, partially correct, or wrong?

Examples of good grading:
- "The Preview identified Gordon vs Sosa as the key channel. Gordon was 
  Newcastle's most dangerous player in the first half, drawing Glasner 
  into an early positional adjustment — the prediction landed."
- "The Preview flagged Mateta as the central danger. He was quiet for 
  88 minutes, then converted the stoppage-time penalty that killed the 
  match. The threat was right; the mechanism was unexpected."

Structure the section as:
1. Match narrative (score, scorers, key moments, how the game flowed) 
   — START with the football, not the probability
2. Preview callback (tactical prediction grading)
3. Probability impact (pre/post top-7, delta, what it means for the 
   season)
4. Looking ahead (1-2 sentences on next fixture)
```

Also: the Preview's match-focus section should be passed to this section agent in full (not summarised). The agent needs the actual tactical claims to grade them.

---

## Fix 7: Rapid Round — Factual Accuracy

### The Problem

"United's inconsistency continues to define a dismal campaign" — Man United are sitting in the top 4. That's not dismal.

### The Fix

Add league position context to the Rapid Round prompt:

```
For each fixture in the Rapid Round, you are provided with both teams' 
current league positions and probability data. Use this to calibrate 
your commentary. Do NOT describe a top-4 team's season as "dismal" or 
"disappointing" — check the standings before making seasonal judgments.

A team in 4th is having a good season even if they lose one match. 
A team in 18th losing is a crisis. Calibrate accordingly.
```

Also: pass each team's current position and points into the Rapid Round data slice so the agent has the context it needs.

---

## Fix 8: Rate Limiting — Serper 429s

### The Problem

The research phase fires ~28 web searches. Serper allows 5 requests/second. When queries fire in parallel, some hit 429s and fall through to Tavily (which works, but is the fallback, not the intended path).

### The Fix

Add a simple rate limiter to the research phase. In `lib/weekly-roundup/research.ts`:

```typescript
// Rate limit: max 4 requests per second to stay under Serper's 5/sec limit
const SEARCH_DELAY_MS = 250; // 4 per second

async function rateLimitedSearch(query: string): Promise<SearchResult> {
  await new Promise(resolve => setTimeout(resolve, SEARCH_DELAY_MS));
  return executeWebSearchDetailed(query);
}
```

Or, better: batch queries into groups of 4, fire each group in parallel, then wait 1 second before the next group.

```typescript
async function batchedSearch(
  queries: string[], 
  batchSize = 4
): Promise<SearchResult[]> {
  const results: SearchResult[] = [];
  
  for (let i = 0; i < queries.length; i += batchSize) {
    const batch = queries.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map(q => executeWebSearchDetailed(q))
    );
    results.push(...batchResults);
    
    // Wait between batches (not after the last one)
    if (i + batchSize < queries.length) {
      await new Promise(resolve => setTimeout(resolve, 1100));
    }
  }
  
  return results;
}
```

This adds ~7 seconds to the research phase (28 queries / 4 per batch = 7 batches × 1.1s delay) but eliminates all 429 errors.

---

## Fix 9: Editor Validation — Source Refs

### The Problem

The editor pass stripped source refs from the Newcastle Deep Dive, causing a validation failure:

```
Editor output failed validation: Section newcastle-deep-dive requires at least one source reference.
```

The system fell back to the pre-editor version, which is fine as a safety net but means the editor's improvements were lost.

### The Fix

Two changes:

1. **Editor prompt must preserve source refs.** Add to the editor system prompt:

```
CRITICAL: You MUST preserve all [source-N] references exactly as they 
appear in the input. Do not remove, renumber, or modify source references. 
If you rewrite a sentence that contains a source ref, keep the ref 
attached to the rewritten sentence.
```

2. **Validate before and after the editor pass.** If the editor output fails validation but the pre-editor output passed, log the specific failure and fall back (which is already happening). But also: check whether the editor is consistently stripping source refs — if it is, the editor prompt needs stronger constraints.

---

## Fix 10: Internal Language Leak

### The Problem

V1 output included: "Wolves — who don't appear in the probability dossier as a tracked club, suggesting they are already effectively down."

The reader has no idea what a "probability dossier" is.

### The Fix

Add to ALL section writing prompts:

```
NEVER reference the system's internal data structures, variable names, 
or pipeline terminology. The reader does not know what a "dossier", 
"research bundle", "simulation snapshot", "probability shift array", 
or "tracked club" is. Describe everything in plain football language.

BAD: "Wolves don't appear in the probability dossier as a tracked club"
GOOD: "Wolves look virtually certain to go down"

BAD: "The shift data shows a -5.4pp delta"  
GOOD: "Newcastle's European odds fell by 5.4 percentage points"
```

---

## Summary

| Fix | Section | What Changes | Impact |
|-----|---------|-------------|--------|
| 1 | All | 5 sections (drop result-that-changed, rename preview-scorecard → perfect-weekend) | Tighter, less repetitive |
| 2 | the-shift | Three mini-tables by race, filtered to relevant teams only | Cleaner data presentation |
| 3 | the-shift | Temporal accuracy rule + shorter overview paragraph | No "same afternoon" errors |
| 4 | perfect-weekend | Corrected purpose: ideal Newcastle outcomes vs actual, not predictions vs results | Fixes the core misunderstanding |
| 5 | three-races | Absorb cascade analysis from dropped section | Richer race narratives |
| 6 | newcastle-deep-dive | Mandatory Preview callback with tactical grading | The most important content fix |
| 7 | rapid-round | League position context in prompt | No "dismal" for 4th-place teams |
| 8 | research.ts | Batched search with 1.1s delays | Eliminates Serper 429s |
| 9 | orchestrator.ts | Editor preserves source refs | Editor pass no longer breaks validation |
| 10 | All prompts | No internal language in output | Cleaner reader experience |

## Estimated Implementation Time

3-4 hours. The table redesign (Fix 2) and Perfect Weekend correction (Fix 4) are the largest changes. The prompt fixes (3, 5, 6, 7, 10) are text-only updates. The rate limiter (Fix 8) is ~20 lines of code.

## Quality Checklist (After V1A)

Re-run the Roundup for Matchday 32 and check:

- [ ] The Shift shows three separate mini-tables with only relevant teams in each
- [ ] No team appears in a table where their delta rounds to 0.0pp
- [ ] Overview paragraph does NOT say "same afternoon" or "single Saturday"
- [ ] Perfect Weekend table shows Newcastle's IDEAL results vs ACTUAL results
- [ ] Perfect Weekend commentary frames misses as "Newcastle needed X, got Y" not "the model predicted X"
- [ ] Three Races includes at least one cascade mechanism explanation
- [ ] Newcastle Deep Dive starts with match narrative (score, scorers, game flow)
- [ ] Newcastle Deep Dive references at least 3 Preview tactical predictions and grades them
- [ ] Rapid Round does not describe a top-4 team's season as "dismal"
- [ ] No internal language ("dossier", "research bundle", "tracked club") in any section
- [ ] Zero Serper 429 errors in terminal logs
- [ ] Editor pass does not strip source refs
- [ ] Total sections: 5 (not 6)
