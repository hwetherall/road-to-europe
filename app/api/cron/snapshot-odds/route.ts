import { NextRequest, NextResponse } from 'next/server';
import { captureOddsSnapshot, isOddsSnapshotConfigured } from '@/lib/odds/snapshot';

export const dynamic = 'force-dynamic';

/**
 * Odds snapshot endpoint, called on a schedule.
 *
 * TRIGGERED BY MODAL, NOT BY VERCEL CRON — and not by choice.
 *
 * Vercel's Hobby plan permits cron jobs at a maximum of once per day, and an
 * expression that would fire more often FAILS AT DEPLOY TIME with an explicit
 * error rather than silently running less often. Line movement at daily
 * resolution is close to useless: the interesting behaviour is around team-news
 * and kickoff, which is hours, not days. So a Modal scheduled function calls this
 * route four times a day (see modal/snapshot_odds.py).
 *
 * Modal is used only as a clock. Every piece of logic — fetching, de-vigging,
 * mapping clubs, persisting — stays in TypeScript in this repo, so there is no
 * second implementation to keep in step and no Python copy of the club map. The
 * only thing living on Modal is the schedule and a bearer token.
 */
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

  if (!isOddsSnapshotConfigured()) {
    return NextResponse.json(
      { error: 'Supabase credentials not configured; refusing to run and report success' },
      { status: 503 }
    );
  }

  const result = await captureOddsSnapshot();

  // A run that captured nothing is a failure worth a non-200, or the scheduler
  // will report green through an outage. A run that captured SOMETHING is a
  // success even if one source failed — that is the whole point of not failing
  // the batch on one source.
  const status = result.totalRows > 0 && result.persisted ? 200 : 502;

  return NextResponse.json(
    {
      ok: status === 200,
      capturedAt: result.capturedAt,
      season: result.season,
      rows: result.totalRows,
      persisted: result.persisted,
      sources: result.sources,
    },
    { status }
  );
}
