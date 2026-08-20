# new-season.md — 2026-27 Season Start Overhaul

**Status:** Specification. Hand to Claude Code for implementation.
**Target:** Working before Matchday 1 (Friday 21 August 2026).
**Scope discipline:** Five steps. No new features. Everything here is either a correctness fix or a data-capture action that cannot be backfilled later.

---

## Context

Keepwatch was built and calibrated during the run-in of 2025-26, with roughly ten rounds remaining. Every modelling decision in the codebase carries an implicit assumption: **most of the season has already happened.** That assumption is load-bearing in more places than is obvious, and on Friday it becomes false all at once.

The critical property of these failures is that **none of them throw.** The app will run, render, and produce confident percentages that mean nothing. There is no error state to notice. That makes this a correctness problem disguised as a cosmetic one, and it is why the overhaul must happen before the first ball is kicked rather than after the first weird-looking output.

The secondary goal is architectural: leave clean seams for the three projects that follow (Dixon-Coles goal modelling, market-implied prior fitting, and a proper backtesting harness). Where a decision here constrains those, it is called out.

---

## Diagnosis: what breaks at Matchday 0

### D1. `teamElo()` collapses the entire league to a single rating

`lib/elo.ts`:

```typescript
export function teamElo(team: Team): number {
  const ppg = team.played > 0 ? team.points / team.played : 1.5;
  return BASE_ELO + (ppg - 1.5) * 200;
}
```

At `played === 0` the guard returns `1.5`, so **every one of the 20 clubs receives exactly 1500**. The league becomes a flat coin-flip lottery where the only differentiator is the 65-point home advantage. Arsenal and Burnley are the same team.

It does not recover gracefully. At Matchday 3, a club on 9 points reads as 3.0 PPG → Elo 1800. A club on 0 points reads as 1200. The model will spend six weeks producing extreme, confident, and wrong ratings driven entirely by small-sample noise. **Matchday 1–6 is worse than Matchday 0**, because at least Matchday 0 is visibly uninformative.

`teamElo` is imported in four places — `lib/live-data.ts`, `lib/fixture-generator.ts`, `lib/what-if/full-season-sim.ts`, and `app/components/Dashboard.tsx` — so this single function poisons the base simulation, the fixture generator, the What-If engine, and the client-side fallback path simultaneously.

### D2. `lib/constants.ts` contains last season's data as the fallback path

`HARDCODED_STANDINGS` is the 2025-26 table. `KNOWN_FIXTURES` are Matchday 32–33 fixtures dated March/April 2026 with baked-in bookmaker probabilities.

`Dashboard.tsx` falls back to these whenever the live fetch fails:

```typescript
if (nextFixtures.length === 0) {
  nextFixtures = [...KNOWN_FIXTURES, ...generateRemainingFixtures(nextTeams, KNOWN_FIXTURES)];
}
```

On any football-data.org hiccup, Keepwatch will silently serve last season's final table as if it were live, with fixtures dated five months in the past. There is no visual distinction. This is the single most embarrassing possible failure mode and it is currently one API timeout away.

### D3. `generateRemainingFixtures` hardcodes matchday 32

`lib/fixture-generator.ts`:

```typescript
matchday: 32 + Math.floor(idCounter / 10),
```

This helper exists to synthesise fixtures when football-data.org returns an incomplete schedule. At season start the full 380 fixtures are published, so it should generate nothing — but if it ever fires, it will stamp Matchday 32+ onto August fixtures and corrupt every downstream matchday calculation (Weekly Preview round detection, `roundsRemaining`, the Roundup pipeline).

### D4. Sensitivity analysis returns noise, and sorts it

`lib/sensitivity.ts` runs `simulate()` at `simsPerLock = 1000` for baseline plus three locks per fixture, then ranks by `maxAbsDelta`.

At ten rounds remaining, locking one fixture moved the target metric by several percentage points — comfortably above sampling noise. At 38 rounds remaining, a single fixture is worth roughly **0.2–0.4pp**.

The Monte Carlo standard error at p ≈ 0.30 with N = 1000 is:

```
SE = sqrt(0.30 × 0.70 / 1000) ≈ 0.0145 → ±1.45pp
```

Baseline and locked runs currently use **independent random draws**, so the standard error on their *difference* is roughly `√2 × 1.45 ≈ 2.05pp`.

**The noise is five to ten times larger than the signal.** The `EPSILON = 1e-9` filter removes nothing meaningful, and the sort by `maxAbsDelta` produces a confident, well-formatted ranking of random seeds. Every downstream consumer — the Deep Analysis brain, the Weekly Preview's Perfect Weekend table, the V4 inverse scenario search — inherits this.

This is the most dangerous item on the list precisely because the output looks exactly as plausible as it did in March.

### D5. Goal difference is decoupled from team strength

`lib/montecarlo.ts` samples the W/D/L outcome first, then draws goals from a fixed table:

```typescript
const GOAL_PARAMS = {
  homeWin: { home: 1.7, away: 0.6 },
  draw:    { home: 1.1, away: 1.1 },
  awayWin: { home: 0.7, away: 1.5 },
};
```

Every home win generates the same goal distribution regardless of who is playing. Arsenal 1.7 vs Burnley 0.6; Burnley 1.7 vs Arsenal 0.6.

GD is the first EPL tiebreaker and at Matchday 0 every race is tight, so tiebreaks resolve far more often than they did in March. **This is not fixed in this spec** — it is the Dixon-Coles project (Appendix A). It is documented here so the seam is deliberate rather than accidental, and so Step 1 does not paint over it.

---

## Step 1 — Replace PPG-derived Elo with a preseason prior and a Bayesian blend

**Goal:** every club has a defensible rating on Matchday 0, and early-season results update that rating at a rate proportional to how much evidence they actually represent.

### 1.0 Pre-flight: quarantine the stale constants

Before touching the ratings, make the stale-data failure mode loud instead of silent.

In `lib/constants.ts`:

- Rename `HARDCODED_STANDINGS` → `FALLBACK_STANDINGS_2025_26` and `KNOWN_FIXTURES` → `FALLBACK_FIXTURES_2025_26`. The rename is the point: every call site now reads as obviously wrong.
- Add `export const FALLBACK_SEASON = '2025-26';` and `export const CURRENT_SEASON = '2026-27';`

In `lib/live-data.ts` and `app/components/Dashboard.tsx`:

- When the fallback path fires, set `dataSource = 'stale-fallback'` and surface a **persistent, non-dismissible banner**: *"Live data unavailable — showing 2025-26 final standings. These are not current."*
- Suppress the simulation entirely in this state. Do not render probabilities computed from last season's table. An empty state is honest; a wrong number is not.

In `lib/fixture-generator.ts`:

- Replace the hardcoded `32` with a derived value: `const baseMatchday = Math.max(...knownFixtures.map(f => f.matchday), 0) + 1;`
- Add a guard at the top: if `knownFixtures.length >= 380`, return `[]` immediately and log. At season start this should be the path taken every time.

### 1.1 New file: `lib/ratings/priors.ts`

```typescript
import { Team } from '../types';

/**
 * Preseason Elo priors for 2026-27.
 *
 * DERIVATION (do not hand-wave this — document the actual numbers used):
 *
 * Continuing clubs:
 *   1. finalElo = 1500 + (2025-26 final PPG - 1.5) * 200
 *   2. Regress 30% toward the mean:
 *      prior = 1500 + REGRESSION_RETAIN * (finalElo - 1500)
 *
 *   The 30% shrinkage reflects that a single season's PPG is a noisy
 *   estimate of true strength, and that squads change over a summer.
 *   It is a defensible starting guess, not a fitted parameter. Step 2
 *   sanity-checks it against the market; Appendix A replaces it with a
 *   fitted value.
 *
 * Promoted clubs:
 *   PROMOTED_DEFAULT (1380) — roughly 0.6 PPG below league average,
 *   which is close to the historical mean for promoted sides. Adjust
 *   individually only if the market strongly disagrees (see Step 2).
 *
 * IMPORTANT FOR THE IMPLEMENTER: do NOT invent the 2026-27 club list or
 * last season's final table from memory. Derive both from live data:
 *   - Club list: football-data.org PL standings for the current season
 *   - 2025-26 final PPG: football-data.org standings with the prior
 *     season filter, or the archived final table already in the repo
 * Write the resulting table into this file explicitly, with a comment
 * recording the date it was generated. A static, auditable table beats a
 * clever runtime derivation — you want to be able to look at this file in
 * March and know exactly what the model believed in August.
 */

export const LEAGUE_MEAN_ELO = 1500;
export const REGRESSION_RETAIN = 0.70;
export const PROMOTED_DEFAULT = 1380;

export const PRESEASON_PRIORS: Record<string, number> = {
  // POPULATE FROM LIVE DATA — see derivation above.
  // Format: ABBR: rating,
};

export const PRIORS_GENERATED_AT = ''; // ISO date — fill on generation
export const PRIORS_SOURCE = 'carryover_regressed'; // later: 'market_fitted'

export function priorElo(abbr: string): number {
  return PRESEASON_PRIORS[abbr] ?? PROMOTED_DEFAULT;
}
```

### 1.2 Rewrite `lib/elo.ts`

Keep the exported `teamElo(team: Team): number` signature **exactly as-is**. Four call sites depend on it; changing the signature turns a one-file fix into a four-file refactor with no benefit. Change only the internals.

```typescript
import { Team } from './types';
import { priorElo } from './ratings/priors';

const HOME_ADV = 65;
const BASE_ELO = 1500;

/**
 * Pseudo-matches of prior weight.
 *
 * K = 12 means: after 12 played matches, prior and observed form carry
 * equal weight. Chosen so the prior dominates the volatile opening
 * stretch and has substantially decayed by the new year.
 *
 *   n=0  → w = 1.00 (pure prior)
 *   n=6  → w = 0.67
 *   n=12 → w = 0.50
 *   n=19 → w = 0.39 (half-season)
 *   n=38 → w = 0.24
 *
 * This is a shrinkage estimator, not a fitted hyperparameter. Log it,
 * expose it in the UI, and revisit once the backtest exists.
 */
const PRIOR_PSEUDO_MATCHES = 12;

/** Crude form estimate from current-season PPG. Replaced by Dixon-Coles later. */
function formElo(team: Team): number {
  if (team.played === 0) return BASE_ELO;
  return BASE_ELO + (team.points / team.played - 1.5) * 200;
}

/** Weight given to the prior. 1.0 at MD0, decaying with matches played. */
export function priorWeight(played: number): number {
  return PRIOR_PSEUDO_MATCHES / (PRIOR_PSEUDO_MATCHES + played);
}

export function teamElo(team: Team): number {
  const prior = priorElo(team.abbr);
  if (team.played === 0) return prior;
  const w = priorWeight(team.played);
  return w * prior + (1 - w) * formElo(team);
}

/** Diagnostic breakdown for the UI and for debugging. */
export function eloBreakdown(team: Team) {
  return {
    prior: priorElo(team.abbr),
    form: formElo(team),
    blended: teamElo(team),
    priorWeight: priorWeight(team.played),
    played: team.played,
  };
}

// eloProb() unchanged.
```

### 1.3 Surface the blend in the UI

This is not decoration — it is the honest-uncertainty commitment made concrete, and it is what stops a reader trusting an August number the way they'd trust an April one.

Add a compact indicator near the probability cards:

> **Model confidence: 12% evidence, 88% preseason prior** *(3 matches played)*

Drive it from `priorWeight(team.played)`. Add a tooltip explaining that early-season projections are dominated by preseason expectations and will shift as results accumulate.

### 1.4 Validation

Write these as actual tests, not manual checks:

```typescript
// At played = 0, ratings must NOT be uniform.
const spread = Math.max(...ratings) - Math.min(...ratings);
assert(spread > 150, 'Preseason priors are flat — priors table not populated');

// Every club in the live standings has a prior (no silent PROMOTED_DEFAULT
// for a club that should have a carryover rating).
for (const t of teams) {
  assert(t.abbr in PRESEASON_PRIORS, `Missing prior for ${t.abbr}`);
}

// Blend endpoints behave.
assert(priorWeight(0) === 1);
assert(Math.abs(priorWeight(12) - 0.5) < 1e-9);
assert(priorWeight(38) < 0.25);

// Sanity: a 10k-sim MD0 run should put the strongest-prior club top
// noticeably more often than the weakest — and title probability should
// be concentrated, not spread evenly across 20 clubs.
assert(maxChampionPct > 25, 'Title race is uniform — priors not reaching the sim');
```

Then eyeball it: run the MD0 simulation and read the projected table. It should look like a plausible preseason prediction. If it doesn't, the priors are wrong — trust the eyeball over the test here.

---

## Step 2 — Ingest outright markets

**Goal:** get a second, independent opinion on team strength that exists *before any matches are played*, and use it to sanity-check Step 1.

The framing to hold onto: the marginal value of a fourth bookmaker's h2h price is near zero. The marginal value of the first outright market is enormous, because **outrights are the only source of full-season-forward information.** Prioritise breadth of market *type*, not breadth of bookmaker.

### 2.1 the-odds-api outrights (do this first — you already pay for it)

`outrights` is a valid value for the `markets` parameter. Each market × region costs one credit against the quota, so this is cheap.

- Call `GET /v4/sports/?apiKey=...&all=true` and filter for `has_outrights === true` to find the correct EPL futures sport key (it is a **separate key** from `soccer_epl` — likely of the form `soccer_epl_winner`). Do not guess it; discover it.
- Confirm whether futures are gated to a higher plan on the current subscription. If they are, note it and fall through to Kalshi rather than silently returning nothing.
- New file: `lib/odds/outrights.ts`. Fetch, de-vig (the existing `averageBookmakerOdds` overround-stripping logic in `lib/odds-converter.ts` generalises — reuse rather than duplicate), and normalise to probabilities summing to 1 across the 20 clubs.

### 2.2 Kalshi (second opinion, free, no auth for reads)

Kalshi lists EPL markets under the `KXPREMIERLEAGUE` series. Market data reads work unauthenticated against `https://external-api.kalshi.com/trade-api/v2/markets`. Prices are in cents from 1 to 99 and are directly interpretable as implied probability — no de-vigging needed, which makes them a *cleaner* probability signal than bookmaker prices even where liquidity is thinner.

- New file: `lib/odds/kalshi.ts`
- Discover tickers via `GET /trade-api/v2/markets?series_ticker=KXPREMIERLEAGUE`
- Map Kalshi's club naming to Keepwatch abbreviations. Add a `KALSHI_NAME_MAP` alongside the existing `ODDS_API_NAME_MAP` in `constants.ts`.
- Kalshi has also self-certified season win-totals markets. If EPL win totals exist, capture them — they map directly onto the simulation's points distribution and are the single most useful market for validating Step 1.

**Caveat to record in the code:** Kalshi is US-facing, so EPL depth is thinner than a UK book. Treat it as a second opinion, never as the sole source.

### 2.3 The comparison artifact

Build a single internal page or CLI output — `/admin/priors` or `npm run priors:check` — showing, for all 20 clubs:

| Club | Prior Elo | Sim title % | Market title % | Sim top-4 % | Market top-4 % | Δ |
|---|---|---|---|---|---|---|

This is the whole point of Step 2. Large disagreements mean one of three things, and you must decide which before Friday:

1. **The prior is wrong** — usually a promoted club, a big summer of transfers, or a managerial change the carryover can't see. Fix the number in `PRESEASON_PRIORS`.
2. **The engine is wrong** — the ratings are fine but the sim isn't translating them into the right outcome distribution. This is the D5 goal-difference problem showing up. Note it, don't fix it now.
3. **You genuinely disagree with the market.** Legitimate, and interesting — but at Matchday 0, with a carryover prior and no fitted parameters, this is the *least likely* explanation. Assume 1 or 2 first.

Adjust priors by hand where the market disagreement is large and explanation 1 clearly applies. Record every manual adjustment as a comment in `priors.ts` with the reason. This is the audit trail that makes the Ledger (Step 5) meaningful.

**Do not automate the fit yet.** Automated market-implied prior fitting is Appendix A — it deserves a proper optimisation loop and a compute budget, not a rushed heuristic on a Wednesday night.

---

## Step 3 — Make leverage honest

**Goal:** stop reporting noise as insight. Two independent fixes; do both.

### 3.1 Common random numbers (variance reduction)

The cheapest available win. Baseline and locked simulations currently draw independent randomness, so their difference carries the noise of both. If both runs use the **same random draws**, the outcome differences that remain are attributable to the lock rather than to sampling. Typically buys a 10–100× reduction in effective variance — for free, without more compute.

This is worth doing regardless of whether Modal ever enters the picture. Compute and cleverness are substitutes here; use both.

**Implementation:**

Add a seeded PRNG to `lib/montecarlo.ts` (mulberry32 is fine — small, fast, adequate for this):

```typescript
function mulberry32(seed: number) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
```

Extend the signature (optional param — existing call sites keep working):

```typescript
export function simulate(
  teams: Team[],
  fixtures: Fixture[],
  numSims: number,
  seed?: number
): SimulationResult[]
```

When `seed` is provided, use `mulberry32(seed + simIndex)` for simulation `simIndex`; otherwise fall back to `Math.random`. Replace **both** the outcome draw and the `sampleGoals` draws — leaving `sampleGoals` on `Math.random` leaks unpaired noise straight back into GD and undoes most of the benefit.

In `lib/sensitivity.ts`, pass a fixed `SENSITIVITY_SEED` to the baseline run and to every locked run.

### 3.2 Horizon-scaled leverage

At 38 rounds, no single fixture matters much — but clusters do. The unit of analysis should scale with the horizon: **months in August, matchdays by Christmas, fixtures by March.**

Add to `lib/sensitivity.ts`:

```typescript
export type LeverageUnit = 'fixture' | 'matchday' | 'month';

export function selectLeverageUnit(roundsRemaining: number): LeverageUnit {
  if (roundsRemaining <= 12) return 'fixture';
  if (roundsRemaining <= 25) return 'matchday';
  return 'month';
}
```

For `matchday` and `month` units, instead of locking a single fixture, lock a **coherent bundle**: every fixture in that window involving the target club and its closest rivals, each set to its best-case result for the target. Report the aggregate swing.

This produces claims like *"Newcastle's season is decided in a five-week window from late October"* — which is both truer at this horizon and more interesting than a noisy fixture list.

### 3.3 The noise floor (do not skip this)

Compute and enforce an explicit reporting threshold:

```typescript
export function noiseFloorPp(p: number, numSims: number, paired: boolean): number {
  const se = Math.sqrt((p * (1 - p)) / numSims) * 100;
  const diffSe = paired ? se * 0.3 : se * Math.SQRT2; // CRN cuts paired SE substantially
  return 2 * diffSe; // ~95% threshold
}
```

Any delta below the floor is **not reported as a ranked item**. Return it flagged:

```typescript
interface SensitivityResult {
  // ...existing fields
  belowNoiseFloor: boolean;
  noiseFloorPp: number;
}
```

Filter `belowNoiseFloor` items out of the ranked list entirely and replace the `EPSILON = 1e-9` filter, which currently removes nothing.

When *every* fixture falls below the floor — the expected state in August — the UI must say so plainly:

> **No individual fixture moves the needle yet.** With 38 rounds remaining, single results carry less impact than simulation noise. Showing month-level leverage instead.

Every consumer of `sensitivityScan` must be updated to handle an empty or sparse ranked list gracefully: the Deep Analysis brain, the Weekly Preview's Perfect Weekend table, and the V4 inverse scenario search. **The Perfect Weekend table in particular should not render at all in August** — it is built on fixture-level deltas that do not exist yet. Suppress it and note why rather than shipping a table of noise.

### 3.4 Validation

```typescript
// CRN must actually reduce variance. Run the same lock 20 times with a
// fixed seed and 20 times unseeded; the seeded variance should be far lower.
assert(seededVariance < unseededVariance / 5, 'CRN not wired through all draws');

// At MD0 with 1000 sims, essentially everything should be below the floor.
// If it isn't, the floor calculation is wrong.
assert(md0Results.filter(r => !r.belowNoiseFloor).length < 5);
```

---

## Step 4 — Odds snapshot cron

**Goal:** start accumulating a time series today. **Line movement is information that cannot be backfilled.** Every day this isn't running is a day of history permanently lost.

Highest return-on-effort item in this document — roughly 40 lines of code plus a schema.

### 4.1 Supabase schema

```sql
create table odds_snapshots (
  id             bigserial primary key,
  captured_at    timestamptz not null default now(),
  season         text not null,
  source         text not null,        -- 'the-odds-api' | 'kalshi' | 'polymarket'
  market_type    text not null,        -- 'h2h' | 'outright_winner' | 'outright_top4'
                                       -- | 'outright_relegation' | 'points_total'
  fixture_id     text,                 -- h2h only
  home_team      text,                 -- h2h only
  away_team      text,                 -- h2h only
  team           text,                 -- outrights only
  line           numeric,              -- points_total only
  commence_time  timestamptz,
  bookmaker      text,
  price_decimal  numeric,
  implied_prob   numeric,              -- raw 1/price
  devig_prob     numeric,              -- overround-stripped
  raw            jsonb                 -- full payload, for reprocessing
);

create index on odds_snapshots (season, market_type, captured_at desc);
create index on odds_snapshots (fixture_id, captured_at desc);
create index on odds_snapshots (team, market_type, captured_at desc);
```

Store `raw` unconditionally. Parsing logic will change; the payloads won't. Being able to reprocess a season of history against a fixed parser is worth the storage many times over.

### 4.2 The job

- New file: `scripts/snapshot-odds.ts` (or Python, alongside the existing injury scraper — match whatever is already there rather than introducing a second runtime for one script).
- Runs: h2h for the next two matchdays, plus all available outright markets, from every configured source.
- Schedule via GitHub Actions, same pattern as the injury scraper. **Four times daily** (06:00, 12:00, 18:00, 22:00 UTC) — enough to catch team-news movement without burning the 500/month the-odds-api quota. Budget the calls explicitly in a comment; outrights are cheap, h2h across multiple regions is not.
- Never fail the workflow on a single source erroring. Log, continue, snapshot what you can.

### 4.3 What it unlocks later

Not to be built now, but the reason the schema is shaped this way:

- **Odds movement as narrative** — *"Newcastle drifted 2.10 → 2.45 overnight"* is both a signal and a Weekly Preview story
- **Model-vs-market tracking** over time, not just at a point
- **Closing-line value** — the sharpest available measure of whether Keepwatch's probabilities are actually good
- **Backtest ground truth** — a market probability series to score the model against

---

## Step 5 — The Preseason Ledger

**Goal:** convert the cold-start weakness into the season's spine. Publish locked, timestamped projections *before* Matchday 1, then score them every week for 38 weeks.

This is what turns Keepwatch from a calculator into a public track record — and it is the most credible artifact to put in front of an evaluator, because it is the only one that can be checked.

### 5.1 Schema

```sql
create table projections (
  id                    bigserial primary key,
  created_at            timestamptz not null default now(),
  season                text not null,
  matchday              int not null,     -- 0 = preseason
  model_version         text not null,    -- e.g. 'blend-v1-carryover'
  prior_source          text not null,    -- 'carryover_regressed' | 'market_fitted'
  team                  text not null,
  champion_pct          numeric,
  top4_pct              numeric,
  top7_pct              numeric,
  relegation_pct        numeric,
  avg_points            numeric,
  avg_position          numeric,
  position_distribution jsonb,            -- length-20 array
  unique (season, matchday, model_version, team)
);

create table projection_scores (
  id             bigserial primary key,
  scored_at      timestamptz not null default now(),
  season         text not null,
  matchday       int not null,
  model_version  text not null,
  metric         text not null,      -- 'top4' | 'top7' | 'relegation' | 'position'
  brier_score    numeric,
  log_loss       numeric,
  rps            numeric             -- ranked probability score, position only
);
```

The `unique` constraint is the immutability mechanism: a projection for a given season/matchday/model can be written once. **Do not add an upsert path.** The value of the Ledger is entirely in its being un-editable — a track record you can quietly revise is not a track record.

### 5.2 Scoring

- **Brier score** for the binary metrics (top-4, top-7, relegation): `(forecast − outcome)²`, averaged. Lower is better; 0.25 is the score for always guessing 50%.
- **Ranked Probability Score** for final position. This is the right scoring rule for *ordered* outcomes — it penalises being wrong by ten places more than being wrong by one, which Brier does not. Worth implementing properly; it is the more interesting of the two and directly relevant to the decision-science angle.
- Score against the final table at season end, and against a rolling "current probability" each week for in-season tracking.

### 5.3 The artifact

Generate before Friday, from the MD0 simulation:

- Projected final table for all 20 clubs — expected points, expected position, title/top-4/top-7/relegation probabilities
- Position distribution histogram per club
- The **model confidence** statement from Step 1.3, prominently: this is a prior-dominated projection and will move
- A short written preamble in the existing Weekly Preview voice explaining what the numbers are and — importantly — what they are not
- Where Keepwatch disagrees with the market (from Step 2), and a one-line note on why

Publish it, timestamp it, link it from the dashboard permanently. Then never touch it again.

---

## Sequencing

Strictly ordered. Steps 1 and 3 are correctness; 4 is time-sensitive; 5 depends on 1 and 2.

| # | Step | Est. | Blocking? |
|---|---|---|---|
| 1.0 | Quarantine stale constants | 30 min | Yes — silent-failure risk |
| 1.1–1.2 | Priors table + Bayesian blend | 90 min | Yes — everything is downstream |
| 1.3–1.4 | Confidence UI + validation | 45 min | No, but ship same day |
| 4 | Odds snapshot cron | 60 min | **Do early** — irreversible value |
| 2 | Outright ingestion + comparison | 90 min | Feeds Step 5 |
| 3.1 | Common random numbers | 45 min | Yes — sensitivity is wrong without it |
| 3.2–3.3 | Horizon-scaled leverage + noise floor | 90 min | Yes |
| 5 | Preseason Ledger | 90 min | Ship Thursday |

If time runs short: **1.0, 1.1, 1.2, 3.3 and 4 are non-negotiable.** Everything else can slip a week. The floor for shipping is: the model doesn't lie about team strength, doesn't lie about leverage, and starts collecting odds history.

---

## Appendix A: What this sets up

Deliberately out of scope. Each deserves its own spec and its own session.

### A1. Dixon-Coles goal modelling — fixes D5

Replace the `GOAL_PARAMS` lookup with per-team attack and defence strengths. Home goals ~ Poisson(α_home × β_away × γ), away goals ~ Poisson(α_away × β_home), plus the Dixon-Coles correction term for low-scoring correlation (0-0, 1-0, 0-1, 1-1 are not independent draws) and exponential time-decay weighting on past matches.

You get W/D/L **and** a full score matrix from one coherent model — clean sheets, correct scores, and a GD distribution that actually depends on who's playing. It also composes with A2: fit attack/defence parameters to the market rather than to results, and you have a preseason Dixon-Coles model with no matches played.

**Seam left for it:** `teamElo`'s internals are isolated behind a stable signature, and `formElo` is a private function with one job. Swapping in a DC-derived strength estimate is a change to two functions, not a refactor.

### A2. Market-implied prior fitting — replaces Step 2's manual adjustment

Find the set of team ratings that, run through the Monte Carlo, best reproduces the market's outright probabilities. Parameters: 20 ratings plus home advantage. Loss: squared error between simulated and market-implied outright probabilities across title, top-4, top-6, relegation, and points totals. Optimiser: gradient-free (CMA-ES or Nelder-Mead), since each evaluation is a stochastic 10k-sim run.

Roughly 500–2000 evaluations × 10k sims. Trivially parallel — this is the Modal use case. Note that CRN (Step 3.1) matters *enormously* here: without paired randomness the optimiser is chasing simulation noise and will not converge cleanly.

**Seam left for it:** `PRIORS_SOURCE` in `priors.ts` already anticipates a `'market_fitted'` value.

### A3. Backtesting harness

Replay 2025-26 matchday by matchday via FBref, project forward at each point, score with Brier / log loss / RPS, and plot calibration curves. This is what turns "a simulator" into "a simulator that knows how good it is," and it's what lets you replace every hand-chosen constant in this document — `REGRESSION_RETAIN = 0.70`, `PRIOR_PSEUDO_MATCHES = 12`, `PROMOTED_DEFAULT = 1380` — with a fitted value.

**Seam left for it:** the `projections` and `projection_scores` tables are shaped for backfill as well as live use. `model_version` lets historical and current runs coexist.

---

## Appendix B: Notes on the decision-science angle

The three things this overhaul actually teaches, worth naming explicitly since that's part of the point:

**Shrinkage.** Step 1's blend is a shrinkage estimator — the same idea as James-Stein, empirical Bayes, and the "regression to the mean" every sports model uses. The insight generalising well beyond football: when you have a noisy estimate and a decent prior, the optimal combination is almost never "use the data" or "use the prior," and the weight should scale with how much data you have. `PRIOR_PSEUDO_MATCHES` is the entire idea in one number.

**Signal versus noise in simulation.** Step 3 is the lesson that a Monte Carlo estimate is itself a random variable with a standard error, and that reporting differences smaller than that error is a category mistake. The noise floor makes it explicit. Variance reduction via common random numbers is the standard practitioner's answer and is under-taught relative to how useful it is.

**Proper scoring rules.** Step 5's Brier and RPS are *proper* scoring rules — they are minimised by reporting your true belief, so there's no incentive to shade a forecast toward a confident-sounding number. This is the foundation of calibration as a discipline, and the reason the Ledger's immutability matters: a forecast you can revise after the fact isn't being scored, and an unscored forecast has no information content at all.

The through-line for the whole overhaul: nothing here will throw an error. The model will produce confident numbers all August. **Making the uncertainty visible — in the model, in the UI, and in the writing — is the actual work.**