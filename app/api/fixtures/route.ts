import { NextResponse } from 'next/server';
import { getFixturesData } from '@/lib/live-data';

export async function GET() {
  const result = await getFixturesData();
  return NextResponse.json({
    fixtures: result.data,
    source: result.source,
  });
}
