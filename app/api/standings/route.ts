import { NextResponse } from 'next/server';
import { HARDCODED_STANDINGS, TEAM_NAME_MAP } from '@/lib/constants';
import { Team } from '@/lib/types';

export async function GET() {
  const apiKey = process.env.FOOTBALL_DATA_API_KEY;

  if (apiKey) {
    try {
      const res = await fetch(
        'https://api.football-data.org/v4/competitions/PL/standings',
        {
          headers: { 'X-Auth-Token': apiKey },
          next: { revalidate: 300 }, // 5 min cache
        }
      );

      if (res.ok) {
        const data = await res.json();
        const table = data.standings?.[0]?.table;
        if (table) {
          const teams: Team[] = table.map(
            (entry: Record<string, unknown>, i: number) => {
              const teamData = entry.team as Record<string, string>;
              return {
                id: String(i + 1),
                name: teamData.shortName || teamData.name,
                abbr:
                  TEAM_NAME_MAP[teamData.name as string] ||
                  (teamData.tla as string),
                points: entry.points as number,
                goalDifference: entry.goalDifference as number,
                goalsFor: entry.goalsFor as number,
                goalsAgainst: entry.goalsAgainst as number,
                played: entry.playedGames as number,
                won: entry.won as number,
                drawn: entry.draw as number,
                lost: entry.lost as number,
              };
            }
          );
          return NextResponse.json({ teams, source: 'live' });
        }
      }
    } catch {
      // Fall through to hardcoded
    }
  }

  return NextResponse.json({
    teams: HARDCODED_STANDINGS,
    source: 'hardcoded',
  });
}
