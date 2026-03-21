import { NextResponse } from 'next/server';
import { averageBookmakerOdds } from '@/lib/odds-converter';

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

export async function GET() {
  const apiKey = process.env.ODDS_API_KEY;

  if (!apiKey) {
    return NextResponse.json({ odds: [], source: 'none' });
  }

  try {
    const res = await fetch(
      `https://api.the-odds-api.com/v4/sports/soccer_epl/odds/?apiKey=${apiKey}&regions=uk&markets=h2h&oddsFormat=decimal`,
      { next: { revalidate: 3600 } } // 1 hour cache
    );

    if (!res.ok) {
      return NextResponse.json({ odds: [], source: 'error' });
    }

    const events: OddsApiEvent[] = await res.json();

    const odds = events.map((event) => {
      const bookmakerOdds = event.bookmakers
        .map((bm) => {
          const h2h = bm.markets.find((m) => m.key === 'h2h');
          if (!h2h) return null;
          const home = h2h.outcomes.find(
            (o) => o.name === event.home_team
          );
          const away = h2h.outcomes.find(
            (o) => o.name === event.away_team
          );
          const draw = h2h.outcomes.find((o) => o.name === 'Draw');
          if (!home || !away || !draw) return null;
          return {
            homeOdds: home.price,
            drawOdds: draw.price,
            awayOdds: away.price,
          };
        })
        .filter(
          (b): b is { homeOdds: number; drawOdds: number; awayOdds: number } =>
            b !== null
        );

      const avgProb = averageBookmakerOdds(bookmakerOdds);

      return {
        homeTeam: event.home_team,
        awayTeam: event.away_team,
        date: event.commence_time,
        ...(avgProb || { homeWin: 0.4, draw: 0.3, awayWin: 0.3 }),
      };
    });

    return NextResponse.json({ odds, source: 'live' });
  } catch {
    return NextResponse.json({ odds: [], source: 'error' });
  }
}
