import { NextRequest, NextResponse } from 'next/server';
import { getPaperBets, computePaperBetSummary } from '@/lib/value-tracker';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const season = searchParams.get('season') ?? undefined;
  const status = searchParams.get('status') ?? undefined;
  const team = searchParams.get('team') ?? undefined;
  const market = searchParams.get('market') ?? undefined;

  const bets = await getPaperBets({ season, status, team, market });
  const summary = computePaperBetSummary(bets);

  return NextResponse.json({ bets, summary });
}
