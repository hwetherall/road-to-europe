import { revalidatePath } from 'next/cache';
import { NextResponse } from 'next/server';
import { getLatestWeeklyPreviewDraft, isWeeklyPreviewConfigured } from '@/lib/weekly-preview/cache';
import { generateWeeklyPreviewDraft } from '@/lib/weekly-preview/orchestrator';

export const dynamic = 'force-dynamic';

export async function GET() {
  const draft = await getLatestWeeklyPreviewDraft('NEW');

  return NextResponse.json({
    cacheEnabled: isWeeklyPreviewConfigured(),
    draft,
  });
}

export async function POST() {
  const result = await generateWeeklyPreviewDraft();
  revalidatePath('/weekly-preview');

  return NextResponse.json({
    persisted: result.persisted,
    draft: result.draft,
  });
}
