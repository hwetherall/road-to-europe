# CLAUDE.md — Keepwatch: EPL Qualification Simulator

## Project Overview

**Keepwatch** is a web application that calculates the probability of any EPL team achieving their season objective (European qualification, title, survival) via Monte Carlo simulation of remaining fixtures, enhanced with sensitivity analysis and AI-powered football intelligence.

The tool answers three questions in sequence:
1. **What are the odds?** — Monte Carlo simulation of 10,000 season outcomes
2. **What actually matters?** — Sensitivity analysis identifies the 5-10 fixtures (out of ~80 remaining) with the highest leverage on the selected team's odds
3. **What should I watch for?** — AI-powered research on teams/players involved in high-leverage fixtures, surfacing real-world factors that could swing outcomes

### Version History
- **V1** (complete): Newcastle-only, base simulation + sensitivity analysis + fixture list + standings
- **V2** (this build): Any-team selector, what-if mode, expanded metrics, branding update
- **V3** (future): User-driven scenario chat via OpenRouter ("what if Bruno gets injured?")
- **V4** (future): Inverse scenario discovery ("what needs to happen for Europe to be >50%?")

---

## V2 Scope — What's New

### 1. Team Selector
- Dropdown or grid at the top of the page lets user pick any of the 20 EPL teams
- All simulation outputs, sensitivity analysis, fixture lists, and insights re-target to the selected team
- The header, accent colour, and "zone of interest" adapt to the selected team's context:
  - Teams in 1st-4th: primary metric is "title odds" + "UCL qualification"
  - Teams in 5th-10th: primary metric is "European qualification" (same as V1 Newcastle view)
  - Teams in 15th-20th: primary metric is "relegation odds" + "survival probability"
- Default selection: Newcastle (preserve V1 behaviour for returning users)
- URL state: `?team=NEW` so links can be shared per-team

### 2. Expanded Metrics
Add to the qualification cards row based on team context:

**For all teams:**
- Expected final points (avg from simulation)
- Expected final position (avg from simulation)
- Position distribution chart (mini histogram: what positions does this team finish in across 10K sims?)

**Context-sensitive cards (show the most relevant 4-5):**
- Champion (1st place) %
- Champions League (top 4) %
- UCL expanded (top 5) %
- Europa League (top 6) %
- Conference League (top 7) %
- Any Europe (top 7) %
- Relegation (bottom 3) %
- Survival (not bottom 3) %

The system should auto-select which cards to show based on which are most meaningful for the team's current position. A team in 2nd doesn't need to see relegation odds. A team in 19th doesn't need to see Champions League odds. Show the cards where the probability is neither ~0% nor ~100% — that's where the interesting information lives.

### 3. What-If Mode
Allow users to manually lock fixture outcomes and see the impact on simulated odds in real time.

**UI:**
- Toggle button: "What-If Mode" that reveals an interactive fixture panel
- Each upcoming fixture shows three clickable outcome buttons: Home Win / Draw / Away Win
- Clicking one locks that fixture's outcome (visually highlighted, probability set to 1.0/0.0/0.0)
- Clicking again unlocks it (returns to natural probability)
- A "Reset All" button clears all locks
- The simulation re-runs automatically when locks change (debounced, ~300ms delay)
- A comparison strip at the top shows: "Base odds: X% → What-if odds: Y% (Δ +Z pp)"

**Implementation:**
- Store locked fixtures in component state: `Record<fixtureId, 'home' | 'draw' | 'away' | null>`
- Before simulation, overlay locks onto fixture probabilities
- Re-run Tier 1 simulation on every lock change (10K sims, ~200ms, fast enough for real-time)
- Optionally re-run Tier 2 sensitivity with locks applied (show which *remaining unlocked* fixtures now matter most)

**Key UX detail:** The what-if panel should show ALL upcoming fixtures grouped by matchday, not just the selected team's fixtures. The whole point is that locking Chelsea to lose a match might matter more than locking Newcastle to win one.

### 4. Branding Update
- Rename from "Newcastle European Qualification Simulator" to **"Keepwatch"**
- Tagline: "EPL Season Simulator"
- Update page title, metadata, header
- The team selector replaces the hardcoded Newcastle header
- Keep the dark theme but make the accent colour dynamic per team (see Team Colours below)

---

## Tech Stack (unchanged from V1)

```
Frontend:    Next.js (App Router) + Tailwind CSS
Computation: Client-side Monte Carlo engine (TypeScript)
Data:        football-data.org (standings + fixtures) + the-odds-api.com (match probabilities)
AI Layer:    OpenRouter (insight generation — carry forward from V1 if implemented)
Hosting:     Vercel
```

### API Keys (.env.local — unchanged)

```env
FOOTBALL_DATA_API_KEY=       # https://www.football-data.org/client/register (free, 10 req/min)
ODDS_API_KEY=                # https://the-odds-api.com (free, 500 req/month)
OPENROUTER_API_KEY=          # For insight engine + future chat features
```

---

## Updated Architecture

### Data Flow (V2)

```
User selects team (or lands on default: Newcastle)
    │
    ├─► URL updates: ?team=NEW
    │
    ├─► Data fetch (same as V1, team-agnostic):
    │   ├─► /api/standings → Team[]
    │   ├─► /api/fixtures  → Fixture[]
    │   └─► /api/odds      → match probabilities
    │
    ▼
Client receives merged data
    │
    ├─► Tier 1: Base Simulation (10,000 sims, ~200ms)
    │   └─► Full league results — extract selected team's metrics
    │
    ├─► Tier 2: Sensitivity Scan (1,000 sims × ~80 fixtures, ~500ms)
    │   └─► Ranked by impact on selected team's primary objective
    │
    ├─► What-If Mode (when active):
    │   └─► User locks fixtures → re-run Tier 1 with locks → show delta
    │
    └─► Tier 3: Insight Engine (server-side, OpenRouter)
        └─► Scoped to selected team + their high-leverage fixtures
```

### New/Modified Files

```
app/
├── page.tsx                          # Add ?team= query param handling
├── components/
│   ├── Dashboard.tsx                 # MODIFY: Accept selectedTeam prop, pass to all children
│   ├── TeamSelector.tsx              # NEW: Team picker grid/dropdown
│   ├── QualificationCards.tsx        # MODIFY: Context-sensitive card selection
│   ├── PositionHistogram.tsx         # NEW: Mini distribution chart
│   ├── WhatIfPanel.tsx              # NEW: Interactive fixture locking
│   ├── WhatIfComparison.tsx         # NEW: Base vs What-If odds comparison strip
│   ├── SensitivityChart.tsx          # MODIFY: Re-target to selected team
│   ├── FixtureList.tsx              # MODIFY: Show selected team's fixtures
│   ├── StandingsTable.tsx           # MODIFY: Highlight selected team
│   ├── LeagueProjections.tsx        # MODIFY: Highlight selected team
│   └── RefreshButton.tsx            # Unchanged
│
lib/
├── team-context.ts                   # NEW: Logic for determining team's zone + relevant metrics
├── team-colours.ts                   # NEW: Accent colours per team
├── types.ts                          # MODIFY: Add WhatIfState, TeamContext interfaces
├── montecarlo.ts                     # Unchanged (already team-agnostic)
├── sensitivity.ts                    # MODIFY: Accept target team parameter (already does)
├── constants.ts                      # MODIFY: Add team colour/crest mappings
└── [everything else unchanged]
```

---

## New Interfaces

```typescript
// Add to lib/types.ts

interface TeamContext {
  team: string;                        // abbr
  zone: 'title' | 'europe' | 'midtable' | 'relegation';
  primaryMetric: string;               // e.g. 'top7Pct' or 'relegationPct'
  relevantCards: CardConfig[];          // which qualification cards to show
  accentColor: string;                 // team-specific accent
}

interface CardConfig {
  key: keyof SimulationResult;         // e.g. 'top4Pct'
  label: string;                       // e.g. 'Champions League'
  sub: string;                         // e.g. 'Top 4'
  color: string;                       // card accent
  invert?: boolean;                    // true for relegation (lower = better)
}

interface WhatIfState {
  locks: Record<string, 'home' | 'draw' | 'away'>;  // fixtureId → locked result
  baseResult: SimulationResult | null;                 // result without locks
  whatIfResult: SimulationResult | null;               // result with locks
}

// Extend SimulationResult (add to existing)
interface SimulationResult {
  // ... existing fields ...
  championPct: number;                 // NEW: 1st place
  survivalPct: number;                 // NEW: not bottom 3 (100 - relegationPct)
}
```

---

## Implementation Details

### Team Context Logic (lib/team-context.ts)

```typescript
function getTeamContext(team: Team, standings: Team[]): TeamContext {
  const position = standings
    .sort((a, b) => b.points - a.points || b.goalDifference - a.goalDifference)
    .findIndex(t => t.abbr === team.abbr) + 1;

  const gamesLeft = 38 - team.played;
  const maxPossiblePoints = team.points + (gamesLeft * 3);
  const leaderPoints = standings[0].points;
  const relegationZonePoints = standings[17]?.points ?? 0;

  // Determine zone based on position AND mathematical possibility
  if (position <= 4 || (position <= 8 && maxPossiblePoints >= leaderPoints)) {
    // Could still win the league or is in UCL spots
    if (position <= 2) return titleContext(team);
    return europeContext(team);  // show both title (if close) and European odds
  }

  if (position >= 15 || team.points - relegationZonePoints < gamesLeft * 2) {
    // In or near the relegation scrap
    return relegationContext(team);
  }

  return europeContext(team);  // default: European race
}

// Each context function returns the relevant CardConfig array
// Example for europeContext:
function europeContext(team: Team): TeamContext {
  return {
    team: team.abbr,
    zone: 'europe',
    primaryMetric: 'top7Pct',
    accentColor: TEAM_COLOURS[team.abbr],
    relevantCards: [
      { key: 'top4Pct', label: 'Champions League', sub: 'Top 4', color: '#FFD700' },
      { key: 'top5Pct', label: 'UCL (Expanded)', sub: 'Top 5', color: '#C0C0C0' },
      { key: 'top6Pct', label: 'Europa League', sub: 'Top 6', color: '#FF6B35' },
      { key: 'top7Pct', label: 'Any Europe', sub: 'Top 7', color: '#00CCAA' },
    ],
  };
}

// For relegation-threatened teams:
function relegationContext(team: Team): TeamContext {
  return {
    team: team.abbr,
    zone: 'relegation',
    primaryMetric: 'survivalPct',
    accentColor: TEAM_COLOURS[team.abbr],
    relevantCards: [
      { key: 'survivalPct', label: 'Survival', sub: 'Not Bottom 3', color: '#22c55e' },
      { key: 'relegationPct', label: 'Relegation', sub: 'Bottom 3', color: '#ef4444', invert: true },
      { key: 'top7Pct', label: 'Any Europe', sub: 'Top 7', color: '#00CCAA' },
      // Maybe include a "miracle" card if mathematically possible
    ],
  };
}
```

### Team Colours (lib/team-colours.ts)

```typescript
export const TEAM_COLOURS: Record<string, string> = {
  ARS: '#EF0107',   // Arsenal red
  MCI: '#6CABDD',   // City sky blue
  MUN: '#DA291C',   // United red
  AVL: '#670E36',   // Villa claret
  CFC: '#034694',   // Chelsea blue
  LFC: '#C8102E',   // Liverpool red
  BRE: '#e30613',   // Brentford red
  FUL: '#CC0000',   // Fulham red
  EVE: '#003399',   // Everton blue
  BRI: '#0057B8',   // Brighton blue
  NEW: '#00aaaa',   // Newcastle teal (our original accent)
  BOU: '#DA291C',   // Bournemouth red
  SUN: '#EB172B',   // Sunderland red
  CRY: '#1B458F',   // Palace blue
  LEE: '#FFCD00',   // Leeds yellow
  TOT: '#132257',   // Spurs navy
  NFO: '#DD0000',   // Forest red
  WHU: '#7A263A',   // West Ham claret
  BUR: '#6C1D45',   // Burnley claret
  WOL: '#FDB913',   // Wolves gold
};

// For teams with dark accent colours, use a lighter variant for text
export const TEAM_TEXT_COLOURS: Record<string, string> = {
  // Override only where the accent is too dark for text on dark background
  AVL: '#9B3A6B',
  CFC: '#4A8BCC',
  TOT: '#5B6FA0',
  WHU: '#B8506A',
  BUR: '#A85080',
  // All others: use TEAM_COLOURS directly
};
```

### What-If Panel (app/components/WhatIfPanel.tsx)

```typescript
// Key design decisions:

// 1. Show ALL fixtures grouped by matchday, not just selected team's
//    Reason: Locking a rival's loss may matter more than locking your own win

// 2. Highlight the selected team's fixtures with their accent colour
//    Other fixtures shown in neutral styling

// 3. High-leverage fixtures (from sensitivity scan) get a subtle indicator
//    e.g. a small "HIGH IMPACT" badge — guides user toward meaningful what-ifs

// 4. Each fixture row has 3 clickable buttons: [H] [D] [A]
//    Active lock shown as filled button with green/grey/red colouring
//    Inactive: outline buttons

// 5. Lock count shown at top: "3 fixtures locked"

// 6. Re-simulation triggered on every lock change, debounced 300ms
//    The debounce prevents rapid re-sims when user clicks several in a row

// 7. Comparison strip (WhatIfComparison.tsx) appears above qualification cards:
//    "Base: 18.7% → What-If: 34.2% → Δ +15.5pp"
//    Colour-coded: green if improved, red if worsened

// 8. When what-if mode is active, sensitivity chart updates to show
//    leverage of REMAINING UNLOCKED fixtures only
```

### Position Histogram (app/components/PositionHistogram.tsx)

```typescript
// A compact bar chart showing the distribution of finishing positions
// from the simulation for the selected team.
//
// X-axis: positions 1-20
// Y-axis: percentage of simulations
// Bars coloured by zone: UCL green, Europa orange, Conference teal, relegation red, grey otherwise
// Selected team's most likely finishing position highlighted
//
// This gives users a much richer picture than just "18.7% for top 7".
// They can see: "Newcastle finishes 7th-9th most often, with a long tail into 5th-6th
// and almost never drops below 13th"
//
// Keep it compact — about 120px tall, full width, below the qualification cards.
```

### Updated Monte Carlo Engine

The engine itself (`lib/montecarlo.ts`) is already team-agnostic — it simulates the full league and returns results for every team. The only change needed:

```typescript
// Add to SimulationResult calculation in simulate():
championPct: positionCounts[i][0] / numSims * 100,              // finished 1st
survivalPct: (1 - positionCounts[i].slice(-3).reduce((a, b) => a + b, 0) / numSims) * 100,
```

### Updated Sensitivity Scanner

Already accepts `targetTeam` parameter — no engine changes needed. The Dashboard just passes the selected team instead of hardcoded `'NEW'`.

One enhancement: when What-If locks are active, re-run sensitivity on the modified fixture set so it shows leverage of *remaining unlocked* fixtures. This is a simple change — apply locks to the fixture array before passing to `sensitivityScan()`.

---

## UI Design Updates

### Header (replaces V1 Newcastle-specific header)

```
┌────────────────────────────────────────────────────────┐
│  ◆ KEEPWATCH                                           │
│    EPL Season Simulator                                │
│                                                        │
│  [Team Selector: grid of 20 badges or searchable       │
│   dropdown — selected team highlighted]                │
│                                                        │
│  Position: 11th  │  Points: 42  │  GD: +1  │  8 left  │
└────────────────────────────────────────────────────────┘
```

- The accent colour of the entire page shifts to match the selected team
- Team name + stats bar updates reactively
- Keepwatch logo/name stays consistent regardless of team selection

### Team Selector Design Options

**Option A: Badge Grid** — 20 small team-coloured squares/circles in a 4×5 or 5×4 grid. Compact, visual, shows all options at once. Hovered badge shows team name tooltip. Selected badge has a ring/glow.

**Option B: Dropdown with colour dots** — Standard select/combobox but each option has a coloured dot + team name. More conventional, less visual.

**Recommendation:** Badge grid for desktop (it's more fun and this is a football tool), dropdown for mobile (space constrained). Render both, show appropriate one via responsive classes.

### What-If Mode Toggle

A toggle switch or button in the toolbar area (near Refresh), labelled "What-If Mode". When activated:
- The fixture locking panel slides in below the sensitivity chart
- The comparison strip appears above qualification cards
- A subtle visual shift (maybe a thin coloured border) signals "you're in what-if mode"

### Page Layout (V2, top to bottom)

1. **Header** — Keepwatch branding + team selector + selected team stats
2. **Toolbar** — Refresh button + What-If toggle + simulation count
3. **What-If Comparison Strip** (only when what-if active + locks present)
4. **Qualification Cards** — Context-sensitive, 4-5 cards based on team zone
5. **Position Histogram** — Distribution chart for selected team
6. **High-Leverage Fixtures** — Sensitivity chart (re-targeted to selected team)
7. **What-If Panel** (only when what-if active) — All fixtures with lock buttons
8. **Things to Look For** — AI insight cards (if insight engine is implemented)
9. **Team's Remaining Fixtures** — Selected team's upcoming matches with win %
10. **Full League Projections** — Expandable table, selected team highlighted
11. **Current Standings** — EPL table, selected team highlighted
12. **Methodology** — Updated to reflect V2 features

---

## Build Order (V2)

Each step extends the existing V1 codebase. Do not rewrite working code — modify and extend.

### Step 1: Branding + Team Colours
- Update page title/metadata to "Keepwatch — EPL Season Simulator"
- Create `lib/team-colours.ts` with colour mappings
- Update header component: replace hardcoded "Newcastle United" with dynamic team name
- Add CSS variable for accent colour that cascades through the page
- **Test:** Header shows "Keepwatch" branding. Accent colour changes when you manually change the target team constant.

### Step 2: Team Context Logic
- Create `lib/team-context.ts` with zone detection and card selection logic
- Update `QualificationCards.tsx` to accept `TeamContext` and render context-appropriate cards
- Add `championPct` and `survivalPct` to simulation output in `lib/montecarlo.ts`
- **Test:** Manually set target to Arsenal (should show title + UCL cards), Wolves (should show relegation + survival cards), Newcastle (should show European cards).

### Step 3: Team Selector Component
- Create `TeamSelector.tsx` — badge grid for desktop, dropdown for mobile
- Wire to URL state: `?team=XXX` query parameter
- Update `Dashboard.tsx` to read selected team from URL and pass through to all children
- Update `StandingsTable`, `FixtureList`, `LeagueProjections`, `SensitivityChart` to highlight/target selected team instead of hardcoded NEW
- **Test:** Select different teams, verify all components update. Share a URL with `?team=ARS`, verify it loads Arsenal.

### Step 4: Position Histogram
- Create `PositionHistogram.tsx` — compact bar chart from `positionDistribution` array
- Place below qualification cards
- Colour bars by zone (UCL green, Europa orange, etc.)
- **Test:** Run simulation, verify histogram looks reasonable. Arsenal should cluster at positions 1-3. Wolves should cluster at 18-20.

### Step 5: What-If Mode — State + Simulation
- Add `WhatIfState` to types
- Add lock state management to `Dashboard.tsx`
- Create function to apply locks to fixture array before simulation
- Wire up: lock change → debounced re-simulation → update results
- **Test:** Lock a fixture in code, verify simulation results change. Lock Newcastle to win all remaining → European odds should jump significantly.

### Step 6: What-If Mode — UI
- Create `WhatIfPanel.tsx` — fixture list with lock buttons, grouped by matchday
- Create `WhatIfComparison.tsx` — delta strip showing base vs what-if odds
- Add "What-If Mode" toggle to toolbar
- Highlight high-leverage fixtures in the what-if panel (using sensitivity data)
- **Test:** Full interactive flow — toggle what-if mode, lock fixtures, see odds update in real time, reset all.

### Step 7: Polish + Integration
- Ensure all components respect the selected team's accent colour
- Mobile responsiveness for team selector and what-if panel
- Loading states during re-simulation
- Edge cases: what happens when user switches team while what-if locks are active? (Answer: clear locks, since they're no longer contextually relevant — or keep them, since fixture outcomes are team-agnostic. Recommend: keep locks, just re-target the analysis.)
- **Test:** Full end-to-end flow across multiple teams with what-if mode.

### Step 8: Insight Engine Integration (if not done in V1)
- Same as V1 Step 8 but scoped to selected team
- Insight system prompt references selected team, not hardcoded Newcastle
- **Test:** Select Chelsea, verify insights are about Chelsea's European/title race, not Newcastle's.

---

## Important Design Decisions

### Lock Persistence When Switching Teams
When a user switches the selected team, what-if locks should be PRESERVED. The locks represent "I think this fixture will go this way" — that belief is team-agnostic. The simulation just re-interprets the impact through the lens of the newly selected team. This also enables a powerful workflow: "If Chelsea lose to Brentford, how does that affect Newcastle? How does it affect Everton? How does it affect Brentford?" — same lock, switch teams, compare.

### Sensitivity Re-targeting
The sensitivity scan's `targetTeam` parameter already makes this flexible. When the user switches teams, re-run sensitivity for the new team. The high-leverage fixtures WILL be different for different teams — that's expected and interesting.

### Performance with What-If
Each lock change triggers a Tier 1 re-simulation (10K sims, ~200ms). This is fast enough for real-time feel. Do NOT re-run Tier 2 sensitivity on every lock change — it's too expensive (~500ms). Instead, re-run sensitivity only when the user explicitly refreshes or when what-if mode is toggled off.

### Card Selection Thresholds
Don't show a card if its probability is <0.1% or >99.9%. These are noise and waste space. For the "interesting zone" between 0.1% and 99.9%, show the 4-5 cards most relevant to the team's position. Always include the team's primary objective metric.

---

## Performance Budget (V2)

- Team switch: < 50ms (just state change, no re-simulation needed until refresh)
- Tier 1 simulation: < 300ms (unchanged)
- Tier 2 sensitivity: < 800ms (unchanged, but now for selected team)
- What-if re-simulation: < 300ms per lock change (Tier 1 only)
- Total interactive latency: user should never wait more than 500ms for visual feedback

---

## Future V3/V4 Hooks

V2 lays groundwork for later versions:

- **Team selector** enables V2→V3 naturally (chat just needs to know which team context to use)
- **What-if locks** are the primitive that V3's chat interface manipulates ("lock Chelsea to lose" = set lock programmatically)
- **Sensitivity scan** data feeds directly into V4's scenario search (top-N fixtures = search space)
- **Position histogram** becomes the basis for V4's threshold visualisation ("shade the area where Europe is achieved")
