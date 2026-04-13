import { NextRequest, NextResponse } from 'next/server';
import { getOddsHistory } from '@/lib/odds-snapshots';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const team = searchParams.get('team') ?? undefined;
  const market = searchParams.get('market') ?? undefined;
  const from = searchParams.get('from') ?? undefined;
  const to = searchParams.get('to') ?? undefined;
  const limit = searchParams.get('limit') ? parseInt(searchParams.get('limit')!, 10) : undefined;

  const snapshots = await getOddsHistory({ team, market, from, to, limit });

  return NextResponse.json({ snapshots });
}
