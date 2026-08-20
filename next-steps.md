# Keepwatch — thread handoff, 20 August 2026

**Paste this as the opening message of a new thread.**

Before starting, add these two files to the project knowledge if they aren't already there:
- `new-season.md` — the original overhaul spec (contains known errors; see §4 below)
- `new-season-plan.md` — Claude Code's restructured plan with its own findings §S1–§S6 and a `§7a. Status` block

---

## §1. Where things stand

The Premier League 2026-27 season starts tomorrow (Friday 21 August). Yesterday I wrote a five-step overhaul spec (`new-season.md`) covering the Matchday-0 cold start, and handed it to Claude Code. It came back with a restructured plan, six findings the spec missed, one substantive push-back that changed the design, and roughly two-thirds of the work implemented.

Everything currently green: `tsc --noEmit` clean, `eslint lib app` clean (5 pre-existing warnings, no new ones), `vitest run` 66 tests passing across 12 files (up from 39), `npm run build` passes. **Nothing is committed to git yet.**

---

## §2. What shipped

**Step 1.0 — stale data quarantined.** `HARDCODED_STANDINGS` → `FALLBACK_STANDINGS_2025_26`, `KNOWN_FIXTURES` → `FALLBACK_FIXTURES_2025_26`. Source label `'hardcoded'` → `'stale-fallback'` threaded through `lib/live-data.ts`. `Dashboard.tsx` now refuses to simulate in that state and renders a persistent banner. Two bugs found in passing: the Dashboard was seeding both its initial `useState` *and* its `allFixtures` memo from last season's table, so last season's standings rendered on first paint even on the happy path. `lib/fixture-generator.ts` no longer hardcodes matchday 32 and returns `[]` early at ≥380 known fixtures.

**§S6 — season-string sweep.** ~30 hardcoded `"2025-26"` / `"We are in March 2026"` strings replaced across seven files, with `PREVIOUS_SEASON` derived from `CURRENT_SEASON` so they can't drift. Two substitutions initially landed inside quoted rather than template strings, which would have sent `${CURRENT_SEASON}` to the model verbatim — caught and fixed.

**Step 3 — the paired patch-and-rerank engine.** New: `lib/sim/rng.ts` (counter-based `hashRand` with a substream per sim/fixture/draw), `lib/sim/goals.ts` (consolidates a `GOAL_PARAMS` table that existed in four copies — this is the Dixon-Coles seam), `lib/leverage/paired-scan.ts`, `lib/leverage/horizon.ts`. The three duplicate sensitivity scans (`lib/sensitivity.ts`, `lib/path-search.ts:124`, `lib/weekly-preview/dossier.ts:229`) are now one. `simulateFull` turned out byte-identical to `simulate` and is an alias; `simulateFast` was orphaned and removed.

Measured on the 380-fixture MD0 workload, all 1140 comparisons:

| | old `sensitivityScan` | paired engine |
|---|---|---|
| @1,000 sims | 59,838 ms | 485 ms |
| @5,000 sims | — | 2,423 ms (median floor 0.24pp) |
| @20,000 sims | — | 9,742 ms (median floor 0.12pp) |

Path search at MD0: ~85 s → **6.6 s**, which removes the Deep Analysis timeout risk.

**Step 3.3 — noise floor.** `noiseFloorPp = 2 × sePp`, measured per comparison rather than derived from an assumed constant. Below-floor fixtures filtered from the ranked list. Perfect Weekend suppression is *enforced* rather than requested: when nothing in a round is measurable, that section's allowed numeric claims go empty, so the existing validator forbids a pp figure appearing.

**Steps 4 and 5 schemas.** `supabase/migrations/20260820_odds_snapshots.sql` and `20260820_projections.sql` written, not yet applied.

---

## §3. Decisions locked — do not relitigate

1. **Sensitivity engine** → paired patch-and-rerank, not the spec's Step 3 as written.
2. **Season-rollover sweep (§S5 club maps, §S6 season strings)** → both, before Step 1.1.
3. **Odds cron** → Vercel cron at `/api/cron/snapshot-odds`, schedule `0 6,12,18,22 * * *`, alongside the existing weekly-preview entry in `vercel.json`. Not GitHub Actions.
4. **Supabase** → `.sql` files into `supabase/migrations/`; I apply them. Nothing touches production DDL directly.

---

## §4. Corrections to `new-season.md` — these matter

The spec is in the repo and a fresh Claude Code session will read it. Three of its claims are now known to be wrong, and one of its conclusions is overturned. Treat this section as superseding it.

**4.1 — The CRN design in §3.1 doesn't work as written.** `sampleGoals` is a rejection sampler consuming a variable number of draws, so a single stream per simulation desynchronises the moment the locked outcome differs from baseline. Measured SD of the delta: 1.771pp unpaired → 0.969pp with the spec's design → 0.777pp with a per-(sim, fixture, draw) substream. The substream design is what's implemented.

**4.2 — "10–100× variance reduction" is wrong.** Actual is about **5×**. With the baseline season shared, what remains is the genuine per-simulation randomness of whether one lock flips the target's outcome, and pairing cannot remove it. This is exactly why the floor is measured rather than assumed.

**4.3 — `noiseFloorPp`'s `paired ? se * 0.3` guessed a constant that is computable exactly.** Step the two worlds together, accumulate the per-simulation difference, and the SE falls out — validated at 0.654pp reported against 0.748pp observed.

**4.4 — The spec's August conclusion is overturned.** It reasoned: signal 0.2–0.4pp, noise 2.05pp, therefore suppress fixture-level leverage until ~MD8. That took the 1000-sim ceiling as a fact of nature. At 20,000 paired sims (~3.4 s) the median 95% floor is 0.10pp, comfortably under the signal — and 15 fixtures cleared their measured floor in the MD0 path search. **Fixture-level leverage is measurable at Matchday 0; it just wasn't affordable before.** Keep the noise floor and the month-level bundles, but as an editorial choice, not a workaround.

**One caveat held open:** the prototype league was 20 equal-strength clubs, which inflates per-fixture signal. The standard errors are defensible; the deltas are not, until re-measured against real priors. So §4.4 needs re-confirming once Step 1.1 lands.

**Also killed after measurement, so nobody rebuilds it:** an incremental rank update (a single-fixture patch moves only two clubs, so the target's rank can be adjusted rather than rescanned). Built, proven exactly equivalent, benchmarked at 0.98–1.09×. The cost is the baseline season simulation, not the rank scan.

---

## §5. What's outstanding

**The one remaining correctness hole:** `lib/elo.ts` still returns exactly 1500 for all twenty clubs at `played === 0`. That's D1. Everything downstream of team strength is currently a coin flip.

Blocked on credentials — this is on me, not on you:

- `FOOTBALL_DATA_API_KEY` — Step 1.1 (club list + 2025-26 final PPG), Step 4
- `ODDS_API_KEY` + current quota state — Steps 2, 4
- `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` — Steps 4, 5

Two unknowns that can't be checked without them: whether the football-data plan permits the previous-season filter (`?season=2025`), and whether outrights are gated on the current the-odds-api tier.

Remaining work, in order:

| # | Item | Blocker |
|---|---|---|
| §S5 | Six club maps → 2026-27 twenty (`TEAM_NAME_MAP`, `ODDS_API_NAME_MAP`, `TEAM_COLOURS`, `CLUB_TO_ABBR`, `lib/espn.ts`, `injury-scraper/CLUB_ABBR_MAP`) | live club list |
| 1.1 | `lib/ratings/priors.ts` — priors table | football-data |
| 1.2 | `lib/elo.ts` — Bayesian blend | 1.1 |
| 1.3–1.4 | Confidence UI + validation | 1.2 |
| 4 | Odds snapshot job + Vercel cron entry | odds + Supabase keys |
| 2 | Outright ingestion (the-odds-api + Kalshi) + priors comparison | odds key |
| 5 | Preseason Ledger | 1.2, 2 |

Deliberately left, recorded so they aren't mistaken for oversights:

- **Game of the Week `leverageSpreadPp`** (`buildGameOfWeekShortlist`, `lib/weekly-preview/dossier.ts`) still runs on per-run seeds that differ between baseline and locked, so it retains unpaired error. Doing it properly needs a spread across ~60 (club, metric) pairs — either a multi-metric engine extension or ~3 s at MD0.
- **`export const maxDuration`** on `/api/deep-analysis` — worth adding regardless, less urgent at 6.6 s.
- **The FC26 squad dataset** (`data/FC26_20250921.csv`) is a full season stale for 2026-27. The prompt now describes it honestly, but no rename fixes the data. Needs a real refresh or a decision to drop it.

---

## §6. What I want from this thread

Default ask, unless I say otherwise: **write the implementation spec for the remaining steps** — §S5, 1.1–1.4, then 2, 4 and 5 — in the same house style as `new-season.md` (diagnosis → exact file paths and signatures → validation → sequencing), incorporating everything in §3 and §4 above. Output as a file I can hand straight to Claude Code.

Before writing, please:

1. Read `new-season-plan.md` for the §S1–§S6 findings and the `§7a. Status` block — it has detail this handoff compresses.
2. Check the current `lib/elo.ts`, `lib/leverage/paired-scan.ts` and `lib/sim/rng.ts` so the new spec builds on what actually exists rather than what the old spec described.
3. Flag anything in §4 you think is still wrong. The last round produced a better design because the spec got pushed back on, and I'd rather that happened again.

One framing note: I'm moving into decision science professionally, and this project is my learning vehicle for it. Where there's a choice between the expedient fix and the one that teaches the underlying idea properly — shrinkage, calibration, proper scoring rules, variance reduction — bias toward the latter and say why.