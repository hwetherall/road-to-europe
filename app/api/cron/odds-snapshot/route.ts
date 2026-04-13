import { NextRequest, NextResponse } from 'next/server';
import { getOddsData, getStandingsData, getFixturesData } from '@/lib/live-data';
import { writeOddsSnapshots } from '@/lib/odds-snapshots';
import { detectAndPlaceH2HValueBets } from '@/lib/value-tracker';
import { simulate } from '@/lib/montecarlo';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const authHeader = request.headers.get('authorization');
  return authHeader === `Bearer ${secret}`;
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const results: Record<string, unknown> = {};

  // 1. Fetch h2h match odds (1 API request)
  const h2hResult = await getOddsData();
  results.h2hSource = h2hResult.source;
  results.h2hCount = h2hResult.data.length;

  // 2. Determine current matchday
  let currentMatchday: number | undefined;
  try {
    const fixturesResult = await getFixturesData();
    const scheduled = fixturesResult.data.filter((f) => f.status === 'SCHEDULED');
    const matchdays = scheduled
      .map((f) => f.matchday)
      .filter((m) => Number.isFinite(m))
      .sort((a, b) => a - b);
    if (matchdays.length > 0) currentMatchday = matchdays[0];
  } catch {
    // non-critical
  }
  results.currentMatchday = currentMatchday ?? null;

  // 3. Write h2h snapshots to Supabase
  const snapshotResult = await writeOddsSnapshots(h2hResult.data, currentMatchday);
  results.snapshotsInserted = snapshotResult.inserted;
  results.snapshotError = snapshotResult.error;

  // 4. Run value bet detection against h2h odds
  try {
    const standingsResult = await getStandingsData();
    const fixturesResult = await getFixturesData();
    const simResults = simulate(standingsResult.data, fixturesResult.data, 10000);

    const valueBetResult = await detectAndPlaceH2HValueBets({
      fixtures: fixturesResult.data,
      simResults,
      season: '2025-26',
      matchday: currentMatchday,
    });

    results.valueBetsPlaced = valueBetResult.placed;
    results.valueBetsSkipped = valueBetResult.skipped;
    results.valueBetError = valueBetResult.error;
  } catch (e) {
    results.valueBetError = e instanceof Error ? e.message : 'Unknown error';
  }

  return NextResponse.json({ ok: true, ...results });
}
