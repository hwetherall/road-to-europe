import { NextResponse } from 'next/server';
import { getOddsData, getFixturesData } from '@/lib/live-data';
import { writeOddsSnapshots } from '@/lib/odds-snapshots';

export const dynamic = 'force-dynamic';

export async function POST() {
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

  const h2hResult = await getOddsData();

  const snapshotResult = await writeOddsSnapshots(h2hResult.data, currentMatchday);

  return NextResponse.json({
    ok: true,
    h2hCount: h2hResult.data.length,
    h2hSource: h2hResult.source,
    snapshotsInserted: snapshotResult.inserted,
    snapshotError: snapshotResult.error,
    matchday: currentMatchday ?? null,
  });
}
