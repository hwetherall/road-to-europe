import { NextResponse } from 'next/server';
import { KNOWN_FIXTURES, TEAM_NAME_MAP } from '@/lib/constants';
import { Fixture } from '@/lib/types';

export async function GET() {
  const apiKey = process.env.FOOTBALL_DATA_API_KEY;

  if (apiKey) {
    try {
      const res = await fetch(
        'https://api.football-data.org/v4/competitions/PL/matches?status=SCHEDULED',
        {
          headers: { 'X-Auth-Token': apiKey },
          next: { revalidate: 900 }, // 15 min cache
        }
      );

      if (res.ok) {
        const data = await res.json();
        const matches = data.matches;
        if (matches?.length > 0) {
          const fixtures: Fixture[] = matches.map(
            (m: Record<string, unknown>, i: number) => {
              const homeTeamData = m.homeTeam as Record<string, string>;
              const awayTeamData = m.awayTeam as Record<string, string>;
              return {
                id: String(m.id || i),
                homeTeam:
                  TEAM_NAME_MAP[homeTeamData.name] || homeTeamData.tla,
                awayTeam:
                  TEAM_NAME_MAP[awayTeamData.name] || awayTeamData.tla,
                matchday: m.matchday as number,
                date: m.utcDate as string,
                status: 'SCHEDULED' as const,
                probSource: 'elo_estimated' as const,
              };
            }
          );
          return NextResponse.json({ fixtures, source: 'live' });
        }
      }
    } catch {
      // Fall through to hardcoded
    }
  }

  return NextResponse.json({
    fixtures: KNOWN_FIXTURES,
    source: 'hardcoded',
  });
}
