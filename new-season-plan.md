# new-season-plan.md — implementation plan for the 2026-27 season-start overhaul

**Source spec:** `new-season.md`
**Written:** 2026-08-19 (Wednesday). Matchday 1 is Friday 2026-08-21.
**Repo baseline:** `main` @ a328f0d, clean. 39 tests passing (`npm test`), 8 test files.

This plan follows the spec's five steps and its sequencing. Where I verified a claim
against the code, that is marked ✅. Where the code differs from what the spec assumed,
that is marked ⚠️ and the plan adapts. Four items are new findings the spec does not
cover; they are in §0 and §6.

---

## Verification of the diagnosis

Every failure in the spec's D1–D5 is real and lands where the spec says it does.

| | Claim | Status |
|---|---|---|
| D1 | `teamElo()` returns 1500 for all 20 clubs at `played === 0` | ✅ `lib/elo.ts:6-9` |
| D1 | Four call sites | ⚠️ **Five.** `lib/live-data.ts:288`, `lib/fixture-generator.ts:25`, `lib/what-if/full-season-sim.ts:68`, `app/components/Dashboard.tsx:872` — plus `eloProb` is consumed independently in each. All five go through the stable `teamElo(team)` signature, so the spec's "change internals only" strategy holds. |
| D2 | `HARDCODED_STANDINGS` / `KNOWN_FIXTURES` are last season's data on the fallback path | ✅ `lib/constants.ts:16,40`; served from `lib/live-data.ts:150,189` and `Dashboard.tsx:676,730,892` |
| D3 | `generateRemainingFixtures` hardcodes matchday 32 | ✅ `lib/fixture-generator.ts:51` |
| D4 | Sensitivity noise ≫ signal, and the `EPSILON = 1e-9` filter removes nothing | ✅ `lib/sensitivity.ts:27,82` — and measured below |
| D5 | `GOAL_PARAMS` decouples GD from team strength | ✅ Present in **three** copies (see ⚠️ S1 below) |

### The spec's arithmetic checks out
`SE = sqrt(0.30 × 0.70 / 1000) = 0.0145` → ±1.45pp; unpaired difference SE
`= √2 × 1.45 = 2.05pp`. Confirmed.

---

## §0. New findings the spec does not cover

### ⚠️ S1 — There are three copies of the simulation engine, not one

The spec's Step 3.1 says "add a seeded PRNG to `lib/montecarlo.ts`". That file is one of three:

| Engine | File | Consumed by |
|---|---|---|
| `simulate()` | `lib/montecarlo.ts` | Dashboard (client), `lib/sensitivity.ts` |
| `simulateFull()` — comment says "exact copy of client-side simulate()" | `lib/server-simulation.ts:26` | Weekly Preview dossier, Weekly Roundup dossier, `lib/path-search.ts`, `/api/what-if` |
| `simulateFast()` | `lib/server-simulation.ts:121` | `lib/path-search.ts` greedy inner loop |
| `simulateFullSeason()` — a fourth, replays all 380 from zero | `lib/what-if/full-season-sim.ts` | What-If agent tools |

Seeding only `montecarlo.ts` leaves the Weekly Preview's Perfect Weekend table and the
Deep Analysis path search running on unpaired `Math.random`. `GOAL_PARAMS` and
`sampleGoals` are duplicated verbatim across all four. **The seeding work must be done
once, in a shared module, and all four engines must consume it** — otherwise Step 3 is
half-applied and Appendix A1 (Dixon-Coles) has four places to change instead of one.

### ⚠️ S2 — `lib/path-search.ts` has its own private sensitivity scan

The spec says "every consumer of `sensitivityScan` must be updated". But the Deep
Analysis brain and the V4 inverse scenario search do **not** call `sensitivityScan`.
`lib/path-search.ts:124-168` reimplements the scan inline against `simulateFast`. It
carries the same defect, and it will not be fixed by touching `lib/sensitivity.ts`.
Likewise `lib/weekly-preview/dossier.ts:229-262` reimplements it a third time for the
Perfect Weekend table. Three implementations, one bug.

### ⚠️ S3 — The Weekly Preview's determinism is *deterministic noise*, which is worse

`lib/weekly-preview/dossier.ts:119-146` already has `mulberry32` and a
`withSeededRandom()` wrapper that monkey-patches `Math.random`. But every run gets a
**different** seed: baseline uses `` `${seedBase}:baseline` ``, each locked run uses
`` `${seedBase}:perfect:${fixture.id}:${result}` ``. So the runs are reproducible but
*not paired* — the deltas carry the full unpaired sampling error, and they are stable
across reruns. A reader who reruns the preview and sees the same numbers will conclude
they are solid. They are not. This is more deceptive than visible noise and should be
fixed in the same pass as Step 3.1.

### ⚠️ S4 — At Matchday 0 the app does not just lie, it hangs

The number of scheduled fixtures goes from ~70 to 380. Both the sensitivity scan and the
path search are O(fixtures²) in effect — more fixtures to lock, and each simulation is
longer. Measured on this machine (Node 24, M-series; the browser will be slower and it
runs on the **main thread**):

| | ~70 scheduled (March) | 380 scheduled (MD0) |
|---|---|---|
| `simulate()` 10,000 sims | 140 ms | 609 ms |
| `sensitivityScan()` @1000 sims — Dashboard, client-side | **2.7 s** | **62.7 s** |
| path-search sensitivity scan @1000 sims — server-side | 2.0 s | 24.6 s |
| path-search full run (8 locks, branchDepth 3) | ~25 s | **~85 s** |

`Dashboard.tsx` calls `sensitivityScan` on mount (line 979), on re-run (916), and on
every team change (1002). At MD0 that is a frozen tab for a minute or more, three times
over. No `maxDuration` is declared on any route (`grep` finds none), so
`/api/deep-analysis` will also likely exceed its Vercel limit at MD0.

This matters for the plan because it changes *why* Step 3.2 exists. The spec presents
horizon-scaled leverage as an honesty fix. It is also the only thing in the spec that
makes the dashboard usable on Friday. See §3 for a better answer.

### ⚠️ S5 — Three clubs change, and five separate club→abbr maps encode last season's twenty

Promotion and relegation replace three clubs. These all hardcode the 2025-26 set:

- `lib/constants.ts:55` `TEAM_NAME_MAP` (football-data.org names)
- `lib/constants.ts:79` `ODDS_API_NAME_MAP` (the-odds-api names)
- `lib/team-colours.ts:1` `TEAM_COLOURS`
- `lib/what-if/fifa-data.ts:8` `CLUB_TO_ABBR`
- `lib/espn.ts:78` (ESPN names)
- plus `injury-scraper/injury-scraper.py` `CLUB_ABBR_MAP`

`TEAM_NAME_MAP` falls back to football-data's `tla`, so a promoted club still gets *an*
abbreviation — but it will not match `ODDS_API_NAME_MAP`, so **that club's fixtures
silently lose bookmaker odds and fall back to Elo**, and it has no colour. This is
prerequisite work for Step 1: the priors table is keyed by abbreviation, so the
abbreviations have to be right and consistent first.

### ⚠️ S6 — The LLM prompts assert the wrong season and the wrong date

Roughly 30 hardcoded strings across `lib/what-if/prompts.ts`, `app/api/deep-analysis/route.ts`
and `lib/weekly-preview/fact-check-prompts.ts`, including:

- `lib/what-if/prompts.ts:47` — `"1. The CURRENT season is 2025-26. We are in March 2026."`
- `lib/what-if/prompts.ts:48` — `"2. The PREVIOUS season was 2024-25."`
- `lib/what-if/tools.ts:333-341` — auto-appends `"2025-26"` to every web search query
- `app/api/deep-analysis/route.ts:132,251` — `"The Premier League season is 2025-26."`
- `lib/weekly-preview/dossier.ts:468` — `season: '2025-26'` written into the dossier and
  the Supabase `unique (season, matchday, club_abbr)` key

On Friday these instruct the research agents to search for last season and to treat this
season's transfers as "departures". The fact-checker will then "correct" true statements
against last season's reality. Not in the spec's five steps, but it is a correctness bug
of the same family as D2, and the Ledger (Step 5) writes a `season` column that would be
wrong from row one. Recommend folding into Step 1.0 as a mechanical sweep.

---

## §1. Step 1 — Preseason prior + Bayesian blend

Follows the spec. Ordering within the step is the spec's.

### 1.0 Quarantine the stale constants — *blocking, do first*

1. `lib/constants.ts`: rename `HARDCODED_STANDINGS` → `FALLBACK_STANDINGS_2025_26`,
   `KNOWN_FIXTURES` → `FALLBACK_FIXTURES_2025_26`. Add `FALLBACK_SEASON = '2025-26'`
   and `CURRENT_SEASON = '2026-27'`.
   → verify: `npm run lint` and `npx tsc --noEmit` clean; the two preview test files
   that import these (`lib/weekly-preview/dossier.test.ts:3`,
   `validators.test.ts:7`) updated and still green.
2. `lib/live-data.ts`: change the `source` union from `'hardcoded'` to
   `'stale-fallback'` and thread it through `LiveSnapshot`.
3. `app/components/Dashboard.tsx`: on `stale-fallback`, render the persistent
   non-dismissible banner and **do not run `simulate()` or `sensitivityScan()`**.
   Render the empty state instead. Also remove the two unconditional uses of the
   fallback constants at lines 676 and 730 — the initial `useState` currently seeds the
   table with last season's standings before any fetch resolves, so last season's table
   is what renders on first paint even on the happy path.
   → verify: with `FOOTBALL_DATA_API_KEY` unset, the app shows the banner and no
   percentages anywhere.
4. `lib/fixture-generator.ts`: derived `baseMatchday`; early `return []` when
   `knownFixtures.length >= 380`, with a log line.
   → verify: unit test asserting `[]` for a 380-fixture input, and that a 5-fixture
   input at matchday 7 generates matchday 8+, never 32.
5. §S6 sweep: replace the hardcoded season/date strings with `CURRENT_SEASON` and an
   injected current date.
   → verify: `grep -rn "2025-26" lib app` returns only `FALLBACK_*` and archival files.
6. §S5 sweep: update all six club maps to the 2026-27 twenty.
   → verify: a test asserting every abbreviation in the live standings has an entry in
   `TEAM_NAME_MAP`, `ODDS_API_NAME_MAP`, `TEAM_COLOURS`, and `CLUB_TO_ABBR`.

### 1.1 `lib/ratings/priors.ts`

As specified. The spec is explicit and I will follow it: **do not invent the club list or
last season's final table.** Derive both from football-data.org, write the resulting
table into the file as static literals, and record `PRIORS_GENERATED_AT`.

⚠️ **This is blocked on credentials.** There is no `.env` / `.env.local` in the repo
(`.env*` is gitignored and no file is present), so I cannot reach football-data.org, and
I cannot confirm whether the current plan permits the previous-season filter
(`?season=2025`) — the free tier typically does not. Fallback if it does not: derive
2025-26 final PPG from the archived table already in the repo. See §7 Q2.

### 1.2 Rewrite `lib/elo.ts`

Exactly as the spec writes it: keep `teamElo(team: Team): number`, add `priorWeight()`
and `eloBreakdown()`, keep `eloProb()` untouched. `formElo()` stays private — that is
the seam for A1.

### 1.3 Confidence indicator in the UI

`Model confidence: N% evidence, M% preseason prior (k matches played)` near the
probability cards, driven by `priorWeight(team.played)`, plus the tooltip.

### 1.4 Validation

The spec's five assertions, as real tests in `lib/ratings/priors.test.ts` and
`lib/elo.test.ts`. Then the eyeball check on the MD0 projected table — and per the
spec, the eyeball wins over the test.

---

## §2. Step 2 — Outright markets

Follows the spec, including its ordering (the-odds-api first, Kalshi second) and its
instruction to **discover** the futures sport key rather than guess it.

- `lib/odds/outrights.ts` — `GET /v4/sports/?all=true`, filter `has_outrights === true`,
  de-vig by reusing `oddsToProb`/`averageBookmakerOdds` from `lib/odds-converter.ts`
  (they generalise cleanly; no duplication), normalise across the 20 clubs.
- `lib/odds/kalshi.ts` — `KXPREMIERLEAGUE` series, unauthenticated reads, cents as
  probability, `KALSHI_NAME_MAP` in `constants.ts`. Capture win-totals if present.
  Record the US-liquidity caveat in the file.
- `npm run priors:check` — the comparison table. CLI rather than `/admin/priors`: it is
  the artifact the spec actually wants (something to read on Wednesday night and act on),
  and it avoids shipping an unauthenticated admin route.
- Manual prior adjustments only, each with a `// reason:` comment in `priors.ts`.
  No automated fitting — that is A2.

⚠️ Blocked on the same credentials, plus quota state. Also needs the subscription-tier
check the spec calls for: if outrights are gated, note it and fall through to Kalshi.

---

## §3. Step 3 — Make leverage honest

This is where I want to deviate from the spec, on the strength of measurement rather than
preference. The spec's Step 3 is right about the disease and I think mis-prescribes the cure.

### What I measured

**The spec's CRN design does not deliver what it claims.** `sampleGoals()` is a
rejection sampler — it consumes a *variable* number of draws (a home win costs two calls,
a draw one). With one `mulberry32` stream per simulation, the moment the locked fixture's
outcome differs from baseline the stream desynchronises and every subsequent fixture in
that simulation diverges. Measured, locking one fixture, 1000 sims, 24 trials:

| Scheme | SD of the delta |
|---|---|
| Unpaired `Math.random` (today) | 1.771 pp |
| One `mulberry32` stream per sim (**the spec's design**) | 0.969 pp |
| Independent substream per (sim, fixture, draw) | 0.777 pp |

So 1.8×, not the "10–100×" the spec promises. The right fix is a **stateless
counter-based PRNG keyed on (sim, fixture, draw)**, so a divergence in one fixture cannot
contaminate the others. I tested two mixing functions; additive mixing into a murmur3
finaliser is collision-free over the real index space (1,520,000 draws, 1,520,000
distinct) where XOR mixing loses ~630, and both pass χ² uniformity and lag-1 correlation
on all three axes. Use the additive variant.

**The `noiseFloorPp` formula guesses a constant that we can compute exactly.** The spec's
`paired ? se * 0.3 : se * SQRT2` assumes a variance-reduction factor. Measured against
ground truth for one lock, `se * 0.3` gives a 0.738pp floor where the true paired SD is
0.748pp — close by luck in that one case, but it is a single global constant standing in
for a quantity that varies per fixture and per metric. The alternative costs nothing: if
baseline and locked worlds are stepped together, accumulate the per-simulation difference
`d_s ∈ {-1, 0, +1}` and the standard error of the delta falls out exactly,
`SE = sd(d_s)/√N`. Validated: reported SE 0.654pp against an observed SD of 0.748pp
across 24 trials (within 1σ given 24 samples). That turns the noise floor from a formula
into a measurement, which is precisely the honesty commitment in Appendix B.

**And the whole compute problem dissolves.** A locked world differs from the baseline
world in exactly one fixture. So there is no need to re-simulate 380 fixtures per lock:
simulate the baseline season once per simulation, then *patch* the one fixture and
recompute only the target's rank (an O(20) scan, no re-sort). Prototyped against the
same 380-fixture MD0 workload:

| | Current engine | Patch-and-rerank |
|---|---|---|
| Baseline + all 1140 fixture×outcome comparisons, 1000 sims | 62,700 ms | **179 ms** |
| Same at 20,000 sims | — | **3,376 ms** |
| Median SE across the 1140 comparisons, 20,000 sims | — | **0.049 pp** |

**This overturns the spec's central conclusion about August.** The spec reasons: signal
is 0.2–0.4pp, noise is 2.05pp, therefore no individual fixture is measurable at 38
rounds, therefore suppress fixture-level leverage and the Perfect Weekend table. The
first premise is fine. The second is an artefact of an unpaired scan pinned at 1000 sims
because 1000 sims was all the old engine could afford. At 20,000 paired sims the 95%
floor is **2 × 0.049 ≈ 0.10 pp** — a 2–4× margin under a 0.2–0.4pp signal. Fixture-level
leverage is measurable at Matchday 0. It just was not affordable before.

(Caveat on the numbers: the prototype league is 20 equal-strength clubs, which inflates
per-fixture signal relative to a real priors-driven table. The SEs are what I would
defend; the deltas are illustrative. I will re-measure against real priors once §1.1
lands, before deciding whether the Perfect Weekend table renders.)

### What I propose to build

**3.1 — Shared seeded RNG.** New `lib/sim/rng.ts` exporting the counter-based
`hashRand(sim, fixture, draw)`. Extend all four engines (§S1) with an optional
`seed?: number`; unseeded call sites keep `Math.random` and keep working. Replace both
the outcome draw *and* the `sampleGoals` draws, per the spec. Fix §S3 by pairing the
Weekly Preview's baseline and locked runs on one seed instead of three.
→ verify: the spec's own test — `assert(seededVariance < unseededVariance / 5)` —
against the substream design, which is the only one of the three that clears it.

**3.2 — Paired leverage engine.** New `lib/leverage/paired-scan.ts`: baseline once per
sim, patch per candidate, exact `deltaPp` and `sePp` per comparison. Rewrite
`lib/sensitivity.ts` over it, keeping the `sensitivityScan` signature so the three
Dashboard call sites are untouched. Add `sePp`, `belowNoiseFloor` and `noiseFloorPp` to
`SensitivityResult`. Point `lib/path-search.ts` (§S2) and the Weekly Preview dossier
(§S2) at the same engine, deleting both duplicate scans.
→ verify: paired-scan deltas agree with the current re-simulate scan within their stated
CIs on a 70-fixture March fixture set (regression check against known-good behaviour);
`npm test` green; Dashboard mount-to-interactive under 5 s at MD0.

**3.3 — Noise floor.** `noiseFloorPp = 2 × sePp`, computed per comparison. Filter
`belowNoiseFloor` out of the ranked list, replacing the inert `EPSILON = 1e-9`. Keep the
spec's plain-language empty state for when everything falls below the floor. Update
`SensitivityChart.tsx`, `KyleLeverageList.tsx` (currently a bare `.slice(0, 5)` with no
floor), the Deep Analysis prompt-side consumers, and the Perfect Weekend table to handle
an empty or sparse list.

**3.4 — Horizon-scaled leverage: keep it, reframe it.** `selectLeverageUnit()` and
month/matchday bundles as the spec specifies — but as an *editorial* choice, not a
workaround. "Newcastle's season is decided in a five-week window from late October" is a
better August story than a list of 380 fixtures, and it stays true. The difference from
the spec is that fixture-level leverage remains available and honest underneath it, so
the Perfect Weekend table renders if and only if its entries clear their own measured
floor — decided by measurement in §1.4, not by a calendar rule.

**If you would rather I not touch the engine:** the spec as written is still shippable —
per-substream RNG (this is not optional; the spec's version does not work), the formula
floor, and month-bundles-only, which cuts 1140 comparisons to ~27 and gets MD0 under
2 s. It leaves three duplicate scans in place and a guessed constant in the floor. See §7 Q1.

---

## §4. Step 4 — Odds snapshot cron — *do early, irreversible value*

Schema and job exactly as the spec writes them, including `raw jsonb` stored
unconditionally and the three indexes.

⚠️ **The spec's scheduling premise is wrong:** there is no `.github/` directory in this
repo, and the injury scraper has no CI — it is a local script. So "same pattern as the
injury scraper" does not exist to copy. The repo's actual scheduler is **Vercel cron**
(`vercel.json` already runs `/api/cron/weekly-preview` on `0 6 * * 5`). Recommend
`/api/cron/snapshot-odds` on `0 6,12,18,22 * * *` — one mechanism, one place to look, no
new secret store. See §7 Q4.

Either way: never fail the whole job on one source erroring, and budget the
the-odds-api calls explicitly in a comment against the 500/month quota.

Runtime choice: TypeScript, not Python. The spec says "match whatever is already there";
what is already there for *scheduled work* is TypeScript API routes, and the fetch and
de-vig logic is being written in TypeScript for Step 2 anyway.

---

## §5. Step 5 — The Preseason Ledger

Schema as specified. The `unique (season, matchday, model_version, team)` constraint is
the immutability mechanism and **no upsert path gets written** — the repo has an existing
upsert helper pattern in `lib/weekly-preview/cache.ts`; this table deliberately does not
get one.

- Brier for the binary metrics; RPS implemented properly for final position.
- The artifact: projected table, position histograms, the Step 1.3 confidence statement
  prominently, a short preamble in the existing Weekly Preview voice, and the
  model-vs-market disagreements from Step 2.
- Published, timestamped, permanently linked from the dashboard, then never touched.

Depends on §1 and §2. Ships Thursday.

---

## §6. Deliberately out of scope

Confirming the spec's seams are where it says they are:

- **A1 Dixon-Coles / D5.** ⚠️ The seam is weaker than the spec thinks: `formElo` is
  isolated behind a stable `teamElo`, ✅ — but `GOAL_PARAMS` and `sampleGoals` exist in
  four copies (§S1). The §3.1 shared-RNG work consolidates them, which is what actually
  makes A1 a two-function change instead of a four-file one.
- **A2 market-implied fitting.** `PRIORS_SOURCE` anticipates `'market_fitted'` ✅. Note
  that patch-and-rerank makes each optimiser evaluation ~350× cheaper, which changes the
  A2 compute budget conversation substantially.
- **A3 backtesting.** `projections` / `projection_scores` shaped for backfill ✅.
- Deep Analysis timeout hardening (§S4) — worth a `maxDuration` export regardless, but
  §3.2 removes the underlying cause.

---

## §7. Decisions taken

Answered 2026-08-20:

1. **Sensitivity engine** → **paired patch-and-rerank engine** (§3, the recommended
   route). Three duplicate scans consolidate into one; noise floor is measured per
   comparison, not assumed.
2. **Season-rollover sweep (§S5, §S6)** → **both, before Step 1.1.**
3. **Odds cron** → **Vercel cron**, `/api/cron/snapshot-odds` on `0 6,12,18,22 * * *`,
   alongside the existing weekly-preview entry in `vercel.json`.
4. **Supabase** → **write `.sql` into `supabase/migrations/`; Harry applies them.**
   Nothing touches production DDL from here.

### Still open — blocks 1.1, 2, the Step 4 job, and 5

No `.env` in the repo. Needed:

- `FOOTBALL_DATA_API_KEY` — Steps 1.1 (club list + 2025-26 final PPG), 4
- `ODDS_API_KEY` + current quota state — Steps 2, 4
- `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` — Steps 4, 5

Two unknowns I cannot check without them: whether the football-data plan permits the
previous-season filter (`?season=2025`), and whether outrights are gated on the current
the-odds-api tier.

**Work order under the blocker:** everything that does not need live data goes first —
Step 1.0, the §S6 season-string sweep, all of Step 3, and the Step 4/5 migration files.
The §S5 club maps and §1.1 priors table need the live club list and wait.

## §7a. Status — 2026-08-20

Verification at each step: `npx tsc --noEmit` clean, `npx eslint lib app` clean (5
pre-existing warnings, none new), `npx vitest run` green, `npm run build` passes.
Test count 39 at baseline → **66**.

### Done

**Step 1.0 — stale constants quarantined.**
`HARDCODED_STANDINGS` → `FALLBACK_STANDINGS_2025_26`, `KNOWN_FIXTURES` →
`FALLBACK_FIXTURES_2025_26`, both with docblocks saying they must never be
simulated. Source label `'hardcoded'` → `'stale-fallback'` through
`lib/live-data.ts`. `Dashboard.tsx` no longer seeds its initial state or its
`allFixtures` memo from last season's table (it did both, so last season's
standings rendered on first paint even on the happy path), drops the
`nextFixtures.length === 0` fallback, gates every `simulate`/`sensitivityScan`
call on `staleData`, and renders a persistent non-dismissible banner plus an
honest empty state. Verified live: with no `FOOTBALL_DATA_API_KEY`, both
`/api/standings` and `/api/fixtures` return `source: 'stale-fallback'`.

`lib/fixture-generator.ts`: `matchday: 32 + …` → derived from the last known
matchday; early `return []` when ≥380 fixtures are known. Three new tests.

**§S6 — season sweep.** `CURRENT_SEASON`, `SEASON_START_YEAR` and a *derived*
`PREVIEW_SEASON` in `constants.ts`; ~30 hardcoded strings replaced across
`what-if/prompts.ts`, `what-if/tools.ts`, `deep-analysis/route.ts`,
`weekly-preview/{dossier,fact-check-prompts}.ts`, `chat/route.ts`,
`DeepAnalysisChat.tsx`, `what-if-cache.ts`. Two of my own substitutions landed in
a single- and a double-quoted string, which would have sent `${CURRENT_SEASON}`
to the model verbatim; caught by inspecting quote style at every site and fixed.
Four tests assert the temporal block interpolates and names the right season.

Two judgement calls inside the sweep rather than blind renaming:
- The prompt hardcoded *"Nottingham Forest finished 7th in 2024-25"* as its
  worked example. Generalised to "a club's finishing position last season tells
  you nothing about where they sit now" — substituting a fresh club-specific
  claim would mean inventing one.
- The FC26 squad dataset (`data/FC26_20250921.csv`, a September 2025 snapshot) is
  a full season stale for 2026-27. The prompt asserted *"ONLY the players listed
  above are confirmed at X for 2025-26"*; simply swapping the season label would
  have made that assertion false. It now describes the snapshot as predating the
  2026 window and requires verification. **Flagging separately: the squad data
  itself is stale and no rename fixes that.**

**Step 3.1 — shared seeded RNG** (`lib/sim/rng.ts`). Counter-based `hashRand`
with a substream per (sim, fixture, draw). Also `lib/sim/goals.ts`, which
consolidates the `GOAL_PARAMS` table that existed in four copies — this is the
A1 seam.

**Step 3.2 — paired leverage engine** (`lib/leverage/paired-scan.ts`, 341 lines).
Baseline season once per iteration, patch per candidate, exact per-comparison
standard error. Seven tests, the two load-bearing ones being: the baseline
agrees with the production `simulate()`'s own metric within Monte Carlo error
(which validates probabilities, Poisson scorelines, EPL tiebreakers and ranking
together), and the reported SE tracks the observed spread of the delta across 16
independent trials.

Measured on the 380-fixture MD0 workload, 1140 comparisons:

| | old `sensitivityScan` | paired engine |
|---|---|---|
| @1,000 sims | 59,838 ms | 485 ms |
| @5,000 sims | — | 2,423 ms (median floor 0.24pp) |
| @20,000 sims | — | 9,742 ms (median floor 0.12pp) |

**Step 3.2b — the three duplicate scans collapsed into one.**
`lib/sensitivity.ts` rewritten over the engine, signature preserved, plus
`sensitivityScanDetailed` returning the summary the UI needs to report honestly.
`lib/path-search.ts`'s private scan deleted; its greedy loop now runs one paired
scan per step instead of a separate 1000-sim run per candidate. **MD0 path search
6.6 s, down from ~85 s**, which removes the Deep Analysis timeout risk.
`lib/weekly-preview/dossier.ts`'s private scan deleted too.

**Step 3.3 — noise floor.** `noiseFloorPp = 2 × sePp`, measured per comparison,
replacing the inert `EPSILON = 1e-9`. Below-floor fixtures are filtered out of
the ranked list. `SensitivityChart` gained a distinct below-floor state that says
so in words and falls back to window-level leverage; `KyleLeverageList`'s empty
state now says why it is empty. The Perfect Weekend table is suppressed when
nothing in the round is measurable — and, critically, its allowed numeric claims
go empty in that state, so the existing validator *forbids* any pp figure from
appearing rather than trusting the prompt.

**Step 3.4 — horizon-scaled leverage** (`lib/leverage/horizon.ts`).
`selectLeverageUnit`, `nearestRivals`, `bestCaseResult` (two rivals meeting is a
draw — two points into the race, not three), month/matchday bundling, and
`scoreLeverageWindows`. 13 tests.

**§S1/§S3 — engine consolidation.** `simulateFull` was byte-identical to
`simulate` (verified by normalised diff), so it is now an alias.
`simulateFast` was orphaned by the path-search rewrite and removed.
`simulate` and `simulateFullSeason` both take an optional `seed`. The preview's
`withSeededRandom` Math.random monkey-patch is gone, replaced by the seed
parameter. The Dashboard passes a fixed seed, so pressing Re-run on unchanged
data reproduces the same numbers instead of jittering.

**Steps 4 and 5 schemas.** `supabase/migrations/20260820_odds_snapshots.sql` and
`20260820_projections.sql`, yours to apply. The projections migration carries an
explicit comment forbidding an upsert path.

### Two things I measured and then threw away

Worth recording so nobody re-does them:

1. **An incremental rank update.** A single-fixture patch moves only two clubs,
   so the target's rank can be adjusted from whether those two crossed it
   instead of rescanning the table. I built it, proved it exactly equivalent to
   the full scan (including multi-fixture bundles), benchmarked it — and got
   0.98–1.09×. The cost is the baseline season simulation, not the rank scan.
   Reverted: ~40 lines and a subtle invariant for nothing.
2. **The variance-reduction figure.** The spec claims CRN typically buys
   "10–100× reduction in effective variance". Measured here it is about **5×**
   (SD 1.771pp → 0.777pp). The reason is structural: with the baseline season
   shared, the remaining variance is the genuine per-simulation randomness of
   whether that one lock flips the target's outcome, and no amount of pairing
   removes it. This is exactly why the floor is now measured rather than derived
   from an assumed factor.

Also caught in passing: `seed + simIndex` — the spec's `mulberry32(seed +
simIndex)` and my first version of `simKey` — makes adjacent seeds share almost
all their simulation keys (42 and 43 shared 499 of 500). Seeds are now spread
across the 32-bit range first, so nominally independent runs actually are.

### Not done, and why

- **§1.1 priors, §1.2 blend, §1.3 confidence UI, Step 2, Step 4 job, Step 5** —
  all blocked on credentials (§7). `teamElo` still returns 1500 for every club at
  `played === 0`; that is D1 and it is the one remaining correctness hole.
- **§S5 club maps** — needs the live 2026-27 club list.
- **The Game of the Week leverage spread** (`buildGameOfWeekShortlist`,
  `lib/weekly-preview/dossier.ts`) is still computed from per-run seeds that
  differ between baseline and locked runs, so `leverageSpreadPp` retains unpaired
  error. Doing it properly needs a spread across ~60 distinct (club, metric)
  pairs, which is either a multi-metric extension to the engine or a ~3 s cost at
  MD0. Left deliberately, not overlooked.
- **`export const maxDuration`** on `/api/deep-analysis` — worth adding
  regardless, though 6.6 s makes it much less urgent.

## §8. Sequencing

Spec order, with §0 folded in. Estimates are mine.

| # | Step | Est. | Blocking? |
|---|---|---|---|
| 1.0 | Quarantine stale constants | 30 min | Yes — silent-failure risk |
| 1.0b | Club maps (§S5) + season strings (§S6) | 60 min | Yes — prerequisite for priors |
| 1.1–1.2 | Priors table + Bayesian blend | 90 min | Yes — everything is downstream. **Needs Q2** |
| 1.3–1.4 | Confidence UI + validation | 45 min | No, but ship same day |
| 4 | Odds snapshot cron | 60 min | **Do early** — irreversible value. **Needs Q2, Q4, Q5** |
| 2 | Outright ingestion + comparison | 90 min | Feeds Step 5. **Needs Q2** |
| 3.1 | Shared seeded RNG, substream design | 45 min | Yes |
| 3.2–3.3 | Paired engine + noise floor + consumers | 150 min | Yes. **Needs Q1** |
| 3.4 | Horizon-scaled leverage | 45 min | No |
| 5 | Preseason Ledger | 90 min | Ship today (Thursday) |

The spec's floor for shipping — 1.0, 1.1, 1.2, 3.3, 4 — I would extend by one item:
**1.0b**. Without the club maps, three clubs have no prior, no colour, and no bookmaker
odds, which defeats 1.1.

Every step ends with `npm test` and `npx tsc --noEmit` green, and the app rendering an
MD0 table I have actually looked at.
