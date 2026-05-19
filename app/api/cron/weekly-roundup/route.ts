import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { getLatestRoundupGenerationStatus } from '@/lib/weekly-roundup/dossier';
import { generateWeeklyRoundupDraft } from '@/lib/weekly-roundup/orchestrator';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { matchday: latestMatchday } = await getLatestRoundupGenerationStatus();
    if (!latestMatchday) {
      return NextResponse.json({ error: 'No finished fixtures found' }, { status: 404 });
    }

    const result = await generateWeeklyRoundupDraft({ matchday: latestMatchday });
    revalidatePath('/weekly-roundup');

    return NextResponse.json({
      ok: true,
      persisted: result.persisted,
      draftId: result.draft.id,
      matchday: result.draft.matchday,
      generatedAt: result.draft.generatedAt,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[weekly-roundup] cron generation failed:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
