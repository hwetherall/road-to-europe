import { vi } from 'vitest';

const upsert = vi.fn();
const from = vi.fn(() => ({ upsert }));
const createClient = vi.fn(() => ({ from }));

vi.mock('@supabase/supabase-js', () => ({
  createClient,
}));

describe('weekly preview cache', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    upsert.mockResolvedValue({ error: null });
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role';
  });

  it('upserts drafts on the season/matchday/club key', async () => {
    const { upsertWeeklyPreviewDraft } = await import('@/lib/weekly-preview/cache');

    await upsertWeeklyPreviewDraft({
      id: 'draft-1',
      version: 'v1',
      season: '2025-26',
      matchday: 33,
      club: 'NEW',
      status: 'draft',
      generatedAt: 1,
      scheduledFor: new Date(1).toISOString(),
      markdown: 'body',
      dossier: {
        dataHash: 'hash',
      } as never,
      sections: [],
      sources: [],
      warnings: [],
      metadata: {
        llmCalls: 0,
        sectionAgentCalls: 8,
        editorCalls: 1,
        model: 'model',
      },
    });

    expect(from).toHaveBeenCalledWith('weekly_previews');
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        season: '2025-26',
        matchday: 33,
        club_abbr: 'NEW',
      }),
      expect.objectContaining({
        onConflict: 'season,matchday,club_abbr',
      })
    );
  });
});
