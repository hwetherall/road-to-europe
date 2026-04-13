# CLAUDE.md — Newcastle European Qualification Simulator

## Project Overview

A web application that calculates the probability of Newcastle United qualifying for European competition via Monte Carlo simulation of remaining EPL fixtures, enhanced with AI-powered sensitivity analysis and football intelligence.

The tool answers three questions in sequence:
1. **What are the odds?** — Monte Carlo simulation of 10,000 season outcomes
2. **What actually matters?** — Sensitivity analysis identifies the 5-10 fixtures (out of ~80 remaining) that have the highest leverage on Newcastle's European odds
3. **What should I watch for?** — AI-powered research on the teams/players involved in those high-leverage fixtures, surfacing real-world factors (injuries, form, fatigue, fixture congestion) that could swing outcomes

This is a V1 build focused on Newcastle. Future versions generalise to any team (V2), add user-driven scenario chat (V3), and inverse scenario discovery (V4).

---

## Tech Stack

```
Frontend:    Next.js 14 (App Router) + Tailwind CSS + shadcn/ui
Computation: Client-side Monte Carlo engine (TypeScript)
Data:        football-data.org (standings + fixtures) + the-odds-api.com (match probabilities)
AI Layer:    OpenRouter (insight generation + future chat features)
Hosting:     Vercel
```

### API Keys Required (.env.local)

```env
FOOTBALL_DATA_API_KEY=       # https://www.football-data.org/client/register (free, 10 req/min)
ODDS_API_KEY=                # https://the-odds-api.com (free, 500 req/month)
OPENROUTER_API_KEY=          # For insight engine (V1) and chat (V3)
```

---

## Architecture

### Data Flow

```
User clicks Refresh
    │
    ├─► /api/standings    → football-data.org → Team[] (points, GD, played)
    ├─► /api/fixtures     → football-data.org → Fixture[] (completed results + scheduled)
    └─► /api/odds         → the-odds-api.com  → probabilities for upcoming fixtures
                                               → Elo fallback for fixtures without odds
    │
    ▼
Client receives merged data
    │
    ├─► Tier 1: Base Simulation (10,000 sims, ~200ms)
    │   └─► Qualification odds cards (Top 4, Top 5, Top 6, Top 7)
    │
    ├─► Tier 2: Sensitivity Scan (1,000 sims × ~80 fixtures, ~500ms)  
    │   └─► Leverage ranking: which fixtures move Newcastle's odds most
    │   └─► NOTE: Many high-leverage fixtures may NOT involve Newcastle
    │
    └─► Tier 3: Insight Engine (server-side, OpenRouter)
        └─► Takes top 5-10 high-leverage fixtures from Tier 2
        └─► Runs targeted web research on teams/players in those fixtures
        └─► Generates 3-5 "Things to Look For" insight cards
```

### Tiered Computation Model

All Monte Carlo runs execute client-side. The math is simple (loop fixtures, random number, compare against W/D/L probabilities, accumulate points) and fast enough for the browser.

**Tier 1 — Base Simulation (V1 core)**
- 10,000 simulations, all fixtures at natural probabilities
- ~200ms on modern hardware
- Output: qualification probability for every team

**Tier 2 — Sensitivity Scan (V1 core)**
- For each of ~80 remaining fixtures, lock the result to home-win, then away-win
- Run 1,000 sims per lock
- Compare Newcastle's European odds vs baseline
- Rank fixtures by delta (leverage)
- ~500ms total
- Output: ordered list of high-leverage fixtures with impact magnitude

**Tier 3 — Insight Engine (V1, server-side)**
- Takes top 5-10 fixtures from Tier 2
- For each team involved, runs targeted research via OpenRouter with web search
- Generates "Things to Look For" cards
- Cache structural insights daily, refresh matchday-specific triggers per session

**Tier 4 — Scenario Search (V4, future)**
- Takes top 15 high-leverage fixtures from Tier 2
- Tests combinations to find minimum scenario that crosses user-specified probability threshold
- Agent swarm: Sensitivity Mapper → Scenario Composer → Narrative Validator → Threshold Finder

---

## Project Structure

```
newcastle-sim/
├── app/
│   ├── page.tsx                      # Main page — orchestrates refresh + display
│   ├── layout.tsx                    # Root layout, fonts, metadata
│   │
│   ├── api/
│   │   ├── standings/route.ts        # Proxy to football-data.org standings
│   │   ├── fixtures/route.ts         # Proxy to football-data.org matches
│   │   ├── odds/route.ts             # Proxy to the-odds-api.com + Elo fallback
│   │   └── insights/route.ts         # OpenRouter insight generation
│   │
│   └── components/
│       ├── Dashboard.tsx             # Main container, manages refresh state
│       ├── QualificationCards.tsx     # Top 4 / Top 5 / Top 6 / Top 7 probability cards
│       ├── StandingsTable.tsx        # Full EPL table with European zone colours
│       ├── FixtureList.tsx           # Newcastle's remaining fixtures with win %
│       ├── SensitivityChart.tsx      # Bar chart of highest-leverage fixtures
│       ├── InsightCards.tsx          # "Things to Look For" — AI-generated cards
│       └── RefreshButton.tsx         # Triggers full data refresh + simulation
│
├── lib/
│   ├── types.ts                      # All TypeScript interfaces
│   ├── montecarlo.ts                 # Core simulation engine (Tier 1)
│   ├── sensitivity.ts                # Sensitivity scan (Tier 2)
│   ├── elo.ts                        # Elo rating calculation + probability estimation
│   ├── odds-converter.ts             # Betting odds → normalised probabilities
│   ├── football-data.ts              # football-data.org API client
│   ├── odds-api.ts                   # the-odds-api.com client
│   └── constants.ts                  # EPL config, European place thresholds
│
├── .env.local
├── CLAUDE.md                         # This file
└── package.json
```

---

## Core Interfaces

```typescript
interface Team {
  id: string;
  name: string;
  abbr: string;              // 3-letter code
  points: number;
  goalDifference: number;
  goalsFor: number;
  goalsAgainst: number;
  played: number;
  won: number;
  drawn: number;
  lost: number;
}

interface Fixture {
  id: string;
  homeTeam: string;          // team abbr
  awayTeam: string;
  matchday: number;
  date: string;
  status: 'FINISHED' | 'SCHEDULED' | 'LIVE';
  // Completed
  homeScore?: number;
  awayScore?: number;
  // Upcoming — probabilities (always sum to 1.0)
  homeWinProb?: number;
  drawProb?: number;
  awayWinProb?: number;
  probSource: 'odds_api' | 'elo_estimated';
}

interface SimulationResult {
  team: string;
  positionDistribution: number[];  // length 20, counts per finishing position
  top4Pct: number;                 // Champions League
  top5Pct: number;                 // UCL expanded
  top6Pct: number;                 // Europa League
  top7Pct: number;                 // Conference League / any Europe
  relegationPct: number;           // Bottom 3
  avgPoints: number;
  avgPosition: number;
}

interface SensitivityResult {
  fixtureId: string;
  homeTeam: string;
  awayTeam: string;
  // Delta on Newcastle's top-7 probability when this fixture is locked
  deltaIfHomeWin: number;          // e.g. +4.2 means Newcastle odds go up 4.2pp
  deltaIfAwayWin: number;
  deltaIfDraw: number;
  maxAbsDelta: number;             // highest absolute impact — used for ranking
}

interface Insight {
  id: string;
  headline: string;                // e.g. "Villa's European hangover"
  body: string;                    // 2-3 sentence pundit-style analysis
  affectedTeam: string;
  impactOnNewcastle: 'positive' | 'negative' | 'neutral';
  magnitude: 'high' | 'medium' | 'low';
  category: 'fixture_congestion' | 'player_dependency' | 'form' | 'inflection_point' | 'other';
  relatedFixtures: string[];       // fixture IDs this insight relates to
}
```

---

## Implementation Details

### Monte Carlo Engine (lib/montecarlo.ts)

```typescript
function simulate(teams: Team[], fixtures: Fixture[], numSims: number): SimulationResult[] {
  // For each simulation:
  //   1. Clone current points/GD/GF for all 20 teams
  //   2. For each remaining fixture:
  //      - Generate random number [0, 1)
  //      - If < homeWinProb: home gets 3 pts, simulate scoreline via Poisson for GD
  //      - Else if < homeWinProb + drawProb: both get 1 pt
  //      - Else: away gets 3 pts, simulate scoreline via Poisson for GD
  //   3. Sort teams by points → GD → GF (EPL tiebreakers)
  //   4. Record each team's finishing position
  // Return aggregated position distributions and qualification percentages
}

// Poisson-distributed goal sampling for realistic GD modelling
function sampleGoals(lambda: number): number {
  let L = Math.exp(-lambda);
  let k = 0, p = 1;
  do { k++; p *= Math.random(); } while (p > L);
  return k - 1;
}

// Goal expectations by result type (calibrated to EPL averages)
// Home win:  home ~1.7 goals, away ~0.6
// Draw:      both ~1.1
// Away win:  away ~1.5, home ~0.7
```

### Sensitivity Scan (lib/sensitivity.ts)

```typescript
function sensitivityScan(
  teams: Team[],
  fixtures: Fixture[],
  targetTeam: string,        // "NEW"
  simsPerLock: number        // 1000
): SensitivityResult[] {
  const baseline = simulate(teams, fixtures, simsPerLock);
  const baselineTop7 = baseline.find(r => r.team === targetTeam)!.top7Pct;

  return fixtures.map(fixture => {
    // Lock to home win (homeWinProb=1, others=0), re-simulate
    const homeWinResult = simulate(teams, lockFixture(fixtures, fixture.id, 'home'), simsPerLock);
    const deltaHome = homeWinResult.find(r => r.team === targetTeam)!.top7Pct - baselineTop7;

    // Lock to away win
    const awayWinResult = simulate(teams, lockFixture(fixtures, fixture.id, 'away'), simsPerLock);
    const deltaAway = awayWinResult.find(r => r.team === targetTeam)!.top7Pct - baselineTop7;

    // Lock to draw
    const drawResult = simulate(teams, lockFixture(fixtures, fixture.id, 'draw'), simsPerLock);
    const deltaDraw = drawResult.find(r => r.team === targetTeam)!.top7Pct - baselineTop7;

    return {
      fixtureId: fixture.id,
      homeTeam: fixture.homeTeam,
      awayTeam: fixture.awayTeam,
      deltaIfHomeWin: deltaHome,
      deltaIfAwayWin: deltaAway,
      deltaIfDraw: deltaDraw,
      maxAbsDelta: Math.max(Math.abs(deltaHome), Math.abs(deltaAway), Math.abs(deltaDraw)),
    };
  }).sort((a, b) => b.maxAbsDelta - a.maxAbsDelta);
}
```

### Odds Conversion (lib/odds-converter.ts)

```typescript
// the-odds-api.com returns decimal odds from multiple bookmakers
// Convert to implied probability and remove overround (bookmaker margin)

function oddsToProb(homeOdds: number, drawOdds: number, awayOdds: number) {
  const rawHome = 1 / homeOdds;
  const rawDraw = 1 / drawOdds;
  const rawAway = 1 / awayOdds;
  const overround = rawHome + rawDraw + rawAway;  // typically 1.05-1.10

  return {
    homeWin: rawHome / overround,
    draw: rawDraw / overround,
    awayWin: rawAway / overround,
  };
}

// Average across bookmakers for more stable estimates
// the-odds-api returns multiple bookmaker lines — average the normalised probabilities
```

### Elo Fallback (lib/elo.ts)

```typescript
// For fixtures without betting odds (too far in future or not posted yet)
// Calculate from current season performance

function eloProb(homeStrength: number, awayStrength: number) {
  const HOME_ADV = 65;  // Elo points
  const diff = homeStrength + HOME_ADV - awayStrength;
  const expectedHome = 1 / (1 + Math.pow(10, -diff / 400));
  const drawRate = Math.max(0.10, 0.26 - 0.004 * Math.abs(diff / 50));
  
  return {
    homeWin: Math.max(0.05, expectedHome - drawRate / 2),
    draw: drawRate,
    awayWin: Math.max(0.05, 1 - expectedHome - drawRate / 2),
  };
}

// Derive team Elo from points-per-game: base 1500 + (ppg - 1.5) * 200
// This is a simple heuristic. V2 could use proper Elo with match-by-match updates.
```

### Insight Engine (app/api/insights/route.ts)

```typescript
// POST /api/insights
// Body: { sensitivityResults: SensitivityResult[], standings: Team[], targetTeam: string }

// Step 1: Take top 5-10 fixtures by maxAbsDelta from sensitivity results
// Step 2: Identify unique teams involved in those fixtures
// Step 3: For each team, construct targeted search queries:
//   - "[team] injury news [current month] [current year]"
//   - "[team] form last 5 matches premier league"
//   - "[team] fixture congestion europe"
//   - "[team] manager pressure"
// Step 4: Send to OpenRouter with system prompt:

const INSIGHT_SYSTEM_PROMPT = `You are a Premier League football analyst. You have been given:
1. The current EPL standings
2. A sensitivity analysis showing which upcoming fixtures have the highest impact on {targetTeam}'s European qualification odds
3. Recent research on the teams involved in those high-leverage fixtures

Generate 3-5 "Things to Look For" insights. Each insight must:
- Connect a real-world football factor to a specific high-leverage fixture
- Be written in confident pundit voice (think Gary Neville, not a data scientist)
- Include a concrete thing the user can watch for (a player, a tactical matchup, a scheduling factor)
- Note whether this factor helps or hurts {targetTeam}'s European chances

Format each insight as JSON matching the Insight interface.

IMPORTANT: Only generate insights about teams/fixtures that appear in the sensitivity analysis.
Do NOT waste tokens on mid-table or relegation irrelevancies. Stay tightly focused on
what materially affects {targetTeam}'s path to Europe.`;

// Step 5: Parse response, cache structural insights for 24h, return to client
```

---

## Odds API Integration

### the-odds-api.com Setup

```
Endpoint: https://api.the-odds-api.com/v4/sports/soccer_epl/odds/
Params:   ?apiKey={key}&regions=uk&markets=h2h&oddsFormat=decimal
```

Returns odds from ~10 UK bookmakers per fixture. The `h2h` market gives 3-way odds (home/draw/away).

**Budget management:** 500 free requests/month. Each refresh calls the odds endpoint once (returns all available fixtures). At one refresh per day, that's ~30 requests/month. Even with development and testing, well within budget.

**Fixture matching:** the-odds-api uses team names (e.g. "Newcastle United") not IDs. Match against football-data.org fixtures by team name + date proximity (within 2 days to handle timezone differences).

### football-data.org Setup

```
Standings: GET https://api.football-data.org/v4/competitions/PL/standings
           Header: X-Auth-Token: {key}

Fixtures:  GET https://api.football-data.org/v4/competitions/PL/matches
           Params: ?status=SCHEDULED  (or FINISHED for results)
           Header: X-Auth-Token: {key}
```

Free tier: 10 requests per minute. Cache standings for 5 minutes, fixtures for 15 minutes.

---

## UI Design

### Theme
- **Palette:** Dark background (#0a0a0a), white text, teal accent (#00aaaa / #00ddbb) — Newcastle's away-kit energy
- **Typography:** Oswald (headings, numbers) + Inter (body) — loaded via Google Fonts
- **Zones:** Champions League green, Europa orange, Conference teal, Relegation red — consistent with broadcast conventions

### Page Layout (top to bottom)

1. **Header** — Newcastle badge area, current position/points/GD, games remaining
2. **Refresh Button** — triggers full pipeline, shows spinner during fetch + simulation
3. **Qualification Odds Cards** — 4 cards: Top 4, Top 5, Top 6, Top 7 with percentage + bar
4. **High-Leverage Fixtures** — Sensitivity chart: bar chart or ranked list of the 5-10 fixtures that matter most, showing which result helps/hurts Newcastle
5. **Things to Look For** — 3-5 AI insight cards with headline, analysis, impact tag
6. **Newcastle Remaining Fixtures** — List with home/away tag, opponent, win probability, prob source tag
7. **Full League Projections** — Expandable table: all 20 teams × qualification/relegation odds
8. **Current Standings** — Standard EPL table with zone colours
9. **Methodology** — Brief explanation of Monte Carlo approach, data sources, caveats

### Key Interactions
- Refresh → loading state → all sections update simultaneously
- "Show Full League Projections" toggle (collapsed by default)
- Insight cards show source tag (research freshness)
- Sensitivity bars are colour-coded: green = good for Newcastle, red = bad

---

## Build Order

Execute these steps sequentially. Each step should be independently testable.

### Step 1: Project Setup
```bash
npx create-next-app@latest newcastle-sim --typescript --tailwind --app --src-dir=false
cd newcastle-sim
npx shadcn-ui@latest init
```
Install dependencies: none beyond Next.js defaults + shadcn for V1.

### Step 2: Types + Constants
Create `lib/types.ts` with all interfaces above.
Create `lib/constants.ts` with EPL config (20 teams, 38 matchdays, European place thresholds).

### Step 3: Data Layer — football-data.org
Build `lib/football-data.ts` — API client with auth header, response parsing, error handling.
Build `app/api/standings/route.ts` — returns Team[].
Build `app/api/fixtures/route.ts` — returns Fixture[] (both completed and scheduled).
**Test:** Hit both endpoints, verify data shape matches interfaces.

### Step 4: Odds Layer
Build `lib/odds-converter.ts` — decimal odds to normalised probability.
Build `lib/elo.ts` — fallback probability estimation from standings.
Build `lib/odds-api.ts` — the-odds-api.com client, fixture matching logic.
Build `app/api/odds/route.ts` — returns probabilities, merges odds API + Elo fallback.
**Test:** Verify probabilities sum to 1.0 for each fixture, Elo fallback activates for fixtures without odds.

### Step 5: Monte Carlo Engine
Build `lib/montecarlo.ts` — core simulation loop with Poisson goal sampling.
**Test:** Run 10,000 sims with current data. Arsenal should finish 1st ~70%+ of the time. Wolves should be relegated ~90%+. If these sanity checks fail, the engine has bugs.

### Step 6: Sensitivity Scanner
Build `lib/sensitivity.ts` — fixture locking + delta measurement.
**Test:** The highest-leverage fixtures should intuitively make sense — direct clashes between European rivals, Newcastle's own matches against teams near them in the table.

### Step 7: UI — Core Dashboard
Build all components from the layout spec above.
Wire up Refresh → API calls → simulation → display pipeline.
**Test:** Full user flow works end-to-end with real data.

### Step 8: Insight Engine
Build `app/api/insights/route.ts` — OpenRouter integration with targeted research.
Build `InsightCards.tsx` component.
**Test:** Insights reference actual high-leverage fixtures and contain specific, verifiable football claims.

### Step 9: Polish + Deploy
- Loading states and error handling for all API calls
- Mobile responsiveness
- Caching headers on API routes
- Deploy to Vercel
- Verify Odds API budget usage

---

## Important Notes

### European Places (2025-26 Season)
Standard EPL allocation (subject to change based on cup results):
- **1st-4th:** Champions League group stage
- **5th:** Champions League (expanded format) OR Europa League depending on coefficient
- **6th:** Europa League
- **7th:** Conference League
- Domestic cup winners may take a European slot, pushing league places down

For V1, treat top 7 as "any Europe" and note the cup-winner caveat in methodology.

### Data Freshness
- Standings: Cache 5 minutes
- Fixtures: Cache 15 minutes
- Odds: Cache 1 hour (odds don't change that fast for matches >24h away)
- Insights: Cache structural insights 24h, refresh inflection points per session

### Performance Budget
- Tier 1 simulation: < 300ms
- Tier 2 sensitivity: < 800ms
- Total client-side computation: < 1.5 seconds
- Insight generation: < 10 seconds (acceptable for a "generating insights..." loading state)

### Cost Budget
- football-data.org: Free (10 req/min limit)
- the-odds-api.com: Free (500 req/month — aim for <100 used)
- OpenRouter: ~$0.01-0.05 per insight generation (depends on model + search volume)
- Vercel: Free tier
