# CLAUDE-ROUNDUP-V1B.md — Weekly Roundup: Final Polish

## Context

The Roundup V1A is at 8.5/10. This document covers the last set of fixes to reach 9/10. These are all prompt-level or filtering-level changes — no architectural work.

---

## Fix 1: Kill Redundant Newcastle Probability References

### The Problem

Newcastle's drop to 2.2% is stated in:
- The Shift overview paragraph ("their top-seven odds fell from 7.8% to 2.175%")
- Three Races European section ("their top-seven odds fell from 7.8% to 2.175% following defeat at Crystal Palace — a 5.625 percentage point decline that effectively ends their European ambitions")
- Perfect Weekend ("the actual movement was -5.63pp")
- Newcastle Deep Dive probability impact ("The defeat dropped that to 2.2% — a fall of 5.6 percentage points")
- Newcastle Deep Dive looking ahead ("Six games left, 2.2%")

The same number appears five times. The reader gets it after two.

### The Fix

Establish a **single-ownership rule** for key probability claims in the writing prompts. Each major number belongs to ONE section. Other sections can reference the consequence without restating the figure.

Add to the system prompt shared across all section agents:

```
## CROSS-SECTION REDUNDANCY RULE

Each major probability number should be STATED WITH FULL CONTEXT in 
exactly one section. Other sections may reference the CONSEQUENCE 
without repeating the exact figure.

Ownership:
- Target club's pre/post/delta probability → Newcastle Deep Dive ONLY
- Other clubs' probability shifts → Three Races ONLY  
- Perfect Weekend cumulative swing → Perfect Weekend ONLY
- Title race shifts → Three Races ONLY
- Relegation shifts → Three Races ONLY

Example of what to AVOID:
  Three Races: "Newcastle's top-7 odds fell from 7.8% to 2.2%"
  Deep Dive: "Newcastle's top-7 odds fell from 7.8% to 2.2%"

Example of what to DO:
  Three Races: "Newcastle's European hopes are covered in full below, 
  but in the context of the race, they've been swallowed by the surge 
  from beneath."
  Deep Dive: "Before the round, Newcastle sat at 7.8% for a top-seven 
  finish. The defeat dropped that to 2.2%."

The Shift overview may name Newcastle as a mover with the delta 
("Newcastle -5.6pp") but should NOT restate the full pre/post context 
— the tables show that.
```

**For the Perfect Weekend section specifically:** The commentary should focus on the gap between ideal and actual cumulative swing, not restate individual fixture deltas that appear in the Deep Dive. "Newcastle needed +8.4pp across the weekend. They got -5.6pp. The gap is 14 percentage points of lost ground" — then move on.

---

## Fix 2: Filter Zero-Delta Teams from Relegation Table

### The Problem

Burnley (0.0% → 0.0%) and Wolves (0.0% → 0.0%) appear in the relegation table with zero delta. They add no information — the reader can infer these clubs are going down without seeing a row of zeroes.

### The Fix

Tighten the relegation table filter in `injectShiftTable()`:

```typescript
const relegationTeams = shifts.filter(s =>
  // Must have non-trivial survival probability in at least one snapshot
  (s.preRound.survivalPct > 0.5 || s.postRound.survivalPct > 0.5) &&
  // AND must have a meaningful delta OR be in genuine danger
  (Math.abs(s.delta.survivalPct) > 0.5 || 
   s.preRound.survivalPct < 95 || 
   s.postRound.survivalPct < 95)
);
```

This removes teams at 0.0% survival in both pre and post (already dead) and teams at 100% in both (never in danger). Only teams with actual movement or genuine jeopardy appear.

---

## Fix 3: Trim Newcastle Deep Dive "Looking Ahead"

### The Problem

The probability impact section ends with a strong line: "That number is not quite zero, but it's closer to hope than probability." Then Looking Ahead repeats the same sentiment: "Six games left, 2.2% — Eddie Howe's side need results to go spectacularly wrong..."

The emotional beat lands once. Repeating it dilutes it.

### The Fix

Add to the Newcastle Deep Dive prompt:

```
## LOOKING AHEAD (final sub-section)

Keep this to exactly 1-2 sentences. Name the next fixture and what's 
at stake. Do NOT repeat the probability figure or restate the season 
verdict — the probability impact section has already delivered that. 
This is a bridge to next week's Preview, not a summary of this week's 
damage.

GOOD: "Next up: Newcastle host Burnley on Saturday — a fixture that 
should yield three points but can't undo what Selhurst Park took."

BAD: "With six games left and odds at 2.2%, Newcastle need a miracle. 
The margin for error is gone."
```

---

## Fix 4: Tighten Three Races European Section

### The Problem

The European section in Three Races is the longest sub-section and reads slightly dense. It covers ~8 teams across four paragraphs. The content is good but can be compressed without losing substance.

### The Fix

Add a length constraint to the Three Races prompt:

```
## LENGTH GUIDANCE

- Title Race: 1-2 paragraphs (the race is usually the least complex)
- European Race: 2-3 paragraphs maximum. Cover the 4-5 biggest movers 
  by name. Other teams can be mentioned in passing ("Brighton, Sunderland, 
  and Bournemouth all gained ground") rather than getting individual 
  sentences with full pre/post figures.
- Relegation: 2-3 paragraphs.

Total Three Races section: ~600-800 words. If you're above 800, cut 
the European section first — it tends to sprawl because there are 
more teams involved.
```

The specific compression: instead of giving Brighton, Sunderland, AND Bournemouth each their own sentence with full probability figures, group them: "Three clubs outside the top seven all made meaningful progress — Brighton (+10.7pp), Sunderland (+10.2pp), and Bournemouth (+7.9pp) — creating the kind of congestion that makes the final six rounds genuinely unpredictable." One sentence instead of three.

---

## Fix 5: Rapid Round Scorer Placeholder

### The Problem

Several Rapid Round entries are missing goal scorers (West Ham 4-0, Chelsea 0-3, Burnley 0-2, Arsenal 1-2). The ESPN integration will fix this permanently, but until then, the entries look inconsistent — some have scorers in parentheses, others don't.

### The Fix

Until ESPN is integrated, add to the Rapid Round prompt:

```
If goal scorers are available in the research data, include them in 
parentheses after the score: "Liverpool 2-0 Fulham (Ngumoha, Salah)".

If scorers are NOT available from research, omit the parentheses 
entirely rather than guessing. Do NOT fabricate scorer names. 
Consistency matters: either include verified scorers or leave them out. 
Never mix "(Ngumoha, Salah)" for one match with "(Unknown)" for another.
```

This makes the omission intentional rather than inconsistent. Once ESPN data flows in, every entry will have scorers.

---

## Summary

| Fix | What | Impact |
|-----|------|--------|
| 1 | Single-ownership rule for probability claims | Eliminates the "2.2% five times" problem |
| 2 | Filter 0.0% → 0.0% teams from relegation table | Cleaner table, no dead-weight rows |
| 3 | Looking Ahead to 1-2 sentences, no probability restatement | Stronger emotional landing |
| 4 | European section capped at 3 paragraphs, group minor movers | Tighter read |
| 5 | Scorer parentheses only when verified | Consistent until ESPN arrives |

## Estimated Implementation Time

1 hour. All five fixes are prompt text changes or single-line filter adjustments.

## Quality Checklist (After V1B)

- [ ] Newcastle's 2.2% (or equivalent) stated with full context in Deep Dive ONLY
- [ ] Three Races references Newcastle's situation without restating the number
- [ ] Perfect Weekend states cumulative gap without restating individual deltas from other sections
- [ ] Relegation table contains no rows where both pre and post round to 0.0%
- [ ] Looking Ahead is ≤2 sentences and does not repeat the probability figure
- [ ] Three Races European section is ≤3 paragraphs
- [ ] Minor European movers are grouped in a single sentence, not individual entries
- [ ] Rapid Round either has scorers in parentheses or omits them — no inconsistency
- [ ] Total Roundup word count: ~2,000-2,200 (down from ~2,500)
