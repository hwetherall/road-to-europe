# CLAUDE-ESPN.md — ESPN Scoreboard API Integration

## Overview

Keepwatch currently uses football-data.org for standings and fixtures (free tier: scores but no goal scorers). The ESPN public scoreboard API provides richer match detail — including goal scorers, assists, minutes, cards, and match status — at no cost and with no API key required.

This integration adds ESPN as a **supplementary data source** for match event detail. Football-data.org remains the primary source for standings, fixtures, and scores (it's structured, keyed by matchday, and already integrated). ESPN fills the gap that football-data.org's free tier leaves: who scored, who assisted, what minute, and key match events.

### What This Delivers
- Goal scorers with minutes and assists for every PL match
- Red/yellow card data
- Match status detail (FT, Half Time, In Play, Postponed)
- A `fetchMatchdayEvents()` function the Roundup can call during Phase R

### What This Does NOT Change
- Football-data.org remains the source of truth for standings, fixtures, and final scores
- The simulation engine continues to use football-data.org data
- ESPN data is used for narrative enrichment only — the Roundup's Rapid Round, Newcastle Deep Dive, and research agent all consume it

---

## The ESPN API

### Endpoint

```
https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/scoreboard
```

This is a public, undocumented API. No API key required. No rate limit published, but it is a public CDN endpoint — be respectful with request frequency.

### Key Parameters

| Parameter | Format | Purpose |
|-----------|--------|---------|
| `dates` | `YYYYMMDD` | Filter to a specific date. Omit for current/latest. |
| `limit` | integer | Max events to return. Default is fine for PL (~10 per matchday). |

**Important:** The API is date-based, not matchday-based. A PL matchday can span Friday through Monday (4 dates). To get a full matchday's results, you need to either:
- Query each date in the matchday's date range, OR
- Query without a date filter (gets the current/recent window) and filter by the events returned

The recommended approach for V1: query a date range covering the matchday weekend (Friday → Monday, 4 calls) and deduplicate.

### Response Structure

The response contains an `events` array. Each event has:

```typescript
// Simplified — only the fields we need
interface ESPNEvent {
  id: string;                              // ESPN event ID
  date: string;                            // ISO date
  name: string;                            // "Arsenal vs Bournemouth"
  status: {
    type: {
      detail: string;                      // "FT", "HT", "45'", "Postponed"
      completed: boolean;
    };
  };
  competitions: [{
    competitors: [{
      homeAway: 'home' | 'away';
      score: string;                       // "2"
      team: {
        displayName: string;               // "Arsenal"
        abbreviation: string;              // "ARS"
      };
    }];
    details: [{                            // Goals, cards, subs
      type: {
        text: string;                      // "Goal", "Yellow Card", "Red Card", etc.
      };
      description: string;                 // "M. Salah (Assisted by T. Alexander-Arnold) - 45'"
      team: {
        abbreviation: string;              // which team the event belongs to
      };
      clock: {
        displayValue: string;              // "45'"
      };
    }];
  }];
}
```

### What We Extract

For each match event, extract:

```typescript
interface ESPNMatchDetail {
  espnId: string;
  date: string;
  homeTeam: string;                        // ESPN abbreviation
  awayTeam: string;                        // ESPN abbreviation
  homeTeamFull: string;                    // Display name for matching
  awayTeamFull: string;
  homeScore: number;
  awayScore: number;
  status: string;                          // "FT", "HT", etc.
  completed: boolean;
  goals: ESPNGoal[];
  cards: ESPNCard[];
}

interface ESPNGoal {
  scorer: string;                          // Parsed from description
  assist: string | null;                   // Parsed from description
  minute: string;                          // "45'", "90+3'"
  team: 'home' | 'away';
  description: string;                     // Raw ESPN description
}

interface ESPNCard {
  player: string;
  type: 'yellow' | 'red';
  minute: string;
  team: 'home' | 'away';
}
```

---

## Implementation

### New File: `lib/espn.ts`

This is a self-contained module. No dependencies on the existing data layer except for the team name mapping.

```typescript
// lib/espn.ts

// ── ESPN team name → Keepwatch abbreviation mapping ──
// ESPN uses its own team abbreviations and display names.
// This map converts ESPN display names to the abbreviations
// used throughout Keepwatch (matching TEAM_NAME_MAP in constants.ts).
//
// Build this by fetching one scoreboard response and mapping each
// team's displayName to the corresponding Keepwatch abbr.

const ESPN_TEAM_MAP: Record<string, string> = {
  'Arsenal': 'ARS',
  'Aston Villa': 'AVL',
  'Bournemouth': 'BOU',
  'Brentford': 'BRE',
  'Brighton & Hove Albion': 'BHA',
  'Burnley': 'BUR',
  'Chelsea': 'CHE',
  'Crystal Palace': 'CRY',
  'Everton': 'EVE',
  'Fulham': 'FUL',
  'Leeds United': 'LEE',
  'Leicester City': 'LEI',
  'Liverpool': 'LIV',
  'Manchester City': 'MCI',
  'Manchester United': 'MUN',
  'Newcastle United': 'NEW',
  'Nottingham Forest': 'NFO',
  'Sheffield United': 'SHU',
  'Sunderland': 'SUN',
  'Tottenham Hotspur': 'TOT',
  'West Ham United': 'WHU',
  'Wolverhampton Wanderers': 'WOL',
  // Add promoted clubs as needed for 2025-26 season
  // Verify these against actual ESPN responses
};
```

**CRITICAL: Verify this map.** Before relying on it, fetch one real scoreboard response and confirm every team's `displayName` matches a key in this map. ESPN may use slightly different names than expected (e.g., "Wolverhampton Wanderers" vs "Wolves"). Log any unmatched teams as warnings.

### Core Functions

#### `fetchESPNScoreboard(date?: string): Promise<ESPNEvent[]>`

Fetches the scoreboard for a given date (or current if omitted).

```typescript
export async function fetchESPNScoreboard(
  date?: string  // YYYYMMDD format
): Promise<ESPNEvent[]> {
  const baseUrl = 'https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/scoreboard';
  const url = date ? `${baseUrl}?dates=${date}` : baseUrl;

  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Keepwatch/1.0 (EPL Season Simulator)',
    },
    // Cache for 15 minutes — match events don't change after FT
    next: { revalidate: 900 },
  });

  if (!res.ok) {
    console.warn(`[espn] Scoreboard fetch failed: ${res.status}`);
    return [];
  }

  const data = await res.json();
  return data.events ?? [];
}
```

#### `parseESPNEvent(event: ESPNEvent): ESPNMatchDetail`

Parses a single ESPN event into our structured format.

```typescript
export function parseESPNEvent(event: ESPNEvent): ESPNMatchDetail {
  const competition = event.competitions[0];
  const homeComp = competition.competitors.find(c => c.homeAway === 'home')!;
  const awayComp = competition.competitors.find(c => c.homeAway === 'away')!;

  const goals: ESPNGoal[] = [];
  const cards: ESPNCard[] = [];

  for (const detail of competition.details ?? []) {
    const typeText = detail.type?.text ?? '';
    const isHome = detail.team?.abbreviation === homeComp.team.abbreviation;
    const side: 'home' | 'away' = isHome ? 'home' : 'away';

    if (typeText === 'Goal') {
      goals.push({
        scorer: parseScorer(detail.description),
        assist: parseAssist(detail.description),
        minute: detail.clock?.displayValue ?? '',
        team: side,
        description: detail.description ?? '',
      });
    } else if (typeText === 'Yellow Card' || typeText === 'Red Card') {
      cards.push({
        player: parsePlayerName(detail.description),
        type: typeText === 'Red Card' ? 'red' : 'yellow',
        minute: detail.clock?.displayValue ?? '',
        team: side,
      });
    }
  }

  return {
    espnId: event.id,
    date: event.date,
    homeTeam: ESPN_TEAM_MAP[homeComp.team.displayName] ?? homeComp.team.abbreviation,
    awayTeam: ESPN_TEAM_MAP[awayComp.team.displayName] ?? awayComp.team.abbreviation,
    homeTeamFull: homeComp.team.displayName,
    awayTeamFull: awayComp.team.displayName,
    homeScore: parseInt(homeComp.score, 10) || 0,
    awayScore: parseInt(awayComp.score, 10) || 0,
    status: event.status.type.detail,
    completed: event.status.type.completed,
    goals,
    cards,
  };
}
```

#### Description Parsers

ESPN goal descriptions follow the pattern: `"M. Salah (Assisted by T. Alexander-Arnold) - 45'"`

```typescript
function parseScorer(description: string): string {
  // Everything before the first " (" or " -"
  const match = description.match(/^([^(-]+)/);
  return match ? match[1].trim() : description;
}

function parseAssist(description: string): string | null {
  const match = description.match(/\(Assisted by ([^)]+)\)/i);
  return match ? match[1].trim() : null;
}

function parsePlayerName(description: string): string {
  // For cards, the description is typically just the player name
  // or "Player Name - 67'"
  const match = description.match(/^([^-]+)/);
  return match ? match[1].trim() : description;
}
```

**NOTE:** These parsers are built from observed ESPN description patterns. They may not cover every edge case (own goals, penalties, etc.). Add handling as needed:
- Own goals: Description may include "(Own Goal)" — check for this and flag accordingly
- Penalties: Description may include "(Penalty)" — parse and tag

#### `fetchMatchdayEvents(matchday: number): Promise<ESPNMatchDetail[]>`

The main function the Roundup calls. Takes a matchday number, determines the date range, fetches all events, and filters to the correct matchday.

```typescript
export async function fetchMatchdayEvents(
  matchday: number,
  fixtures: Fixture[]  // from football-data.org, used to determine date range
): Promise<ESPNMatchDetail[]> {
  // 1. Find the date range for this matchday from football-data.org fixtures
  const matchdayFixtures = fixtures.filter(f => f.matchday === matchday);
  if (matchdayFixtures.length === 0) {
    console.warn(`[espn] No fixtures found for matchday ${matchday}`);
    return [];
  }

  // Get unique dates (YYYYMMDD) spanning the matchday
  const dates = new Set<string>();
  for (const fixture of matchdayFixtures) {
    if (fixture.date) {
      const d = new Date(fixture.date);
      dates.add(formatDateYYYYMMDD(d));
    }
  }

  // 2. Fetch ESPN scoreboard for each date
  const allEvents: ESPNEvent[] = [];
  for (const date of dates) {
    const events = await fetchESPNScoreboard(date);
    allEvents.push(...events);
  }

  // 3. Deduplicate by ESPN event ID
  const seen = new Set<string>();
  const unique = allEvents.filter(e => {
    if (seen.has(e.id)) return false;
    seen.add(e.id);
    return true;
  });

  // 4. Parse and match to Keepwatch fixtures
  const parsed = unique.map(parseESPNEvent);

  // 5. Filter to only events that match our matchday fixtures
  // Match by team abbreviations (after mapping through ESPN_TEAM_MAP)
  const matchdayTeamPairs = new Set(
    matchdayFixtures.map(f => `${f.homeTeam}-${f.awayTeam}`)
  );

  return parsed.filter(event =>
    matchdayTeamPairs.has(`${event.homeTeam}-${event.awayTeam}`)
  );
}

function formatDateYYYYMMDD(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}
```

---

## Integration with the Roundup

### Where ESPN Data Enters the Pipeline

In `lib/weekly-roundup/dossier.ts`, the `buildRoundupDossier()` function should call `fetchMatchdayEvents()` during Phase R and attach the results to the dossier:

```typescript
// In buildRoundupDossier(), after fetching results from football-data.org:

import { fetchMatchdayEvents, ESPNMatchDetail } from '@/lib/espn';

// ... existing code that fetches results and runs post-round sim ...

// Fetch ESPN event detail for narrative enrichment
const espnEvents = await fetchMatchdayEvents(matchday, fixtures);

// Attach to dossier
const dossier: RoundupDossier = {
  // ... existing fields ...
  espnEvents,  // ESPNMatchDetail[] — used by writing agents for scorers/cards
};
```

### Add to RoundupDossier Type

In `lib/weekly-roundup/types.ts`:

```typescript
import { ESPNMatchDetail } from '@/lib/espn';

export interface RoundupDossier {
  // ... existing fields ...
  espnEvents: ESPNMatchDetail[];
}
```

### How the Writing Agent Uses It

The section prompts should include ESPN data formatted as a reference block. In `lib/weekly-roundup/prompts.ts`, when building the user prompt for any section that needs match detail:

```typescript
function formatESPNForPrompt(events: ESPNMatchDetail[]): string {
  return events.map(e => {
    const goalLines = e.goals.map(g => 
      `  ${g.team === 'home' ? '⚽ (H)' : '⚽ (A)'} ${g.scorer}${g.assist ? ` (assist: ${g.assist})` : ''} ${g.minute}`
    ).join('\n');
    
    const cardLines = e.cards
      .filter(c => c.type === 'red')  // Only include reds — yellows are noise
      .map(c => `  🟥 ${c.player} ${c.minute}`)
      .join('\n');

    return `${e.homeTeamFull} ${e.homeScore}-${e.awayScore} ${e.awayTeamFull} (${e.status})
${goalLines}${cardLines ? '\n' + cardLines : ''}`;
  }).join('\n---\n');
}
```

This gives the writing agent structured scorer data it can weave into narrative without needing to extract it from search results.

---

## Score Reconciliation

Football-data.org and ESPN should agree on final scores. If they don't, something is wrong with team matching. Add a validation step:

```typescript
function reconcileScores(
  footballDataResults: MatchResult[],
  espnEvents: ESPNMatchDetail[]
): { matched: number; mismatched: string[] } {
  const mismatched: string[] = [];
  let matched = 0;

  for (const result of footballDataResults) {
    const espn = espnEvents.find(
      e => e.homeTeam === result.homeTeam && e.awayTeam === result.awayTeam
    );

    if (!espn) continue;

    if (espn.homeScore === result.homeGoals && espn.awayScore === result.awayGoals) {
      matched++;
    } else {
      mismatched.push(
        `${result.homeTeam} v ${result.awayTeam}: ` +
        `FD=${result.homeGoals}-${result.awayGoals}, ` +
        `ESPN=${espn.homeScore}-${espn.awayScore}`
      );
    }
  }

  return { matched, mismatched };
}
```

Log mismatches as warnings in the dossier. If any mismatch occurs, trust football-data.org for scores (it's the existing source of truth) and use ESPN only for event detail (scorers, cards).

---

## Environment Variables

None required. The ESPN API is public and keyless.

Add to `.env.example` as documentation:

```env
# ESPN Scoreboard API — no key required
# Used for goal scorers, assists, cards (narrative enrichment)
# Endpoint: https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/scoreboard
```

---

## Risks and Mitigations

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| ESPN changes API structure | Medium (it's undocumented) | `parseESPNEvent` is isolated — if it breaks, the Roundup degrades gracefully (no scorers, but scores still from football-data.org) |
| ESPN team names don't match Keepwatch abbreviations | High on first run | `ESPN_TEAM_MAP` must be verified against a real response. Log unmatched teams. |
| ESPN description format varies (own goals, penalties, extra time) | Medium | Parsers handle common patterns. Add edge cases as discovered. |
| Rate limiting on the public endpoint | Low | We make 4 requests per matchday (one per date). Well within reasonable use. |
| ESPN doesn't have `details` for some matches | Low but possible | Check for empty `details` array. Fall back to "scorers not available" in narrative. |

---

## Testing

### Manual Test (Run Before Integration)

1. Fetch a recent completed matchday: call `fetchESPNScoreboard('20260412')` (or whatever date Matchday 32 fell on)
2. Verify every PL match appears in the response
3. Check that `details` contains goals with descriptions
4. Confirm team display names match `ESPN_TEAM_MAP` keys
5. Parse all events and verify scorer extraction against known results

### Automated Checks

- `reconcileScores()` should return 0 mismatches for any completed matchday
- Every fixture in football-data.org should have a corresponding ESPN event (log warnings if not)
- Goal count per match should equal the sum of home + away scores (sanity check on extraction)

---

## Summary

| Aspect | Detail |
|--------|--------|
| New file | `lib/espn.ts` |
| Modified files | `lib/weekly-roundup/types.ts` (add espnEvents), `lib/weekly-roundup/dossier.ts` (call fetchMatchdayEvents), `lib/weekly-roundup/prompts.ts` (format ESPN data for writing agents) |
| API key required | No |
| Dependency on existing code | `Fixture` type from `lib/types.ts`, team abbreviation constants |
| Fallback if ESPN unavailable | Roundup generates without scorer detail. Scores still from football-data.org. Research agent can fill some gaps from match reports. |
| Estimated implementation time | 2-3 hours |
