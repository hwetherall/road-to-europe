import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { getLatestWeeklyRoundupDraft, isWeeklyRoundupConfigured } from '@/lib/weekly-roundup/cache';
import { getLatestRoundupGenerationStatus } from '@/lib/weekly-roundup/dossier';
import { generateWeeklyRoundupDraft } from '@/lib/weekly-roundup/orchestrator';

export const dynamic = 'force-dynamic';

/** Manual generate from /weekly-roundup takes 1–2 minutes. */
export const maxDuration = 300;

export async function GET() {
  const cacheEnabled = isWeeklyRoundupConfigured();
  const [draft, generationStatus] = await Promise.all([
    getLatestWeeklyRoundupDraft('NEW'),
    getLatestRoundupGenerationStatus(),
  ]);
  return NextResponse.json({ cacheEnabled, draft, generationStatus });
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as { matchday?: unknown };
  let matchday = body.matchday;

  if (matchday === undefined) {
    const status = await getLatestRoundupGenerationStatus();
    matchday = status.matchday;
  }

  if (!matchday || typeof matchday !== 'number' || !Number.isInteger(matchday)) {
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
