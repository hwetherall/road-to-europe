import { NextResponse } from 'next/server';
import { getOddsData } from '@/lib/live-data';

export async function GET() {
  const result = await getOddsData();
  return NextResponse.json({
    odds: result.data,
    source: result.source,
  });
}
