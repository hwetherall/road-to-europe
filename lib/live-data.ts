import { Fixture, Team } from '@/lib/types';
import {
  HARDCODED_STANDINGS,
  KNOWN_FIXTURES,
  ODDS_API_NAME_MAP,
  TEAM_NAME_MAP,
} from '@/lib/constants';
import { averageBookmakerOdds } from '@/lib/odds-converter';
import { generateRemainingFixtures } from '@/lib/fixture-generator';
import { teamElo, eloProb } from '@/lib/elo';

interface FootballDataMatchTeam {
  name: string;
  shortName?: string;
  tla: string;
}

interface FootballDataMatch {
  id?: string | number;
  homeTeam: FootballDataMatchTeam;
  awayTeam: FootballDataMatchTeam;
  score?: {
    fullTime?: {
      home?: number | null;
      away?: number | null;
    };
  };
  status: string;
  matchday: number;
  utcDate: string;
}

interface FootballDataStandingsResponse {
  standings?: Array<{
    table?: Array<{
      team: FootballDataMatchTeam;
      points: number;
      goalDifference: number;
      goalsFor: number;
      goalsAgainst: number;
      playedGames: number;
      won: number;
      draw: number;
      lost: number;
    }>;
  }>;
}

interface OddsApiOutcome {
  name: string;
  price: number;
}

interface OddsApiMarket {
  key: string;
  outcomes: OddsApiOutcome[];
}

interface OddsApiBookmaker {
  markets: OddsApiMarket[];
}

interface OddsApiEvent {
  home_team: string;
  away_team: string;
  commence_time: string;
  bookmakers: OddsApiBookmaker[];
}

export interface OddsEntry {
  homeTeam: string;
  awayTeam: string;
  date: string;
  homeWin: number;
  draw: number;
  awayWin: number;
}

export interface DataSourceResult<T> {
  data: T;
  source: 'live' | 'hardcoded' | 'error' | 'none';
}

export interface LiveSnapshot {
  teams: Team[];
  fixtures: Fixture[];
  standingsSource: string;
  fixturesSource: string;
  oddsSource: string;
  oddsCoverage: {
    matchedFixtures: number;
    totalScheduledFixtures: number;
    nextRoundMatchedFixtures: number;
    nextRoundScheduledFixtures: number;
  };
}

function parseMatch(match: FootballDataMatch, index: number): Fixture {
  const score = match.score?.fullTime;
  return {
    id: String(match.id ?? index),
    homeTeam: TEAM_NAME_MAP[match.homeTeam.name] || match.homeTeam.tla,
    awayTeam: TEAM_NAME_MAP[match.awayTeam.name] || match.awayTeam.tla,
    matchday: match.matchday,
    date: match.utcDate,
    status: match.status === 'FINISHED' ? 'FINISHED' : 'SCHEDULED',
    homeScore: score?.home ?? undefined,
    awayScore: score?.away ?? undefined,
    probSource: 'elo_estimated',
  };
}

export async function getStandingsData(): Promise<DataSourceResult<Team[]>> {
  const apiKey = process.env.FOOTBALL_DATA_API_KEY;

  if (apiKey) {
    try {
      const res = await fetch('https://api.football-data.org/v4/competitions/PL/standings', {
        headers: { 'X-Auth-Token': apiKey },
        next: { revalidate: 300 },
      });

      if (res.ok) {
        const data = (await res.json()) as FootballDataStandingsResponse;
        const table = data.standings?.[0]?.table;
        if (table && table.length > 0) {
          return {
            data: table.map((entry, index) => ({
              id: String(index + 1),
              name: entry.team.shortName || entry.team.name,
              abbr: TEAM_NAME_MAP[entry.team.name] || entry.team.tla,
              points: entry.points,
              goalDifference: entry.goalDifference,
              goalsFor: entry.goalsFor,
              goalsAgainst: entry.goalsAgainst,
              played: entry.playedGames,
              won: entry.won,
              drawn: entry.draw,
              lost: entry.lost,
            })),
            source: 'live',
          };
        }
      }
    } catch {
      // fall through
    }
  }

  return { data: HARDCODED_STANDINGS, source: 'hardcoded' };
}

export async function getFixturesData(): Promise<DataSourceResult<Fixture[]>> {
  const apiKey = process.env.FOOTBALL_DATA_API_KEY;

  if (apiKey) {
    try {
      const [finishedRes, scheduledRes] = await Promise.all([
        fetch('https://api.football-data.org/v4/competitions/PL/matches?status=FINISHED', {
          headers: { 'X-Auth-Token': apiKey },
          next: { revalidate: 900 },
        }),
        fetch('https://api.football-data.org/v4/competitions/PL/matches?status=SCHEDULED', {
          headers: { 'X-Auth-Token': apiKey },
          next: { revalidate: 900 },
        }),
      ]);

      const fixtures: Fixture[] = [];

      if (finishedRes.ok) {
        const data = (await finishedRes.json()) as { matches?: FootballDataMatch[] };
        if (data.matches?.length) fixtures.push(...data.matches.map(parseMatch));
      }

      if (scheduledRes.ok) {
        const data = (await scheduledRes.json()) as { matches?: FootballDataMatch[] };
        if (data.matches?.length) fixtures.push(...data.matches.map(parseMatch));
      }

      if (fixtures.length > 0) {
        return { data: fixtures, source: 'live' };
      }
    } catch {
      // fall through
    }
  }

  return { data: KNOWN_FIXTURES, source: 'hardcoded' };
}

export async function getOddsData(): Promise<DataSourceResult<OddsEntry[]>> {
  const apiKey = process.env.ODDS_API_KEY;
  if (!apiKey) return { data: [], source: 'none' };

  try {
    const res = await fetch(
      `https://api.the-odds-api.com/v4/sports/soccer_epl/odds/?apiKey=${apiKey}&regions=uk&markets=h2h&oddsFormat=decimal`,
      { next: { revalidate: 3600 } }
    );

    if (!res.ok) return { data: [], source: 'error' };

    const events = (await res.json()) as OddsApiEvent[];

    const odds = events.map((event) => {
      const bookmakerOdds = event.bookmakers
        .map((bookmaker) => {
          const h2h = bookmaker.markets.find((market) => market.key === 'h2h');
          if (!h2h) return null;

          const home = h2h.outcomes.find((outcome) => outcome.name === event.home_team);
          const away = h2h.outcomes.find((outcome) => outcome.name === event.away_team);
          const draw = h2h.outcomes.find((outcome) => outcome.name === 'Draw');
          if (!home || !away || !draw) return null;

          return {
            homeOdds: home.price,
            drawOdds: draw.price,
            awayOdds: away.price,
          };
        })
        .filter(
          (
            value
          ): value is { homeOdds: number; drawOdds: number; awayOdds: number } => value !== null
        );

      const avgProb = averageBookmakerOdds(bookmakerOdds);
      return {
        homeTeam: event.home_team,
        awayTeam: event.away_team,
        date: event.commence_time,
        ...(avgProb || { homeWin: 0.4, draw: 0.3, awayWin: 0.3 }),
      };
    });

    return { data: odds, source: 'live' };
  } catch {
    return { data: [], source: 'error' };
  }
}

export async function getLiveSnapshot(): Promise<LiveSnapshot> {
  const [standingsResult, fixturesResult, oddsResult] = await Promise.all([
    getStandingsData(),
    getFixturesData(),
    getOddsData(),
  ]);

  const teams = standingsResult.data;
  const oddsLookup = new Map<string, OddsEntry>();

  for (const entry of oddsResult.data) {
    const homeAbbr = ODDS_API_NAME_MAP[entry.homeTeam];
    const awayAbbr = ODDS_API_NAME_MAP[entry.awayTeam];
    if (homeAbbr && awayAbbr) {
      oddsLookup.set(`${homeAbbr}-${awayAbbr}`, entry);
    }
  }

  const knownFixtures = fixturesResult.data.map((fixture) => {
    if (fixture.status === 'FINISHED') return fixture;

    const liveOdds = oddsLookup.get(`${fixture.homeTeam}-${fixture.awayTeam}`);
    if (liveOdds && liveOdds.homeWin > 0) {
      return {
        ...fixture,
        homeWinProb: liveOdds.homeWin,
        drawProb: liveOdds.draw,
        awayWinProb: liveOdds.awayWin,
        probSource: 'odds_api' as const,
      };
    }

    if (
      fixture.homeWinProb !== undefined &&
      fixture.drawProb !== undefined &&
      fixture.awayWinProb !== undefined
    ) {
      return fixture;
    }

    const homeTeam = teams.find((team) => team.abbr === fixture.homeTeam);
    const awayTeam = teams.find((team) => team.abbr === fixture.awayTeam);
    if (!homeTeam || !awayTeam) return fixture;

    const probs = eloProb(teamElo(homeTeam), teamElo(awayTeam));
    return {
      ...fixture,
      homeWinProb: probs.homeWin,
      drawProb: probs.draw,
      awayWinProb: probs.awayWin,
      probSource: 'elo_estimated' as const,
    };
  });

  const generatedFixtures =
    fixturesResult.source === 'live' ? generateRemainingFixtures(teams, knownFixtures) : [];
  const fixtures = generatedFixtures.length > 0 ? [...knownFixtures, ...generatedFixtures] : knownFixtures;

  const scheduledFixtures = fixtures.filter((fixture) => fixture.status === 'SCHEDULED');
  const nextMatchday = scheduledFixtures
    .map((fixture) => fixture.matchday)
    .filter((matchday) => Number.isFinite(matchday))
    .sort((a, b) => a - b)[0];
  const nextRoundFixtures =
    nextMatchday === undefined
      ? []
      : scheduledFixtures.filter((fixture) => fixture.matchday === nextMatchday);

  return {
    teams,
    fixtures,
    standingsSource: standingsResult.source,
    fixturesSource: fixturesResult.source,
    oddsSource: oddsResult.source,
    oddsCoverage: {
      matchedFixtures: scheduledFixtures.filter((fixture) => fixture.probSource === 'odds_api').length,
      totalScheduledFixtures: scheduledFixtures.length,
      nextRoundMatchedFixtures: nextRoundFixtures.filter((fixture) => fixture.probSource === 'odds_api').length,
      nextRoundScheduledFixtures: nextRoundFixtures.length,
    },
  };
}
