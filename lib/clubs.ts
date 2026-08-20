/**
 * The twenty Premier League clubs for the current season, and every name any
 * data source calls them by.
 *
 * WHY THIS FILE EXISTS
 *
 * Six separate maps used to encode the same twenty clubs, one per data source:
 * TEAM_NAME_MAP and ODDS_API_NAME_MAP in constants.ts, TEAM_COLOURS in
 * team-colours.ts, CLUB_TO_ABBR in what-if/fifa-data.ts, ESPN_TEAM_MAP in
 * espn.ts, and CLUB_ABBR_MAP in the Python injury scraper. Promotion and
 * relegation changes three clubs every summer, so every August all six had to be
 * edited consistently — and a club missed in any one of them did not error. It
 * silently lost that source's data: no bookmaker odds, no colour, no injuries.
 *
 * Two of the six are now gone rather than derived: TEAM_NAME_MAP and
 * ODDS_API_NAME_MAP existed only to translate one provider's spelling, which
 * `abbrFor` does for every provider at once. TEAM_COLOURS, CLUB_TO_ABBR and
 * ESPN_TEAM_MAP keep their names and shapes — call sites are unchanged — but are
 * generated from CLUBS below. The Python scraper's map stays hand-written
 * because it runs in a different language; it is the one copy left to sync.
 *
 * Worse, a club missing here at all means live-data.ts cannot attach fixture
 * probabilities, and every simulation engine then defaults it to 40/25/35 — so
 * all 38 of its matches get simulated as if the opponent were irrelevant. That
 * failure produces wrong numbers rather than no numbers, which is the hardest
 * kind to notice. See `abbrFor` and the throw in paired-scan.ts.
 *
 * So: one list, twenty entries, and the maps derived from it. Next August is a
 * single edit to this file.
 *
 * ON ABBREVIATIONS
 *
 * `abbr` is Keepwatch's own canonical three-letter code, and it is NOT any
 * source's abbreviation. Every provider disagrees, in different places:
 *
 *   club                 Keepwatch   football-data   ESPN
 *   Brighton             BRI         BHA             BHA
 *   Chelsea              CFC         CHE             CHE
 *   Liverpool            LFC         LIV             LIV
 *   Nottingham Forest    NFO         NOT             NFO
 *   Manchester City      MCI         MCI             MNC
 *   Manchester United    MUN         MUN             MAN
 *
 * Never treat a provider's code as the canonical one. Kalshi is the exception
 * that needs no map at all: its market tickers (KXPREMIERLEAGUE-27-TOT) already
 * use exactly these codes.
 *
 * GENERATED 2026-08-20 from live sources, not from memory:
 *   abbr / footballDataName / footballDataTla
 *     GET api.football-data.org/v4/competitions/PL/standings
 *   aliases
 *     GET api.the-odds-api.com/v4/sports/soccer_epl/odds (h2h, 20 clubs seen)
 *     GET site.api.espn.com/apis/site/v2/sports/soccer/eng.1/teams
 *     plus the spellings the previous six maps had accumulated
 */

export interface Club {
  /** Keepwatch's canonical code. The key everything else is derived from. */
  abbr: string;
  /** Short display name used in the UI. */
  name: string;
  /** Exact `name` returned by api.football-data.org. */
  footballDataName: string;
  /** football-data's own `tla`. Differs from `abbr` for four clubs — see above. */
  footballDataTla: string;
  /**
   * Every other spelling seen in the wild, from any source. Shared rather than
   * held per-source because the-odds-api, ESPN and the FC-dataset all use
   * "common short name" and their spellings overlap almost entirely; keeping
   * three near-identical lists is what caused the drift in the first place.
   */
  aliases: string[];
  /** Primary kit colour, for charts and the table. */
  colour: string;
}

export const CLUBS: Club[] = [
  { abbr: 'ARS', name: 'Arsenal',        footballDataName: 'Arsenal FC',                    footballDataTla: 'ARS', colour: '#EF0107', aliases: ['Arsenal'] },
  { abbr: 'AVL', name: 'Aston Villa',    footballDataName: 'Aston Villa FC',                footballDataTla: 'AVL', colour: '#670E36', aliases: ['Aston Villa'] },
  { abbr: 'BOU', name: 'Bournemouth',    footballDataName: 'AFC Bournemouth',               footballDataTla: 'BOU', colour: '#DA291C', aliases: ['AFC Bournemouth', 'Bournemouth'] },
  { abbr: 'BRE', name: 'Brentford',      footballDataName: 'Brentford FC',                  footballDataTla: 'BRE', colour: '#e30613', aliases: ['Brentford'] },
  { abbr: 'BRI', name: 'Brighton',       footballDataName: 'Brighton & Hove Albion FC',     footballDataTla: 'BHA', colour: '#0057B8', aliases: ['Brighton', 'Brighton & Hove Albion', 'Brighton and Hove Albion'] },
  { abbr: 'CFC', name: 'Chelsea',        footballDataName: 'Chelsea FC',                    footballDataTla: 'CHE', colour: '#034694', aliases: ['Chelsea'] },
  { abbr: 'COV', name: 'Coventry',       footballDataName: 'Coventry City FC',              footballDataTla: 'COV', colour: '#78D0F3', aliases: ['Coventry', 'Coventry City'] },
  { abbr: 'CRY', name: 'Crystal Palace', footballDataName: 'Crystal Palace FC',             footballDataTla: 'CRY', colour: '#1B458F', aliases: ['C Palace', 'Crystal Palace'] },
  { abbr: 'EVE', name: 'Everton',        footballDataName: 'Everton FC',                    footballDataTla: 'EVE', colour: '#003399', aliases: ['Everton'] },
  { abbr: 'FUL', name: 'Fulham',         footballDataName: 'Fulham FC',                     footballDataTla: 'FUL', colour: '#CC0000', aliases: ['Fulham', 'Fulham FC'] },
  { abbr: 'HUL', name: 'Hull City',      footballDataName: 'Hull City AFC',                 footballDataTla: 'HUL', colour: '#F18A00', aliases: ['Hull', 'Hull City', 'Hull City AFC'] },
  { abbr: 'IPS', name: 'Ipswich',        footballDataName: 'Ipswich Town FC',               footballDataTla: 'IPS', colour: '#3A64A3', aliases: ['Ipswich', 'Ipswich Town'] },
  { abbr: 'LEE', name: 'Leeds',          footballDataName: 'Leeds United FC',               footballDataTla: 'LEE', colour: '#FFCD00', aliases: ['Leeds', 'Leeds United'] },
  { abbr: 'LFC', name: 'Liverpool',      footballDataName: 'Liverpool FC',                  footballDataTla: 'LIV', colour: '#C8102E', aliases: ['Liverpool'] },
  { abbr: 'MCI', name: 'Man City',       footballDataName: 'Manchester City FC',            footballDataTla: 'MCI', colour: '#6CABDD', aliases: ['Man City', 'Manchester City'] },
  { abbr: 'MUN', name: 'Man United',     footballDataName: 'Manchester United FC',          footballDataTla: 'MUN', colour: '#DA291C', aliases: ['Man United', 'Man Utd', 'Manchester United'] },
  { abbr: 'NEW', name: 'Newcastle',      footballDataName: 'Newcastle United FC',           footballDataTla: 'NEW', colour: '#00aaaa', aliases: ['Newcastle', 'Newcastle United'] },
  { abbr: 'NFO', name: "Nott'm Forest",  footballDataName: 'Nottingham Forest FC',          footballDataTla: 'NOT', colour: '#DD0000', aliases: ["Nott'm Forest", 'Nottingham Forest', 'Nottm Forest'] },
  { abbr: 'SUN', name: 'Sunderland',     footballDataName: 'Sunderland AFC',                footballDataTla: 'SUN', colour: '#EB172B', aliases: ['Sunderland', 'Sunderland AFC'] },
  { abbr: 'TOT', name: 'Tottenham',      footballDataName: 'Tottenham Hotspur FC',          footballDataTla: 'TOT', colour: '#132257', aliases: ['Spurs', 'Tottenham', 'Tottenham Hotspur'] },
];

/**
 * Colours for the three promoted clubs are hand-entered — no API serves them.
 * Coventry sky blue, Hull amber, Ipswich blue. Everything else carries over from
 * the previous TEAM_COLOURS table.
 */

export const CLUB_ABBRS: string[] = CLUBS.map((c) => c.abbr);

const BY_ABBR = new Map(CLUBS.map((c) => [c.abbr, c]));

/**
 * Every name that resolves to a club, lowercased for tolerant matching.
 *
 * `footballDataTla` is included deliberately. If football-data ever renames a
 * club, the name lookup misses and the old code fell back to the provider's own
 * tla — so Brighton would silently become 'BHA'. That abbreviation is internally
 * consistent across standings and fixtures, so nothing breaks visibly; it just
 * misses the priors table, the colour map and the odds map, and Brighton gets
 * simulated with a promoted club's rating. Indexing the tla means the fallback
 * lands on the right club instead.
 */
const BY_NAME = new Map<string, string>();
for (const club of CLUBS) {
  for (const key of [
    club.abbr,
    club.name,
    club.footballDataName,
    club.footballDataTla,
    ...club.aliases,
  ]) {
    BY_NAME.set(key.toLowerCase(), club.abbr);
  }
}

export function clubByAbbr(abbr: string): Club | undefined {
  return BY_ABBR.get(abbr);
}

/**
 * Resolve any club name from any source to a canonical abbreviation.
 *
 * Returns undefined rather than guessing. Callers must treat that as a mapping
 * failure worth logging: silently falling back to a provider's own abbreviation
 * is how a promoted club ends up with no odds and no colour, and silently
 * dropping the fixture is how it ends up simulated at 40/25/35.
 */
export function abbrFor(name: string | undefined | null): string | undefined {
  if (!name) return undefined;
  return BY_NAME.get(name.trim().toLowerCase());
}
