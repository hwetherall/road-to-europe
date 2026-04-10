import { NextResponse } from 'next/server';
import { getStandingsData } from '@/lib/live-data';

export async function GET() {
  const result = await getStandingsData();
  return NextResponse.json({
    teams: result.data,
    source: result.source,
  });
}
