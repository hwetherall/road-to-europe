# Keepwatch V5 — Build ToDo

Tracked from the **Keepwatch V5 Roadmap** (March 2026).

---

## Phase A: Foundation (11-16 hours)

- [x] **Step 1: Vercel AI SDK 6 Setup** (2-3 hours)
  - [x] Install agent orchestration capability
  - [x] Create a reusable agent loop with tool-call support (`lib/what-if/agent-loop.ts`)
  - [x] Verify the loop: prompt -> tool call -> result -> response
  - *Note: Used raw fetch + `agentLoop()` helper instead of Vercel AI SDK — consistent with existing codebase. Same functionality.*

- [x] **Step 2: FIFA Data Integration** (3-4 hours)
  - [x] Build CSV parser with in-memory caching (`lib/what-if/fifa-data.ts`)
  - [x] Build squad profiling algorithms (`lib/what-if/squad-quality.ts`)
  - [x] Map all 20 PL club names to existing team abbreviations
  - [x] Download FC 26 dataset — `data/FC26_20250921.csv` (547 PL players, 20 clubs, 24-36 per team)
  - [x] Updated parser for actual CSV columns (`short_name`, `club_name`, `value_eur`, `physic`, etc.)
  - [x] Filter by `league_id=13` (English PL only, excludes Ukrainian PL)
  - [x] Test: squad profiles working — Villa 81.9 avg starting XI, Arsenal 85.7, all 20 clubs mapped

- [x] **Step 3: Supabase Setup** (2-3 hours)
  - [x] Create `what_if_analyses` table migration (`supabase/migrations/20260325_what_if_tables.sql`)
  - [x] Build client initialisation and cache read/write (`lib/what-if/what-if-cache.ts`)
  - [x] Run migration against Supabase project
  - [ ] Test: write mock analysis JSON, read back, verify roundtrip

- [x] **Step 4: Individual Tool Development** (4-6 hours)
  - [x] `runSimulationTool` — wraps `simulateFull()` with probability modifications
  - [x] `lookupPlayerTool` — fuzzy name matching against FIFA dataset
  - [x] `compareSquadsTool` — comparative squad profiles with gap analysis
  - [x] `webSearchTool` — wraps existing Serper + Tavily search
  - [x] `evaluatePlausibilityTool` — structured self-evaluation passthrough
  - [x] `storeScenarioTool` — in-memory accumulator for scenario results
  - [x] Test: all tools verified via end-to-end pipeline (FIFA lookup, squad compare, simulation, web search all functional)

---

## Phase B: Agent Loop (12-16 hours)

- [x] **Step 5: Diagnosis Agent (Phase 2)** (3-4 hours)
  - [x] Create diagnosis system prompt (`lib/what-if/prompts.ts`)
  - [x] Wire agent loop with `compare_squads` + `web_search` tools
  - [x] Agent produces structured diagnosis (squad ranking, bottlenecks, narrative)
  - [x] Test: Aston Villa -> Champion — squad ranked 6th (81.9), 8 specific bottlenecks identified

- [x] **Step 6: Hypothesise + Simulate Loop (Phase 3)** (6-8 hours)
  - [x] Create hypothesise system prompt with full workflow instructions
  - [x] Wire agent loop with all 6 tools, max 40 rounds
  - [x] Agent explores: Perfect World -> Squad Upgrades -> Competition Priority -> Combinations
  - [x] Test: 6 scenarios stored, real sim numbers (0% to 4.94%), specific players (Bowen, Eze, Watkins, Kamara)

- [x] **Step 7: Stress-Test Agent (Phase 4)** (3-4 hours)
  - [x] Create stress-test system prompt
  - [x] Wire agent with `web_search` tool for constraint verification
  - [x] Agent adjusts plausibility scores based on findings
  - [x] Test: CL deprioritisation dropped 25→8, overhaul dropped 15→5, with specific PSR/UEFA reasoning

---

## Phase C: Synthesis + UI (17-22 hours)

- [x] **Step 8: Narrative Synthesis Agent (Phase 5)** (4-5 hours)
  - [x] Create synthesis system prompt
  - [x] Takes all scenarios, diagnosis, and stress-test results
  - [x] Produces four-section narrative: Perfect World, Reality Check, Pragmatic Path, Long View
  - [x] Test: all 4 sections + bottom line populated with player names, transfer fees, PSR constraints

- [x] **Step 9: API Endpoint + Background Processing** (4-5 hours)
  - [x] Multi-action POST handler (`app/api/what-if/route.ts`)
  - [x] Client-orchestrated phases: start -> diagnose -> hypothesise -> stress-test -> synthesise
  - [x] Cache check on start, cache write on completion
  - [x] Error handling for each phase
  - [x] Test: full pipeline for "Aston Villa -> Champion" — 6 scenarios, 4-section narrative, all phases complete
  - *Note: Used client-orchestrated sequential calls instead of background polling — avoids Vercel timeout limits.*

- [x] **Step 10: What-If UI** (6-8 hours)
  - [x] `WhatIfTrigger.tsx` — appears when metric card shows ~0%
  - [x] `WhatIfAnalysis.tsx` — full-page modal with stat cards + four narrative sections
  - [x] `WhatIfProgress.tsx` — phase timeline with contextual status messages
  - [x] `useReducer` state machine: idle -> diagnosing -> hypothesising -> stressTesting -> synthesising -> ready | error
  - [ ] Test: full click-through from trigger to rendered analysis
  - [ ] Polish: editorial typography (Oswald headings, generous line height)

- [x] **Step 11: Caching + Follow-Up Chat** (3-4 hours)
  - [x] Analyses cached in Supabase — instant load on return visits
  - [ ] Regenerate button for fresh analysis
  - [ ] Follow-up chat with analysis context injected
  - [ ] Test: generate -> navigate away -> return -> verify instant cache load

---

## Phase D: Polish + Demo Prep (6-8 hours)

- [ ] **Step 12: Edge Cases + Error Handling** (3-4 hours)
  - [ ] High-probability teams -> redirect to V4 Deep Analysis
  - [ ] Missing FIFA data -> fallback to web-search-only analysis
  - [ ] Token limit exceeded -> graceful truncation with partial results
  - [ ] Agent timeout -> save partial results, allow retry

- [ ] **Step 13: Pedram Demo Preparation** (3-4 hours)
  - [ ] Pre-generate analyses: Villa -> Champion, relegation team -> Top 7, Newcastle -> Champion
  - [ ] Cache analyses for instant demo playback
  - [ ] Prepare Innovera parallel talking points
  - [ ] Write demo script: buttons to click, narrative at each stage

---

## Blockers / Next Actions

1. ~~**Download FC 26 CSV**~~ — Done! `data/FC26_20250921.csv` loaded with 547 PL players.
2. ~~**Run Supabase migration**~~ — Done! `what_if_analyses` table created.
3. ~~**End-to-end test**~~ — Done! Aston Villa -> Champion produced 6 scenarios with full narrative.
4. **Follow-up chat** — Not yet wired into the What-If modal (Step 11 partial).
5. **Regenerate button** — Not yet added to the ready-state UI (Step 11 partial).
