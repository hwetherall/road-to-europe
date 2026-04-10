import { revalidatePath } from 'next/cache';
import { NextRequest, NextResponse } from 'next/server';
import { generateWeeklyPreviewDraft } from '@/lib/weekly-preview/orchestrator';

export const dynamic = 'force-dynamic';

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

  const result = await generateWeeklyPreviewDraft({ scheduledFor: new Date() });
  revalidatePath('/weekly-preview');
  return NextResponse.json({
    ok: true,
    persisted: result.persisted,
    draftId: result.draft.id,
    matchday: result.draft.matchday,
    generatedAt: result.draft.generatedAt,
  });
}
