import { NextResponse } from 'next/server';
import { getOddsData } from '@/lib/live-data';
import { getLatestStoredH2H } from '@/lib/odds-snapshots';

export async function GET() {
  const [result, storedH2H] = await Promise.all([
    getOddsData(),
    getLatestStoredH2H(),
  ]);

  // Convert stored h2h Map to a plain object for JSON serialization
  const storedOdds: Record<string, { homeWin: number; awayWin: number; snapshotAt: string }> = {};
  for (const [key, val] of storedH2H) {
    storedOdds[key] = val;
  }

  return NextResponse.json({
    odds: result.data,
    source: result.source,
    storedOdds,
  });
}
