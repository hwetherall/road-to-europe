# next-steps-plan.md — implementation plan for the remaining 2026-27 work

**Source handoff:** `next-steps.md` (20 August 2026)
**Upstream:** `new-season.md` (original spec), `new-season-plan.md` (§S1–§S6 findings, §7a status)
**Repo baseline:** `new-season-2` @ `1c9d582`, clean. 66 tests / 12 files green, `tsc --noEmit` clean.
**Deadline:** Premier League 2026-27 kicks off Friday 21 August (confirmed via football-data:
season `2026-08-21 → 2027-05-30`, `currentMatchday: 1`).

Everything marked ✅ was verified against live data or running code during planning, not
assumed. ⚠️ marks a claim in the handoff or the spec that is wrong, with the adaptation.

**Credentials are live.** `.env` / `.env.local` are present and every key works. The two
unknowns §5 of the handoff held open are now answered, and both answers change the plan.

---

## §0. Findings

### 0.1 ✅ Supabase — both migrations applied cleanly

Project `tzmolacdznzauyzkmltu`. Verified via PostgREST with the service role key:

| table | state |
|---|---|
| `odds_snapshots` | new schema live (`season`, `market_type`, `captured_at`), 0 rows |
| `odds_snapshots_legacy` | exists, retains the old rows (latest `snapshot_at` 2026-04-13) |
| `projections` | exists, 0 rows |
| `projection_scores` | exists, 0 rows |

The `do $$` legacy-rename block **did** fire — `odds_snapshots.market` no longer exists
(42703) and the old 2025-26 h2h snapshots are preserved under the `_legacy` name. Nothing
to redo.

⚠️ Note the Supabase MCP connector is authorised for a *different* account; this project
does not appear in its project list. All DB verification here went through the service
role key directly.

### 0.2 ✅ `?season=2025` is permitted — the spec's fallback is unnecessary

`GET /v4/competitions/PL/standings?season=2025` returns HTTP 200 with a genuine final
table, all 20 clubs at 38 games played. So §3.1 does **not** need to fall back to the
31-game `FALLBACK_STANDINGS_2025_26` snapshot. Use the API.

### 0.3 ⚠️ football-data's `tla` is not Keepwatch's abbreviation

Four disagree: `BHA`→BRI, `CHE`→CFC, `LIV`→LFC, `NOT`→NFO. `TEAM_NAME_MAP` covers the
continuing clubs by full name, so this only bites where the code falls back to `tla`.
`lib/clubs.ts` must therefore carry the `tla` **and** the canonical abbr as separate
fields and never assume they are equal.

### 0.4 ✅ The 2026-27 twenty, and the priors they imply

Promoted: **Coventry City (COV), Hull City (HUL), Ipswich Town (IPS)**.
Relegated: West Ham, Burnley, Wolves.

2025-26 final table → `finalElo = 1500 + (PPG − 1.5) × 200` → `prior = 1500 + 0.70 × (finalElo − 1500)`:

| | | | | | | | | | |
|---|---|---|---|---|---|---|---|---|---|
| ARS 1603 | MCI 1577 | MUN 1552 | AVL 1529 | LFC 1511 | BOU 1500 | SUN 1489 | BRI 1485 | BRE 1485 | CFC 1482 |
| FUL 1482 | NEW 1471 | EVE 1471 | LEE 1463 | CRY 1456 | NFO 1452 | TOT 1441 | COV 1380 | HUL 1380 | IPS 1380 |

Spread **223 Elo**, so the spec's `spread > 150` test passes.

⚠️ The hazard I flagged — a continuing club regressing *below* `PROMOTED_DEFAULT = 1380` —
does not arise this season: the lowest continuing prior is TOT at 1441. It nearly did.
West Ham (39 pts) regress to 1434 and Burnley (22 pts) to 1371, so had West Ham survived
instead of one of the promoted clubs the two constants would have crossed. Record the
interaction in `priors.ts` as a known coupling rather than leaving it to be rediscovered.

### 0.5 ⚠️ the-odds-api has no EPL outrights — Step 2.1 is dead as written

Not a tier gate. `GET /v4/sports/?all=true` returns 175 sports, **12** with
`has_outrights === true`, all US-centric plus golf; the only soccer entry is an inactive
`soccer_fifa_world_cup_winner`. `soccer_epl` itself is `has_outrights: false`. The spec's
guessed `soccer_epl_winner` does not exist.

h2h is fine and unaffected — Step 4 stands. Quota is healthy: **13 used, 487 remaining**.

### 0.6 ✅ Kalshi is much richer than either document assumed — and becomes primary

43 EPL series exist. Four map directly onto Keepwatch's own metrics:

| series | state | markets | two-sided | volume | maps to |
|---|---|---|---|---|---|
| `KXPREMIERLEAGUE` | live, `-27` event | 20 | 7 / 20 | $1.16M | `championPct` |
| `KXEPLRELEGATION` | live, `-27` event | 20 | 17 / 20 | $30.2k | `relegationPct` |
| `KXEPLTEAMPOINTS` | live, 4 thresholds × 20 | 80 | 80 nominal | $2.0k | `avgPoints` |
| `KXEPLTOP4` / `KXEPLTOP6` | series exist, **0 markets in any state** | — | — | — | `top4Pct` / `top6Pct` |

Two corrections to the spec's §2.2 while we are here: the ticker suffix **is** the
Keepwatch abbreviation (`-TOT`, `-NFO`, `-LFC`, `-CFC`, `-BRI`, and `-COV`/`-HUL`/`-IPS`),
so **no `KALSHI_NAME_MAP` is needed** — unlike football-data. And prices now come as
dollar strings in `yes_bid_dollars` / `yes_ask_dollars` / `last_price_dollars`, not the
"cents from 1 to 99" the spec describes; `yes_bid`/`yes_ask` are absent.

**Honest liquidity assessment, because it determines what each market may be used for:**

- `KXPREMIERLEAGUE` — real. Normalised: ARS 42%, MCI 18%, LFC 11.6%, CFC 9.7%, MUN 7.9%,
  TOT 3.2%, AVL 1.4%. But 13 of 20 clubs sit at bid 0 / ask 1¢, Newcastle among them. The
  1¢ tick cannot separate Newcastle from Hull. **Usable for the top of the table only.**
- `KXEPLRELEGATION` — the most valuable market for Keepwatch, and the one neither document
  anticipated. 17 genuine two-sided quotes spanning the whole table, Newcastle at
  0.10/0.12. It constrains the *bottom*, which the title market cannot, so together they
  pin both tails.
- `KXEPLTEAMPOINTS` — listed but not priced. NEW 50+ quotes bid 0.02 / ask 0.97. Capture
  it (free) and record the spread, but **do not adjust a prior on it**; a mid computed from
  a 95¢ spread is a fabrication.
- `KXEPLTOP4` / `KXEPLTOP6` — not listed for 2026-27. Write the fetcher generically so
  they are picked up if they appear mid-season; do not build features on them now.

⚠️ **De-vig normalisation differs per market and getting it wrong silently biases
everything.** `KXPREMIERLEAGUE` mids sum to 1.080 → normalise to **1.0** (one champion).
`KXEPLRELEGATION` mids sum to 3.495 → normalise to **3.0** (three relegated). A single
shared normalise-to-1 helper applied to the relegation market would divide every
probability by three.

### 0.7 ⚠️ The market disagrees with the carryover priors, materially, and it is right to

This is Step 2's entire purpose and it fires on the first look. Market relegation
probabilities (de-vigged to 3.0) against the §0.4 priors:

| club | prior | prior rank | market relegation | reading |
|---|---|---|---|---|
| HUL | 1380 | =18th | **68.7%** | one flat `PROMOTED_DEFAULT` is wrong |
| COV | 1380 | =18th | 46.8% | ditto |
| IPS | 1380 | =18th | 46.4% | ditto |
| SUN | 1489 | 7th | 22.7% | market reads 54 points as over-performance |
| TOT | 1441 | 17th | **5.6%** | market reads 41 points as an aberration |
| CFC | 1482 | =10th | **2.1%** | market rates Chelsea level with Arsenal |

Three conclusions:

1. **`PROMOTED_DEFAULT` cannot be one number.** The market separates Hull from Coventry
   and Ipswich by ~22 points of probability. Three hand-set priors with reasons, not one
   constant. This is exactly the spec's explanation (1), "usually a promoted club".
2. **The promoted-versus-continuing gap is too small.** 1380 against TOT 1441 is 61 Elo;
   that cannot produce a 47%-versus-6% relegation split. The carryover scale is compressed
   because regression shrinks the continuing clubs toward the mean while the promoted
   default is set on an absolute scale — §0.4's coupling, showing up as a calibration
   error rather than a collision.
3. **TOT, CFC and SUN are the spec's explanation (1) too** — a summer, a manager, a
   reversion the carryover cannot see. These are the manual adjustments Step 2 exists to
   make, each with a `// reason:` comment.

See §7 Q1 — this is a decision about the Ledger, which cannot be revised after the fact.

### 0.8 ⚠️ Vercel Hobby makes the locked §3 cron decision undeployable

Confirmed from Vercel's docs: Hobby is limited to **once per day**, and *"cron expressions
that would run more frequently will fail during deployment"* — an explicit build error, not
a silent no-op. Scheduling precision is ±59 minutes. So `0 6,12,18,22 * * *` cannot ship.

This is a platform constraint, not a relitigation of §3. Modal resolves it — see §4.

⚠️ **And my own §1D was wrong.** With fluid compute, Hobby's function duration default
*and* maximum are both **300s**. So `export const maxDuration = 60` would *reduce* the
limit, not raise it. It follows that §S4's "`/api/deep-analysis` will exceed its Vercel
limit at MD0" was never true — 85s was inside 300s — and at 6.6s it is doubly moot.

### 0.9 ⚠️ Environment hygiene — three traps

- **`SUPABASE_SERVICE_ROLE_KEY` is defined twice, with two different values.** Line 9 is a
  new-style `sb_secret_…` (42 chars); line 12 is a legacy `service_role` JWT (219 chars).
  Last-wins, so **the legacy JWT is what actually loads**. Supabase is deprecating those;
  when it is revoked this breaks with a confusing error. Delete one. See §7 Q3.
- **Both files use CRLF line terminators.** Next's loader strips the `\r`, so the app is
  fine — but `set -a; . ./.env` in a shell and any Python consumer
  (`injury-scraper/injury-scraper.py`) will pick up trailing carriage returns in every
  value, and a key with `\r` appended fails auth in a way that looks like a bad key.
  One `dos2unix` fixes it.
- **`.env` and `.env.local` are byte-identical.** `.env.local` wins, so a future edit to
  `.env` alone will silently do nothing. Keep one.
- **`CRON_SECRET` is set in neither.** `app/api/cron/weekly-preview/route.ts:10` returns
  false when it is unset, so every cron route 401s locally and cannot be tested. It must
  also exist in the Vercel project env for the deployed crons to work at all.

### 0.10 ⚠️ §4.4's evidence does not support its conclusion — and the conclusion is right anyway

§4.4 rests on two numbers, both wrong.

**"15 fixtures cleared their measured floor."** Not a measurement. `lib/path-search.ts:129`:

```typescript
const topFixtures = sensitivity.slice(0, 15);
```

a hardcoded cap applied *after* filtering. The number 15 appears whether 15 fixtures
cleared or 380 did.

**"Signal 0.2–0.4pp."** Inherited from the spec and true of the *median* fixture — which is
exactly the fixture no reader cares about. Measured on a synthetic 380-fixture MD0 season
(20 clubs at `played === 0`, i.e. what `lib/elo.ts` produces today), target NEW, metric
`top7Pct`, through the production `sensitivityScanDetailed`:

| sims | median floor | fixtures clearing their own floor | strongest `maxAbsDelta` |
|---|---|---|---|
| 5,000 | 0.200 pp | **211 / 380** | 8.68 pp |
| 20,000 | 0.096 pp | **377 / 380** | 8.65 pp |

The strongest are Newcastle's own 38 matches and its direct rivals', at 20–90× their own
floor. Fixture-level leverage at MD0 is not marginal; it is enormous for the fixtures that
matter and negligible for the other 340.

**The structural problem this exposes.** The floor is a significance gate against a nil
null. Every fixture in the league has *some* nonzero effect, so as N grows the gate stops
rejecting: 44% filtered at 5,000 sims, 0.8% at 20,000 — it does least work at exactly the
sim count §4.4 recommends. What a reader sees is then governed by the ranking, and the top
of a ranking over 1,140 estimates is selected on noise as well as signal. Šidák-adjusted to
a 5% family-wise rate the counts fall to 39 and 216.

Statistical significance is not editorial relevance. §1B replaces the nil null.

**Caveat, and it is §4's own:** twenty equal-strength clubs make every position knife-edge,
so the 8.6pp *magnitudes* will shrink once the §0.4 priors spread the table. The counts, the
`.slice(0, 15)` finding, and "the floor stops filtering as N grows" are structural.

### 0.11 ⚠️ §4.2's "pairing cannot remove it" is estimator-specific, not fundamental

`lib/leverage/paired-scan.ts:315` computes `d = lockedHit − baselineHit` with `baselineHit`
evaluated at the locked fixture's **natural draw**, so `d` carries that draw's randomness.
Condition on everything except it — use the probability-weighted average of the three
outcomes as the baseline — and it disappears:

```
b_j = p_home·h_home + p_draw·h_draw + p_away·h_away
d_o = h_o − b_j
```

`b_j` is the conditional expectation of `baselineHit` given the rest of the season, so
`d_o` is unbiased for the same estimand with strictly smaller variance. Rao–Blackwell. The
ratio is exactly `(1 − p_o)`: 1.75× for a coin-flip lock, 4× for a heavy favourite — 1.3–2×
on the reported floor. It is free: the engine already patches and rank-scans all three
outcomes of every fixture, so `h_home`, `h_draw`, `h_away` are already computed and only
the accumulation changes.

The second benefit is larger. `d ∈ {−1,0,+1}` is nonzero in `changedShare` of simulations;
for `championPct` at MD0 that share is small enough that the SE is estimated off a handful
of nonzero draws and is itself unreliable. The conditional `d_o` is continuous and nonzero
in every pivotal simulation, so the SE behaves for the rare-event metrics too.

### 0.12 ⚠️ Two units for one number

`lib/sim/rng.ts` says CRN buys "2.3x reduction" (SD 1.771 → 0.777pp); `next-steps.md` §4.2
says "about 5×". Both correct — 2.3× on SD is 5.2× on variance — but a document about
honest uncertainty should not quote one measurement in two units unlabelled. State both,
labelled, in both places.

### 0.13 ⚠️ A silent 40/25/35 fallback masks the §S5 club-map failure

`lib/live-data.ts:288` gives up on a fixture whose clubs are not both in the standings:

```typescript
if (!homeTeam || !awayTeam) return fixture;   // no probabilities attached
```

and every engine then fills the gap silently — `lib/leverage/paired-scan.ts:155-156`,
`lib/montecarlo.ts:55-56`, `lib/weekly-preview/dossier.ts:105-106`,
`lib/path-search.ts:52` all default to `?? 0.4` / `?? 0.25`. A promoted club missing from
`TEAM_NAME_MAP` does not error; it produces a season where all 38 of its fixtures are
simulated at 40/25/35 regardless of opponent. Same family as D2 — wrong numbers, not no
numbers — and it is how §S5 does real damage.

---

## §1. Unblocked by anything — implement first

No network calls, no decisions pending. Measured against the §0.10 workload and the suite.

### 1A. Rao-Blackwellised baseline — `lib/leverage/paired-scan.ts`

Per §0.11.

**Scope:** single-fixture candidates only. Full conditioning over a `k`-fixture bundle needs
`3^k` evaluations and the `horizon.ts` month bundles have tens of fixtures. So
`locks.length === 1` → conditional baseline; `> 1` → natural-draw baseline, unchanged. Both
estimate the same population quantity, so a mixed scan is coherent. Record which was used.

**Restructure.** Group single-fixture candidates by fixture position `j`. Per simulation,
per such `j`: patch each of the three outcomes, rank-scan, recover `h_0, h_1, h_2`; form
`b_j` from `homeProb[j]` / `drawProb[j]`; accumulate `d_o = h_o − b_j`. Identical patch and
scan count to today.

**Signature.** `PairedDelta` gains `baselineKind: 'conditional' | 'sampled'`. `deltaPp`,
`sePp`, `noiseFloorPp`, `belowNoiseFloor`, `lockedPct` keep their meanings. `changedShare`
keeps *its* meaning via a separate accumulator, because `d_o` is no longer an indicator.

**Degenerate case to preserve:** a fixture in `baselineLocks` has `homeProb`/`drawProb`
forced to 1/0, so `b_j` collapses onto the forced outcome and the estimator reduces to
today's. The greedy path search depends on that.

**Validation:**
- Conditional and sampled deltas agree within combined CIs on the same fixture and seed —
  the correctness test; they must estimate the same thing.
- On a fixture with known `p_o`, `sePp_conditional / sePp_sampled ≈ sqrt(1 − p_o)` within
  Monte Carlo error. §0.11's claim, measured rather than asserted.
- Existing "SE matches the observed spread across 16 independent trials" still passes.
- Existing "baseline matches the existing engine's own metric" untouched — `baselinePct`
  does not change.

### 1B. Noise floor v2 — `lib/leverage/floor.ts`

**1B.1 — relevance null, not nil null.** The reader's question is not "is this
distinguishable from zero" but "is it worth caring about". So

```typescript
const reportable = Math.abs(deltaPp) - 2 * sePp > MATERIAL_EFFECT_PP;
```

One statement — *we are confident this fixture is worth more than X pp* — subsuming both
the old floor and the relevance judgement, and sayable in words. `MATERIAL_EFFECT_PP` is an
**editorial** constant, set from §3.4's re-measurement, stated in the UI. Same move §3.4
already made for horizon bundles: an editorial choice declared as one, rather than a
statistical threshold making an editorial decision badly.

**1B.2 — Benjamini–Hochberg over the family.** A Dashboard scan at MD0 is 1,140
simultaneous comparisons. One-sided z against the relevance null,
`z = (|deltaPp| − MATERIAL_EFFECT_PP) / sePp`, `p = 1 − Φ(z)`; BH at `q = 0.05` over all `m`
comparisons; report the realised cutoff.

**BH rather than Bonferroni/Šidák, deliberately.** Family-wise control is right when you
make one decision from the family. We publish a *list*, so the meaningful guarantee is "of
the fixtures shown, at most 5% are noise" — false discovery rate. That reasoning goes in
the docblock; it is the load-bearing idea.

Needs Φ, and there is no stats dependency: `lib/leverage/normal.ts` with an
Abramowitz–Stegun 7.1.26 `erfc`, tested against `Φ(1.96) = 0.9750`, `Φ(2.576) = 0.9950`,
`Φ(4.08) = 0.9999775`.

**1B.3 — empirical-Bayes shrinkage of reported deltas.** The top-ranked delta is selected
on `max|d|` over `m` estimates and is biased upward. Normal-normal, method of moments:

```
τ̂² = max(0, mean(d_i²) − mean(se_i²))
shrunk_i = d_i · τ̂² / (τ̂² + se_i²)
```

The weight `τ̂²/(τ̂² + se²)` is literally `K/(K + n)` from Step 1.2 with different symbols —
the same estimator one level up, which is why it is worth building even though on §0.10's
numbers it will be near-inert for `top7Pct` (`τ̂ ≫ se`, weight ≈ 0.99). **That is a finding,
not a failure**: it is positive evidence the `top7Pct` ranking is signal-driven rather than
selection-driven, which §0.10 leaves open. Report the realised weight as a diagnostic
rather than hiding it, and measure it on `championPct` too, where `se` is large relative to
signal and it should bite. Docblock notes that a global normal prior fits a right-skewed
effect distribution poorly — Newcastle's 38 fixtures against everyone else's 342 — and that
a two-group prior is the refinement, not done here.

**Consumers** (all already handle sparse/empty lists after §3.3, so this is threading
fields, not new states): `lib/sensitivity.ts` (`SensitivityScanSummary` gains
`materialEffectPp`, `bhCutoffPp`, `shrinkageWeight`, `reportableCount`);
`SensitivityChart.tsx` and `KyleLeverageList.tsx` state the threshold in words;
`lib/weekly-preview/dossier.ts` inherits the gate through its existing empty-list
suppression — verify the validator still forbids a pp claim in that state;
`app/api/deep-analysis/route.ts` prompt-side consumers.

**Validation:** Φ against published quantiles; BH against a hand-worked 10-comparison
example; on the §0.10 workload assert `reportableCount` is stable between 5,000 and 20,000
sims — the whole point of a relevance null, where the nil null gave 211 and 377; assert
`shrinkageWeight ∈ [0,1]` and is recorded, both metrics.

### 1C. `lib/path-search.ts` — the magic 15

`sensitivity.slice(0, 15)` → a named `MAX_GREEDY_CANDIDATES` whose docblock says it is a
**compute cap, not a statistical finding**, precisely so §4.4's mistake cannot recur, plus a
`console.warn` when it truncates. Its input becomes §1B's reportable list.

### 1D. `maxDuration` — reduced scope per §0.8

Hobby's default and maximum are both 300s, so no export is needed for headroom and setting
60 would be actively harmful. Add `export const maxDuration = 300` to
`app/api/deep-analysis/route.ts` only, as documentation of intent, and drop the item for the
other routes.

---

## §2. §S5 — the club maps

Unblocked: §0.3, §0.4 and §0.6 supply every name for all twenty clubs.

### 2.1 One registry, six derived maps

Six hand-maintained maps of the same twenty clubs is the defect; updating six consistently
is more work than deleting the duplication, and it recurs every August. New `lib/clubs.ts`:

```typescript
export interface Club {
  abbr: string;              // canonical — everything keys off this
  name: string;              // display
  footballDataName: string;  // exact api.football-data.org `name`
  footballDataTla: string;   // NOT always == abbr; see §0.3
  oddsApiNames: string[];    // every the-odds-api spelling observed
  espnNames: string[];
  fcDatasetNames: string[];  // FC26 csv; empty for promoted clubs — see §8
  colour: string;
}

export const CLUBS: Club[] = [ /* 20 entries */ ];
```

`TEAM_NAME_MAP`, `ODDS_API_NAME_MAP`, `TEAM_COLOURS` (`lib/team-colours.ts`),
`CLUB_TO_ABBR` (`lib/what-if/fifa-data.ts`) and `ESPN_TEAM_MAP` (`lib/espn.ts`) become
derived, keeping their exported names and shapes so no call site changes.
`injury-scraper/injury-scraper.py`'s `CLUB_ABBR_MAP` stays hand-written (different runtime)
with a comment naming `lib/clubs.ts` as the source of truth. Kalshi needs no map at all
(§0.6).

### 2.2 Sourcing — all verified

- `abbr` — Kalshi's convention, which matches Keepwatch's existing seventeen exactly and
  supplies COV / HUL / IPS.
- `footballDataName`, `footballDataTla` — live standings.
- `oddsApiNames` — captured from a live h2h response, all 20 confirmed, promoted clubs
  spelled `Coventry City`, `Hull City`, `Ipswich Town`. Retain the existing short aliases
  (`Brighton`, `Leeds`, `Tottenham`, …) since they have been observed before.
- `espnNames` — from a live ESPN scoreboard response; not yet fetched.
- `colour` — hand-entered for COV / HUL / IPS, flagged as hand-entered in a comment.

### 2.3 Make the fallback loud — per §0.13

`lib/live-data.ts:288`: a scheduled fixture whose clubs are not both in the standings is a
mapping failure, not missing data. Log an error naming the unmapped club and set an explicit
`probSource: 'unmapped'` so it is visible downstream. Then in `paired-scan.ts` and
`montecarlo.ts`, **throw** on a scheduled fixture with no probabilities rather than
defaulting — at MD0 a silent 40/25/35 season is indistinguishable from a working one.

### 2.4 Validation

For every club in the live standings, assert an entry in all five derived maps, plus
`CLUBS.length === 20` and unique abbreviations. Plus a test that an unmapped club throws
rather than simulating.

---

## §3. Step 1 — priors and the Bayesian blend

### 3.1 `lib/ratings/priors.ts`

The spec's shape (`new-season.md` §1.1): `LEAGUE_MEAN_ELO`, `REGRESSION_RETAIN`,
`PROMOTED_DEFAULT`, `PRESEASON_PRIORS`, `PRIORS_GENERATED_AT`, `PRIORS_SOURCE`,
`priorElo()`. Static literals, generated once, derivation recorded.

`scripts/generate-priors.ts` emits the table; §0.4 is its verified output. Record in the
docblock: the source endpoint, that `?season=2025` was permitted (§0.2), the 223 Elo spread,
and the `PROMOTED_DEFAULT` coupling from §0.4.

Then the manual adjustments from §0.7, each with a `// reason:` comment — subject to §7 Q1.

### 3.2 `lib/elo.ts`

Exactly the spec (`new-season.md` §1.2): `PRIOR_PSEUDO_MATCHES = 12`, private `formElo`,
exported `priorWeight(played)`, `teamElo(team)` signature unchanged, `eloProb` untouched,
new `eloBreakdown(team)`.

✅ Five call sites verified, all through the stable signature: `lib/live-data.ts:290`,
`lib/fixture-generator.ts:67`, `lib/what-if/full-season-sim.ts:88`,
`app/components/Dashboard.tsx:932`, and `lib/live-data.ts` via `teamElo`. No refactor.

### 3.3 Confidence UI

`app/components/Dashboard.tsx`, near the probability cards, from `priorWeight(team.played)`:

> **Model confidence: 0% evidence, 100% preseason prior** *(0 matches played)*

plus the tooltip. At MD0 it reads 0/100, which is the point.

### 3.4 Validation — and the §0.10 re-measurement

The spec's assertions as real tests: spread > 150 (✅ 223 by §0.4); every live club has a
prior; `priorWeight(0) === 1`, `priorWeight(12) === 0.5`, `priorWeight(38) < 0.25`;
`maxChampionPct > 25` on a 10k MD0 run.

`maxChampionPct` now has an external check: the market puts Arsenal at **42%**. If the sim
returns something far below 25% with ARS at 1603, the candidates in order are that the 30%
regression is too aggressive, or that D5 is washing strength out of the goal model.
Diagnose, do not tune.

Then, **before setting `MATERIAL_EFFECT_PP`**, re-run §0.10 against the real priors and
record: median floor, count clearing the relevance null at 5,000 and 20,000 sims, and the
delta distribution split between Newcastle's own 38 fixtures and the other 342. That is the
re-confirmation §4 holds open, and §1B's constant is set from its output.

---

## §4. Step 4 — odds snapshot job

**Blocked on:** §7 Q2 (scheduler) and `CRON_SECRET`.

- `lib/odds/snapshot.ts` — fetch, de-vig via `oddsToProb` / `averageBookmakerOdds` in
  `lib/odds-converter.ts`, write to `odds_snapshots`. `raw` stored unconditionally. Never
  fail the whole job on one source: collect per-source outcomes and return them.
- `app/api/cron/snapshot-odds/route.ts` — `CRON_SECRET` bearer auth, matching
  `app/api/cron/weekly-preview/route.ts:8-15` exactly.
- Quota budget as a comment: 4 runs/day × 30 = 120 h2h calls against 500/month, leaving
  room for §5. Currently 13 used, 487 remaining.
- Schema verification is done — §0.1.

**Scheduling, per §0.8.** `0 6,12,18,22 * * *` fails Hobby deployment outright. Options:

1. **Modal scheduled function as trigger (recommended).** A ~15-line Modal cron that issues
   one authenticated `GET` to `/api/cron/snapshot-odds` four times a day. All fetch, de-vig
   and persistence logic stays in TypeScript in this repo — Modal is a *scheduler*, not a
   second implementation, so nothing is duplicated in Python and §3's intent ("one
   mechanism, one place to look") survives. Costs a Modal secret holding `CRON_SECRET`.
2. Vercel cron degraded to `0 6 * * *` — one snapshot a day, ±59 min, no new infrastructure.
   Loses three quarters of the line-movement resolution the table exists to capture.
3. Both: Modal for four-a-day, Vercel daily as a floor so snapshots continue if the Modal
   account lapses. Append-only table, so a duplicate row is harmless; costs 30 extra
   quota calls a month.

### 4.1 Where Modal genuinely earns its place

Worth recording now that it is available, so it is not reached for reflexively:

- ✅ **Scheduling the odds snapshot** — the only thing on today's path. Hobby leaves no
  alternative that preserves 4×/day.
- ✅ **A2, market-implied prior fitting.** §0.6/§0.7 make this far better identified than
  the spec assumed: ~40 liquid market probabilities (20 title + 20 relegation) to fit 20
  ratings against, rather than one title market. 500–2000 gradient-free evaluations ×
  10k sims, trivially parallel. With patch-and-rerank and §1A the per-evaluation cost is
  already ~350× down, so this is now plausibly a *this-season* project rather than an
  appendix. Paired randomness matters enormously here — without it the optimiser chases
  simulation noise.
- ✅ **A3, backtesting.** Replaying 2025-26 matchday by matchday and scoring with Brier /
  log loss / RPS is embarrassingly parallel, and it is what would let `REGRESSION_RETAIN`,
  `PRIOR_PSEUDO_MATCHES` and `PROMOTED_DEFAULT` be fitted rather than chosen. Given the
  learning brief, this is the highest-value Modal use after the cron.
- ❌ **The Dashboard's 20,000-sim scan.** Client-side; a network round trip would cost more
  than the 9.7s it saves. The right answer there remains 5,000 sims plus a Web Worker.
- ❌ **Deep Analysis path search.** 6.6s inside a 300s limit. Nothing to solve.

---

## §5. Step 2 — outright markets, restructured per §0.5 and §0.6

- **`lib/odds/kalshi.ts` becomes the primary and only outright source.** Unauthenticated
  reads against `https://api.elections.kalshi.com/trade-api/v2`. Fetch `KXPREMIERLEAGUE`,
  `KXEPLRELEGATION`, `KXEPLTEAMPOINTS`, and attempt `KXEPLTOP4` / `KXEPLTOP6` so they are
  picked up if listed. Parse `*_dollars` fields, not `yes_bid`/`yes_ask` (§0.6). Abbr comes
  from the ticker suffix — no name map.
- **Per-market normalisation, explicitly parameterised:** title → 1.0, relegation → 3.0,
  top-4 → 4.0, top-6 → 6.0. A shared normalise-to-1 helper is a bug here (§0.6).
- **Record liquidity alongside every price** — `yes_bid`, `yes_ask`, spread, volume, open
  interest — and refuse to emit a usable probability where the spread exceeds a threshold.
  `KXEPLTEAMPOINTS` at bid 0.02 / ask 0.97 must not become "a 50% chance".
- **`lib/odds/outrights.ts` (the-odds-api) is not built.** §0.5 shows there is nothing to
  fetch. Record the finding in `lib/odds/kalshi.ts`'s docblock so the next reader does not
  repeat the search.
- **`npm run priors:check`** — the comparison table from `new-season.md` §2.3, extended to
  the markets that actually exist: prior Elo, sim championPct vs market, sim relegationPct
  vs market, Δ, and a liquidity column. §0.7 is a preview of its first run.
- Manual prior adjustments only, each with `// reason:`. No automated fitting — that is A2
  (§4.1).

---

## §6. Step 5 — the Preseason Ledger

Depends on §3 and §5. Ships before kick-off.

- `lib/ledger/projections.ts` — writer only. No upsert, no `ON CONFLICT`. The
  `unique (season, matchday, model_version, team)` constraint is the mechanism; a colliding
  write is a bug to surface, not a conflict to resolve.
- `lib/ledger/scoring.ts` — Brier and log loss for the binary metrics; **RPS** for final
  position, `RPS = (1/(K−1)) · Σ_{k=1}^{K−1} (F_forecast(k) − F_observed(k))²` over `K = 20`.
  Tested against hand-computed cases including both degenerate ones, with an explicit
  assertion that it penalises ten places out more than one place out — the reason it is the
  right rule and Brier is not.
- The artifact: projected table for all twenty, position histograms, the §3.3 confidence
  statement prominently, a preamble in the Weekly Preview voice on what the numbers are and
  are not, and the model-versus-market disagreements from §5 — §0.7 is already the most
  interesting content on the page.
- Published, timestamped, permanently linked, then never touched.

---

## §7. Open questions

**Q1 — priors: carryover plus manual adjustment, or market-anchored?** §0.7 shows the
market disagreeing hard, especially on the promoted clubs. The spec says do not automate the
fit; it did not anticipate a liquid relegation market across all twenty. The Ledger cannot
be revised, so it should carry the best forecast available on Thursday, not a knowingly
mis-scaled one. Options in §7 of the conversation.

**Q2 — odds cron scheduler.** §4's three options. Modal is my recommendation.

**Q3 — which `SUPABASE_SERVICE_ROLE_KEY`?** Two different values, legacy JWT currently
winning (§0.9). Which should survive?

**Q4 — `MATERIAL_EFFECT_PP`.** Set after §3.4's re-measurement; I will bring the measured
delta distribution and a recommendation rather than choose unilaterally, since the UI states
it out loud.

---

## §8. Deliberately out of scope

- **Game of the Week `leverageSpreadPp`** (`buildGameOfWeekShortlist`,
  `lib/weekly-preview/dossier.ts`) still uses per-run seeds differing between baseline and
  locked, so it retains unpaired error. Needs a spread across ~60 (club, metric) pairs.
- **The FC26 squad dataset** (`data/FC26_20250921.csv`) is a season stale and contains none
  of COV / HUL / IPS. §2.1's `fcDatasetNames: []` makes the gap explicit instead of silent.
  Needs a refresh or a decision to drop it — a decision, not a code change.
- **A1 Dixon-Coles.** Seam is `lib/sim/goals.ts`, now one file.
- **A2 / A3.** See §4.1 — both substantially more attractive than the spec assumed.
- **The incremental rank update.** Measured 0.98–1.09×, reverted. Do not rebuild.

---

## §9. Sequencing

| # | Item | Blocker | Est. |
|---|---|---|---|
| 1A | Rao-Blackwellised baseline | — | 45 min |
| 1B | Noise floor v2 (relevance null, BH, EB) | Q4 for the constant only | 90 min |
| 1C | `MAX_GREEDY_CANDIDATES` | — | 10 min |
| 1D | `maxDuration = 300` on deep-analysis | — | 5 min |
| §2 | `lib/clubs.ts` + derived maps + loud fallback | — | 60 min |
| 3.1–3.2 | Priors table + Bayesian blend | §2, **Q1** | 90 min |
| 3.3 | Confidence UI | 3.2 | 20 min |
| 3.4 | Validation + re-measurement → `MATERIAL_EFFECT_PP` | 3.2 | 45 min |
| §5 | Kalshi ingestion + `priors:check` | §2 | 75 min |
| §4 | Odds snapshot job + scheduler | **Q2**, `CRON_SECRET` | 60 min |
| §6 | Preseason Ledger | 3.2, §5 | 90 min |

⚠️ **§5 moves ahead of §4 and of the priors sign-off.** The spec put Step 4 early because
odds history is irreversible, and that reasoning is sound — but §0.7 makes the Kalshi
comparison an *input* to the priors rather than a downstream check, and the priors are
upstream of everything including the Ledger. One snapshot of Kalshi is free and
unauthenticated, so the irreversibility argument costs nothing by waiting an hour.

**Ship floor:** §2, 3.1, 3.2, §4. The model does not lie about team strength, no club is
silently simulated at 40/25/35, and odds history starts accumulating. §1B is correctness of
*reporting* and §0.10 shows the current gate is conservative rather than wrong at 5,000
sims, so it can slip a day. §6 must not slip — it cannot be created retroactively.

Every step ends with `npx tsc --noEmit`, `npx eslint lib app`, `npx vitest run` green, and
an MD0 table I have actually looked at.

---

## §10. Status

### Decisions taken (20 August)

1. **Priors** → hybrid: market-anchored for the three promoted clubs only, carryover
   untouched for the other seventeen, so TOT / CFC / SUN survive as genuine model-versus-
   market disagreements and become Ledger content.
2. **Odds cron** → Modal scheduled function triggering `/api/cron/snapshot-odds`. Vercel
   Hobby cannot deploy a sub-daily cron (§0.8).
3. **Supabase key** → keep `sb_secret_`, drop the legacy JWT.

### Done

**Environment hygiene (§0.9).** Both keys were verified working against the live project
before changing anything. `.env` converted to LF, legacy `service_role` JWT duplicate
removed, `CRON_SECRET` generated. ⚠️ **`.env.local` was deleted rather than `.env`** —
the reverse of what §0.9 proposed. `injury-scraper/injury-scraper.py` calls
`load_dotenv()`, and python-dotenv resolves `.env` only; it never looks at `.env.local`,
so dropping `.env` would have broken the scraper. One file now serves both consumers.
`CRON_SECRET` still needs mirroring into the Vercel project env and the Modal secret.

**§1A — conditional (Rao-Blackwellised) baseline.** `lib/leverage/paired-scan.ts`.
Single-fixture candidates grouped by fixture; three outcomes evaluated once per group,
conditional baseline formed from the fixture's own probabilities. `PairedDelta.baselineKind`
records which estimator produced each delta. `changedShare` moved to its own accumulator,
since the conditional delta is continuous and `E[d²]` is no longer the flip share.

The first implementation was ~1.9× slower despite doing the same number of rank scans:
object property access in a loop running `numSims × fixtureCount` times. Flattened to
typed arrays (`groupFixture` / `groupStart` / `entryCandidate` / `entryOutcome`), which
recovered it.

Measured on the 380-fixture MD0 workload, median noise floor:

| | before | after | wall clock |
|---|---|---|---|
| 5,000 sims | 0.200 pp | **0.126 pp** | 1389 ms → 1517 ms |
| 20,000 sims | 0.096 pp | **0.062 pp** | 5951 ms → 6196 ms |

A 1.58× tighter error bar for no material cost — worth ~2.5× the simulations. Inside the
1.3–2× band §0.11 predicted. Three new tests, the load-bearing two being that the
conditional delta agrees with `lockedPct − baselinePct` (which pins the baseline weights;
an unnormalised or transposed term breaks it while leaving the delta plausible) and that
`sePp_conditional / sePp_sampled ≈ sqrt(1 − p)`, measured rather than asserted.

**§1B — noise floor v2.** `lib/leverage/normal.ts` (A&S 7.1.26 erf, with its accuracy
limits stated) and `lib/leverage/floor.ts` (relevance null → Benjamini-Hochberg → EB
shrinkage). Wired through `lib/sensitivity.ts`; `MATERIAL_EFFECT_PP = 1.0` provisional.
`SensitivityResult` gains `shrunkMaxAbsDeltaPp` and `reportable`;
`SensitivityScanSummary` gains `materialEffectPp`, `reportableComparisons`,
`comparisonCount`, `shrinkageWeight`, `tauPp`. `belowNoiseFloor` keeps its old meaning
because the greedy path search and the horizon windows still need it, but it no longer
decides what a reader sees. UI copy in `SensitivityChart.tsx` and `KyleLeverageList.tsx`
now states the threshold instead of describing simulation noise.

**The result §1B existed to produce.** Fixtures shown at Matchday 0, `top7Pct`:

| gate | 2,000 sims | 5,000 | 20,000 |
|---|---|---|---|
| nil null (old) | — | 315 / 380 | 380 / 380 |
| relevance null | **38** | **38** | **38** |

Stable across a 10× compute range, where the old gate's answer was a function of the
simulation budget. And the 38 are exactly Newcastle's own 38 fixtures: at 38 rounds
remaining, no other club's individual result is confidently worth a percentage point of
Newcastle's top-7 chances. That is an editorial finding, not an artefact — and it is an
independent argument for §3.4's month-level bundles, arrived at from measurement rather
than from calendar reasoning.

EB shrinkage came out near-inert, as §1B predicted: `tau` ≈ 1.8pp against error bars of
0.06pp gives a weight of 0.997 for `top7Pct`. That is the informative outcome — positive
evidence the ranking is signal-driven rather than selection-driven, which §0.10 left open.
It bites slightly harder where it should: 0.975 for `championPct` at 2,000 sims.

**§1C.** `slice(0, 15)` → `MAX_GREEDY_CANDIDATES`, docblocked as a compute cap and not a
statistical finding, with a warning when it truncates.

**§1D.** `export const maxDuration = 300` on `/api/deep-analysis`, documenting the Hobby
ceiling rather than raising it. Dropped from the other routes per §0.8.

**Verification:** `tsc --noEmit` clean, `eslint lib app` clean (5 pre-existing warnings,
none new), `vitest run` **90 tests / 15 files** green (from 66 / 12), `npm run build`
passes. Nothing committed.

### Next

§2 (`lib/clubs.ts`), then §3 (priors + blend), §5 (Kalshi), §4 (cron), §6 (Ledger).
`MATERIAL_EFFECT_PP` is re-set from the §3.4 re-measurement once real priors land.

### §2 done — the club registry

**`lib/clubs.ts`** holds the 2026-27 twenty: canonical abbr, display name,
football-data name and tla, alias list, colour. Generated from live sources on
2026-08-20 — football-data standings, a the-odds-api h2h response, and ESPN's
`eng.1/teams` endpoint — not from memory.

**Two of the six maps were deleted rather than derived.** `TEAM_NAME_MAP` and
`ODDS_API_NAME_MAP` existed only to translate one provider's spelling, which `abbrFor()`
does for every provider at once, so their four call sites (`live-data.ts` ×3,
`Dashboard.tsx` ×1) now call `abbrFor` and the maps are gone. `TEAM_COLOURS`,
`CLUB_TO_ABBR` and `ESPN_TEAM_MAP` keep their exported names and shapes and are generated
from `CLUBS`, so no call site changed. Net **−101 lines** across the five files.

**§0.13's diagnosis was partly wrong, and the real failure mode is worse.** The 40/25/35
path needs standings and fixtures to disagree about a club, which is rare. What actually
happens is that `TEAM_NAME_MAP[name] || tla` substitutes the *provider's* code —
`BHA` for Brighton, `CHE` for Chelsea, `LIV` for Liverpool, `NOT` for Forest — and does so
*consistently* in both standings and fixtures. So Elo probabilities still attach and
nothing looks broken; the club simply misses every table keyed on the canonical
abbreviation. Once §3 lands that includes the priors table, so Brighton would be simulated
with a promoted club's rating. `abbrFor` now indexes `footballDataTla` too, so that
fallback resolves to the right club, and a genuine miss logs an error naming the club.

**`lib/sim/pricing.ts`** reports scheduled fixtures that reached an engine with no
probabilities — once per run, naming up to five, from both `paired-scan` and `montecarlo`.
Logged rather than thrown: a match-day page should degrade, not blank.

**Python scraper** map rebuilt for the twenty, and `lib/clubs.test.ts` now parses that file
and asserts it agrees with the registry — so forgetting it next August is a test failure
rather than a season of missing injury data.

**Verified against live data end-to-end**, not just unit-tested: all three sources live,
20 clubs with canonical abbreviations including COV / HUL / IPS, no unknown codes, no
missing colours, **380 scheduled fixtures and every one priced** — 10 from bookmaker odds
(matchday 1) and 370 from Elo.

⚠️ Two things this surfaced:

- **370 of 380 fixtures are Elo-priced at Matchday 0**, and `teamElo` returns 1500 for
  every club, so 370 fixtures currently carry identical 43/26/31 probabilities. §3 is
  therefore not one improvement among several; it sets 97% of the season's fixture
  probabilities.
- **`FALLBACK_STANDINGS_2025_26` still lists WHU, BUR and WOL**, which are no longer in
  the registry, so on the stale-data path those three render without a colour.
  `getTeamColour` degrades to the default teal and the path is banner-gated and never
  simulated, so this is cosmetic — recorded rather than fixed.

**Verification:** `tsc --noEmit` clean, `eslint lib app` clean (5 pre-existing warnings),
`vitest run` **98 tests / 16 files** green, `npm run build` compiles. Nothing committed.

### §3 done — priors and the Bayesian blend

**`lib/ratings/priors.ts`.** Twenty static priors, per-club provenance recorded, generated
from live sources.

⚠️ **`REGRESSION_RETAIN` changed from 0.70 to 0.55, and was calibrated rather than
guessed.** The spec proposed 0.70 as "a defensible starting guess" and said Step 2 should
sanity-check it against the market. Doing that — scoring each candidate against 27 market
probabilities (20 relegation + 7 title) by mean absolute error:

| retain | spread | title MAE | releg MAE | combined |
|---|---|---|---|---|
| 0.35 | 163 | 6.00 | 4.30 | 10.31 |
| 0.45 | 177 | 5.77 | 4.21 | 9.98 |
| **0.55** | 192 | **5.39** | **4.16** | **9.55** |
| 0.65 | 207 | 5.58 | 4.25 | 9.83 |
| 0.70 | 214 | 5.96 | 4.37 | 10.33 |
| 0.80 | 229 | 6.62 | 5.27 | 11.89 |

0.70 was over-confident — Arsenal at 47.1% for the title against a market 42.1%. The
optimum is shallow (0.45–0.65 are all close), which is the honest characterisation of one
parameter fitted to 27 observations. Worth being precise about what the market set: **one
global number, how hard to shrink last season's table.** It set no club's position in that
table. The forecast's shape is still last season's results; the market only calibrated
confidence in them, which is what keeps the Ledger a test of something.

**Promoted clubs fitted to Kalshi `KXEPLRELEGATION-27`**, coordinate-wise (the three are
each other's main relegation rivals, so each fit shifts the others), three rounds of
bisection, re-fitted after the retain change: **HUL 1397, COV 1422, IPS 1421**,
reproducing 68.3 / 46.9 / 47.5% against a market 68.7 / 46.8 / 46.4%. Note 25 Elo separates
Hull from Ipswich and yet 21 points of relegation probability — a single flat
`PROMOTED_DEFAULT` could not express that, which is the whole case for anchoring them.

**`lib/elo.ts`** blends prior and form at `K = 12` pseudo-matches, `teamElo` signature
unchanged, `priorWeight` and `eloBreakdown` exported. `priorElo` logs once per unknown club
rather than silently rating it as promoted.

**`ModelConfidence`** in `Dashboard.tsx` under the primary metric: *"Model confidence: 0%
evidence / 100% preseason prior (0 matches played)"*, driven by the same `priorWeight` the
blend uses, with a tooltip whose text differs at Matchday 0.

### The projected table, live, 20,000 sims

Prior spread 184 Elo. `maxChampionPct` **39.9%** (spec test: > 25). Title MAE **4.97pp**
across the 7 priced clubs, relegation MAE **3.71pp** across all 20 — both improved from
5.89 / 4.27 at retain 0.70.

Newcastle: 13th, 50.3 points, top-4 8.2%, top-7 22.8%, relegation 11.5% against a market
9.4%.

The disagreements that survive, and which the Ledger should publish:

| club | model | market | Δ | reading |
|---|---|---|---|---|
| SUN | 6.5% releg | 22.7% | −16.2 | model takes 54 points at face value |
| TOT | 20.7% releg | 5.6% | +15.1 | model takes 41 points at face value |
| CFC | 1.8% title | 9.7% | −7.9 | market sees a squad the table does not |
| LFC | 4.6% title | 11.6% | −7.0 | ditto |
| FUL | 8.8% releg | 16.3% | −7.5 | |
| NFO | 17.3% releg | 11.2% | +6.1 | |

These are not fixable by tuning `REGRESSION_RETAIN` — no value of it reorders clubs, and
the errors run in both directions. They are the spec's explanation (1), a summer the
carryover cannot see. Per the §7 Q1 decision they are kept, published and scored rather
than hand-adjusted. ⚠️ Tottenham at 20.7% to be relegated is the most conspicuous claim on
the page and will read as wrong to most people; it is deliberate and reversible.

⚠️ **Relegation ~0.0% for Arsenal and City against a market 2.1% is partly market
microstructure, not model error** — Kalshi cannot quote below 1¢, so 2.1% is close to the
floor of what that market can express. Do not read it as a calibration failure.

### §3.4 — `MATERIAL_EFFECT_PP` re-measured, and it is robust

With real priors the delta distribution is sharply **bimodal**:

| | range | median |
|---|---|---|
| Newcastle's own 38 fixtures | 5.56 – 8.63 pp | 6.68 |
| the other 300 fixtures | 0.04 – 0.62 pp | 0.25 |

**Nothing falls between 0.62 and 5.56pp.** So every threshold from ~0.7 to ~5.5pp returns
the same 38 fixtures; 1.0pp sits in the middle of an empty region rather than on a
knife-edge. Below the gap the answer does move — 0.25pp admits 49 fixtures, the extra 11
being rivals' matches worth a quarter-point each. `MATERIAL_EFFECT_PP` stays at 1.0 and its
docblock now carries the measurement instead of the word "provisional".

The bimodality is the substantive finding: at 38 rounds remaining a club's own results
dominate its fate by an order of magnitude over any single other result. That is the
measured case for §3.4's month bundles — other clubs matter in aggregate, never
individually.

**Verification:** `tsc --noEmit` clean, `eslint lib app` clean (5 pre-existing warnings),
`vitest run` **116 tests / 18 files** green, `npm run build` compiles. Nothing committed.

### §5, §4, §6 done — markets, snapshot job, and the Ledger

**⚠️ Security, twice.** A file named `env` (no dot) was sitting **staged in the git index**
with every live API key in it — `.gitignore` blocks `.env*`, which does not match a bare
`env`. Checked every commit on every ref: never committed, so it never reached GitHub and no
rotation was needed. Removed from the index. Then `kalshi-key.md`, containing an RSA private
key, arrived untracked and unignored. `.gitignore` now covers `env`, `env.*`, `*key.md`,
`*-key.*`, `*.pem`, `*.p8`, `*_rsa`, `*.private`.

**The Kalshi private key is deliberately unused.** Every market-data endpoint is public —
verified across all five series. Kalshi's RSA authentication exists for order placement and
portfolio access, neither of which Keepwatch does, and an app that only reads prices should
not hold a key that can trade.

**§5 — `lib/odds/kalshi.ts`.** Five series polled; `KXEPLTOP4`/`KXEPLTOP6` still list zero
markets and are polled in case they appear. Per-market normalisation is parameterised, not
shared: title → 1.0, relegation → 3.0, top-4 → 4.0, top-6 → 6.0. A single normalise-to-one
helper would have divided every relegation probability by three.

Two distinct ways a quote is unusable, flagged separately because they mislead in opposite
directions: a **spread too wide** for its midpoint to mean anything (`KXEPLTEAMPOINTS` quotes
Newcastle 50+ at 0.02/0.97), and a price **at the 1¢ tick floor**, which is a bound rather
than an estimate. The guard earned itself on day one — Arsenal's relegation quote widened from
0.02/0.03 in the morning to 0.04/0.18 by evening, and was correctly refused.

**`npm run priors:check`** prints the model-versus-market table and the >5pp disagreements
with the three explanations. Kept out of the normal suite by `describe.skipIf`, so `npm test`
needs neither network nor credentials.

**§4 — the snapshot job.** `lib/odds/snapshot.ts` captures h2h per *bookmaker* rather than
averaged (the average is derivable later; the disagreement between books is not) and Kalshi's
season markets, via `Promise.allSettled` so one source failing cannot discard the other's
rows. `raw` stored unconditionally. Quota arithmetic written into the file: one request per
run, ~120/month against 500.

Verified live: **747 rows written** — 627 h2h across 10 fixtures and multiple bookmakers, 120
Kalshi — and read back correctly typed.

`app/api/cron/snapshot-odds/route.ts` returns **502 when a run captures nothing**, because a
scheduler reporting green through an outage is worse than no scheduler: the gap is discovered
much later, when it can no longer be filled.

`modal/snapshot_odds.py` is the clock and nothing else — three lines of logic, one
authenticated GET, no football knowledge and no Python copy of the club map. Fires at 06:00,
12:00, 18:00 and 22:00 UTC. **Not yet deployed** — needs `modal secret create keepwatch-cron`
and `modal deploy` on the owner's account.

**§6 — the Ledger.** `lib/ledger/scoring.ts` implements Brier, log loss and RPS. Propriety is
*demonstrated* in the tests rather than asserted: expected score is shown to be minimised by
reporting the true probability, which is the property the whole track record rests on. RPS is
tested for the thing that makes it the right rule for an ordered outcome — being wrong by
fifteen places must cost far more than by one, which Brier cannot express.

`lib/ledger/projections.ts` has no upsert, no update, no delete, and a test asserts the module
surface contains none, since the guarantee is enforced by absence and a helper added later
would silently remove it. `lib/ledger/market.ts` reads market prices **out of the snapshot
table** rather than calling Kalshi, so the artifact quotes the prices captured at publication
rather than drifting whenever someone loads the page.

`app/ledger/page.tsx` carries the confidence statement, the projected table with per-club
position histograms, the disagreements, and a preamble on what the numbers are not. Linked
permanently from the dashboard.

### Published

`npm run ledger:publish` ran at **2026-08-20T22:25:14Z**, model `blend-v1-hybrid`, 20 rows.
Title probabilities sum to 100.0%, relegation to 300.0%, every position distribution to 1.0.
A second run was refused: *"already published … a published projection is never overwritten."*

| | | | |
|---|---|---|---|
| 1 ARS 67.6 (38.9% title) | 6 TOT 54.2 | 11 BRE 52.0 | 16 CRY 48.5 |
| 2 MCI 64.4 | 7 BOU 54.0 | 12 FUL 51.3 | 17 NFO 47.8 |
| 3 MUN 61.5 | 8 SUN 52.7 | 13 EVE 50.3 | 18 IPS 41.9 (47.0% releg) |
| 4 AVL 57.9 | 9 CFC 52.5 | **14 NEW 49.9** | 19 COV 41.7 (48.0%) |
| 5 LFC 56.2 | 10 BRI 52.3 | 15 LEE 49.4 | 20 HUL 37.5 (70.1%) |

Newcastle: 49.9 points, top-4 8.0%, top-7 21.6%, relegation 13.2%.

**Tottenham adjusted, Sunderland not.** Tottenham moved 1454 → 1499 (17th to 6th) on a
documented summer rebuild, fitted to the market's 5.7% relegation price; the promoted three
were re-fitted jointly, since strengthening one mid-table club pushes risk onto everyone else.
Sunderland were deliberately left at 7.3% against a market 23.9%, on the grounds that the
market was also pessimistic about them last season and 54 points is real evidence. Both
decisions are recorded in `priors.ts`, because "we chose not to act" is a decision and an
unrecorded one is indistinguishable from an oversight.

Six clubs published disagreeing with the market by more than 5pp: SUN −16.6, CFC −8.8,
NFO +8.3, LFC −8.3, FUL −6.5, ARS −6.3.

**Verification:** `tsc --noEmit` clean, `eslint lib app` clean (5 pre-existing warnings),
`vitest run` **142 tests / 20 files** green plus 2 credentialed scripts skipped,
`npm run build` compiles, `/ledger` returns 200 and renders the published data. Nothing
committed.

### Remaining

- Deploy the Modal scheduler (owner's account).
- §8's out-of-scope list is unchanged: Game of the Week `leverageSpreadPp` still unpaired, the
  FC26 dataset absent from the repo entirely, A1/A2/A3 untouched.
- Weekly scoring of the Ledger against results — `projection_scores` is written by nothing yet.
