import { NextResponse } from 'next/server';
import { KNOWN_FIXTURES, TEAM_NAME_MAP } from '@/lib/constants';
import { Fixture } from '@/lib/types';

function parseMatch(m: Record<string, unknown>, i: number): Fixture {
  const homeTeamData = m.homeTeam as Record<string, string>;
  const awayTeamData = m.awayTeam as Record<string, string>;
  const score = m.score as Record<string, unknown> | undefined;
  const fullTime = score?.fullTime as Record<string, number | null> | undefined;
  const status = m.status as string;

  return {
    id: String(m.id || i),
    homeTeam: TEAM_NAME_MAP[homeTeamData.name] || homeTeamData.tla,
    awayTeam: TEAM_NAME_MAP[awayTeamData.name] || awayTeamData.tla,
    matchday: m.matchday as number,
    date: m.utcDate as string,
    status: status === 'FINISHED' ? 'FINISHED' : 'SCHEDULED',
    homeScore: fullTime?.home ?? undefined,
    awayScore: fullTime?.away ?? undefined,
    probSource: 'elo_estimated' as const,
  };
}

export async function GET() {
  const apiKey = process.env.FOOTBALL_DATA_API_KEY;

  if (apiKey) {
    try {
      // Fetch both finished and scheduled matches so the fixture generator
      // knows which matchups have already been played
      const [finishedRes, scheduledRes] = await Promise.all([
        fetch(
          'https://api.football-data.org/v4/competitions/PL/matches?status=FINISHED',
          {
            headers: { 'X-Auth-Token': apiKey },
            next: { revalidate: 900 },
          }
        ),
        fetch(
          'https://api.football-data.org/v4/competitions/PL/matches?status=SCHEDULED',
          {
            headers: { 'X-Auth-Token': apiKey },
            next: { revalidate: 900 },
          }
        ),
      ]);

      const fixtures: Fixture[] = [];

      if (finishedRes.ok) {
        const data = await finishedRes.json();
        if (data.matches?.length > 0) {
          fixtures.push(...data.matches.map(parseMatch));
        }
      }

      if (scheduledRes.ok) {
        const data = await scheduledRes.json();
        if (data.matches?.length > 0) {
          fixtures.push(...data.matches.map(parseMatch));
        }
      }

      if (fixtures.length > 0) {
        return NextResponse.json({ fixtures, source: 'live' });
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
