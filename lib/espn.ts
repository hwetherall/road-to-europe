import { Fixture } from '@/lib/types';

// ── Public Types ──

export interface ESPNGoal {
  scorer: string;
  assist: string | null;
  minute: string;
  team: 'home' | 'away';
  isPenalty: boolean;
  isOwnGoal: boolean;
  description: string;
}

export interface ESPNCard {
  player: string;
  type: 'yellow' | 'red';
  minute: string;
  team: 'home' | 'away';
}

export interface ESPNMatchDetail {
  espnId: string;
  date: string;
  homeTeam: string;
  awayTeam: string;
  homeTeamFull: string;
  awayTeamFull: string;
  homeScore: number;
  awayScore: number;
  status: string;
  completed: boolean;
  goals: ESPNGoal[];
  cards: ESPNCard[];
}

export interface ScoreReconciliation {
  matched: number;
  mismatched: string[];
  missingFromESPN: string[];
}

// ── Raw ESPN Shape (only the fields we read) ──

interface RawESPNCompetitor {
  homeAway: 'home' | 'away';
  score: string;
  team: { displayName: string; abbreviation: string };
}

interface RawESPNDetail {
  type?: { text?: string };
  description?: string;
  team?: { abbreviation?: string };
  clock?: { displayValue?: string };
}

interface RawESPNCompetition {
  competitors: RawESPNCompetitor[];
  details?: RawESPNDetail[];
}

interface RawESPNEvent {
  id: string;
  date: string;
  name: string;
  status: { type: { detail: string; completed: boolean } };
  competitions: RawESPNCompetition[];
}

// ── Team Mapping ──
//
// Built from TEAM_NAME_MAP / ODDS_API_NAME_MAP in lib/constants.ts, verified
// against actual ESPN scoreboard responses. Unmatched display names log a
// warning at parse time rather than silently defaulting.

const ESPN_TEAM_MAP: Record<string, string> = {
  Arsenal: 'ARS',
  'Aston Villa': 'AVL',
  Bournemouth: 'BOU',
  'AFC Bournemouth': 'BOU',
  Brentford: 'BRE',
  Brighton: 'BRI',
  'Brighton & Hove Albion': 'BRI',
  'Brighton and Hove Albion': 'BRI',
  Burnley: 'BUR',
  Chelsea: 'CFC',
  'Crystal Palace': 'CRY',
  Everton: 'EVE',
  Fulham: 'FUL',
  Leeds: 'LEE',
  'Leeds United': 'LEE',
  Liverpool: 'LFC',
  'Manchester City': 'MCI',
  'Manchester United': 'MUN',
  Newcastle: 'NEW',
  'Newcastle United': 'NEW',
  'Nottingham Forest': 'NFO',
  "Nott'm Forest": 'NFO',
  Sunderland: 'SUN',
  'Sunderland AFC': 'SUN',
  Tottenham: 'TOT',
  'Tottenham Hotspur': 'TOT',
  'West Ham': 'WHU',
  'West Ham United': 'WHU',
  Wolves: 'WOL',
  Wolverhampton: 'WOL',
  'Wolverhampton Wanderers': 'WOL',
};

const unmappedTeamsLogged = new Set<string>();

function mapTeam(displayName: string, fallbackAbbr: string): string {
  const mapped = ESPN_TEAM_MAP[displayName];
  if (mapped) return mapped;

  if (!unmappedTeamsLogged.has(displayName)) {
    unmappedTeamsLogged.add(displayName);
    console.warn(
      `[espn] Unmapped team displayName="${displayName}" (ESPN abbr="${fallbackAbbr}"). Add to ESPN_TEAM_MAP.`
    );
  }
  return fallbackAbbr;
}

// ── Description Parsers ──
//
// ESPN description patterns observed:
//   "M. Salah (Assisted by T. Alexander-Arnold) - 45'"
//   "M. Salah (Penalty) - 67'"
//   "V. van Dijk (Own Goal) - 12'"
//   "B. Saka - 22'"
// The parsers strip parentheticals and the trailing time stamp.

function parseScorer(description: string): string {
  const stripped = description
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/\s*-\s*\d+(\+\d+)?'\s*$/, '')
    .trim();
  return stripped || description.trim();
}

function parseAssist(description: string): string | null {
  const match = description.match(/\(Assisted by ([^)]+)\)/i);
  return match ? match[1].trim() : null;
}

function parsePlayerName(description: string): string {
  return description.replace(/\s*-\s*\d+(\+\d+)?'\s*$/, '').trim();
}

function detectPenalty(description: string): boolean {
  return /\(Penalty\)/i.test(description) || /\bPenalty Kick\b/i.test(description);
}

function detectOwnGoal(description: string): boolean {
  return /\(Own Goal\)/i.test(description);
}

// ── HTTP ──

const ESPN_SCOREBOARD_URL =
  'https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/scoreboard';

// Browser UA mirroring the PoC in roundup/espn-api.py — public CDN endpoints
// occasionally reject bot-ish UAs, and staying safe is cheap.
const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36';

// Cache horizon:
// 15 minutes is tight enough to see in-progress updates on live matchdays, and
// loose enough that a full roundup run (5-10 minutes) doesn't cache-miss on
// every fixture lookup. Historical matchdays are immutable post-FT, but a
// 15-minute revalidate on an idle endpoint is cheap.
const REVALIDATE_SECONDS = 900;

export async function fetchESPNScoreboard(date?: string): Promise<RawESPNEvent[]> {
  const url = date ? `${ESPN_SCOREBOARD_URL}?dates=${date}` : ESPN_SCOREBOARD_URL;

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': BROWSER_USER_AGENT },
      next: { revalidate: REVALIDATE_SECONDS },
    });

    if (!res.ok) {
      console.warn(`[espn] Scoreboard fetch failed (${res.status}) for ${url}`);
      return [];
    }

    const data = (await res.json()) as { events?: RawESPNEvent[] };
    return data.events ?? [];
  } catch (error) {
    console.warn(
      `[espn] Scoreboard fetch threw for ${url}:`,
      error instanceof Error ? error.message : error
    );
    return [];
  }
}

// ── Parsing ──

export function parseESPNEvent(event: RawESPNEvent): ESPNMatchDetail | null {
  const competition = event.competitions?.[0];
  if (!competition) return null;

  const homeComp = competition.competitors.find((c) => c.homeAway === 'home');
  const awayComp = competition.competitors.find((c) => c.homeAway === 'away');
  if (!homeComp || !awayComp) return null;

  const goals: ESPNGoal[] = [];
  const cards: ESPNCard[] = [];

  for (const detail of competition.details ?? []) {
    const typeText = detail.type?.text ?? '';
    const description = detail.description ?? '';
    const minute = detail.clock?.displayValue ?? '';
    const isHome = detail.team?.abbreviation === homeComp.team.abbreviation;
    const side: 'home' | 'away' = isHome ? 'home' : 'away';

    if (typeText === 'Goal') {
      goals.push({
        scorer: parseScorer(description),
        assist: parseAssist(description),
        minute,
        team: side,
        isPenalty: detectPenalty(description),
        isOwnGoal: detectOwnGoal(description),
        description,
      });
    } else if (typeText === 'Yellow Card' || typeText === 'Red Card') {
      cards.push({
        player: parsePlayerName(description),
        type: typeText === 'Red Card' ? 'red' : 'yellow',
        minute,
        team: side,
      });
    }
  }

  return {
    espnId: event.id,
    date: event.date,
    homeTeam: mapTeam(homeComp.team.displayName, homeComp.team.abbreviation),
    awayTeam: mapTeam(awayComp.team.displayName, awayComp.team.abbreviation),
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

// ── Matchday Aggregation ──

function formatDateYYYYMMDD(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

function datesForMatchday(fixtures: Fixture[], matchday: number): string[] {
  const matchdayFixtures = fixtures.filter((f) => f.matchday === matchday);
  const dateSet = new Set<string>();

  for (const fixture of matchdayFixtures) {
    if (!fixture.date) continue;
    const parsed = new Date(fixture.date);
    if (Number.isNaN(parsed.getTime())) continue;

    // Include ±1 day to cover timezone edge cases between ESPN (US) and
    // football-data.org (UTC) — a Monday-night UK kickoff sits on either side
    // of midnight UTC depending on how each source rounds.
    for (const offsetDays of [-1, 0, 1]) {
      const shifted = new Date(parsed.getTime() + offsetDays * 24 * 60 * 60 * 1000);
      dateSet.add(formatDateYYYYMMDD(shifted));
    }
  }

  return Array.from(dateSet).sort();
}

export async function fetchMatchdayEvents(
  matchday: number,
  fixtures: Fixture[]
): Promise<ESPNMatchDetail[]> {
  const dates = datesForMatchday(fixtures, matchday);
  if (dates.length === 0) {
    console.warn(`[espn] No fixture dates resolved for matchday ${matchday}`);
    return [];
  }

  const rawEvents: RawESPNEvent[] = [];
  for (const date of dates) {
    const events = await fetchESPNScoreboard(date);
    rawEvents.push(...events);
  }

  // Dedupe by ESPN event id (the ±1-day window guarantees overlap).
  const seenIds = new Set<string>();
  const unique = rawEvents.filter((e) => {
    if (seenIds.has(e.id)) return false;
    seenIds.add(e.id);
    return true;
  });

  const parsed = unique
    .map(parseESPNEvent)
    .filter((d): d is ESPNMatchDetail => d !== null);

  // Filter to events matching one of this matchday's fixture team pairs.
  const matchdayPairs = new Set(
    fixtures
      .filter((f) => f.matchday === matchday)
      .map((f) => `${f.homeTeam}-${f.awayTeam}`)
  );

  const filtered = parsed.filter((d) =>
    matchdayPairs.has(`${d.homeTeam}-${d.awayTeam}`)
  );

  return filtered;
}

// ── Reconciliation ──

export function reconcileScores(
  footballDataResults: Array<{
    homeTeam: string;
    awayTeam: string;
    homeGoals: number;
    awayGoals: number;
  }>,
  espnEvents: ESPNMatchDetail[]
): ScoreReconciliation {
  const mismatched: string[] = [];
  const missingFromESPN: string[] = [];
  let matched = 0;

  for (const result of footballDataResults) {
    const espn = espnEvents.find(
      (e) => e.homeTeam === result.homeTeam && e.awayTeam === result.awayTeam
    );

    if (!espn) {
      missingFromESPN.push(`${result.homeTeam} v ${result.awayTeam}`);
      continue;
    }

    if (
      espn.homeScore === result.homeGoals &&
      espn.awayScore === result.awayGoals &&
      espn.completed
    ) {
      matched++;
    } else {
      mismatched.push(
        `${result.homeTeam} v ${result.awayTeam}: FD=${result.homeGoals}-${result.awayGoals}, ESPN=${espn.homeScore}-${espn.awayScore}${
          espn.completed ? '' : ' (ESPN not completed)'
        }`
      );
    }
  }

  return { matched, mismatched, missingFromESPN };
}

// ── Formatting Helper ──
//
// Produces a compact "Salah (45'), Ngumoha (33')" string for the existing
// RoundupMatchResearch.scorers field. Penalty and own-goal tags surface so
// the writing agent can use them in narrative.

export function formatScorersLine(goals: ESPNGoal[]): string {
  if (goals.length === 0) return '';

  const sorted = [...goals].sort((a, b) => minuteToNumber(a.minute) - minuteToNumber(b.minute));
  return sorted
    .map((g) => {
      const tags: string[] = [];
      if (g.isPenalty) tags.push('pen');
      if (g.isOwnGoal) tags.push('OG');
      const tagSuffix = tags.length > 0 ? ` ${tags.join(', ')}` : '';
      const minute = g.minute ? ` ${g.minute}` : '';
      return `${g.scorer}${tagSuffix}${minute}`.trim();
    })
    .join(', ');
}

function minuteToNumber(minute: string): number {
  if (!minute) return 9999;
  const match = minute.match(/(\d+)(?:\+(\d+))?/);
  if (!match) return 9999;
  const base = parseInt(match[1], 10);
  const stoppage = match[2] ? parseInt(match[2], 10) : 0;
  return base + stoppage;
}
