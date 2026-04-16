import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { getLatestWeeklyRoundupDraft, isWeeklyRoundupConfigured } from '@/lib/weekly-roundup/cache';
import { generateWeeklyRoundupDraft } from '@/lib/weekly-roundup/orchestrator';

export const dynamic = 'force-dynamic';

export async function GET() {
  const cacheEnabled = isWeeklyRoundupConfigured();
  const draft = await getLatestWeeklyRoundupDraft('NEW');
  return NextResponse.json({ cacheEnabled, draft });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const matchday = body.matchday;

  if (!matchday || typeof matchday !== 'number') {
    return NextResponse.json(
      { error: 'matchday is required and must be a number' },
      { status: 400 }
    );
  }

  try {
    const result = await generateWeeklyRoundupDraft({ matchday });
    revalidatePath('/weekly-roundup');
    return NextResponse.json({ persisted: result.persisted, draft: result.draft });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[weekly-roundup] generation failed:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
