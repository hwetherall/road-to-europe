import { NextRequest } from 'next/server';
import { vi } from 'vitest';

const generateWeeklyPreviewDraft = vi.fn();
const revalidatePath = vi.fn();

vi.mock('@/lib/weekly-preview/orchestrator', () => ({
  generateWeeklyPreviewDraft,
}));

vi.mock('next/cache', () => ({
  revalidatePath,
}));

describe('weekly preview cron route', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.CRON_SECRET = 'test-secret';
  });

  it('rejects unauthorized requests', async () => {
    const route = await import('@/app/api/cron/weekly-preview/route');
    const request = new NextRequest('https://example.com/api/cron/weekly-preview');
    const response = await route.GET(request);

    expect(response.status).toBe(401);
  });

  it('accepts authorized requests and revalidates', async () => {
    generateWeeklyPreviewDraft.mockResolvedValue({
      persisted: true,
      draft: { id: 'draft-3', matchday: 33, generatedAt: 123 },
    });

    const route = await import('@/app/api/cron/weekly-preview/route');
    const request = new NextRequest('https://example.com/api/cron/weekly-preview', {
      headers: { authorization: 'Bearer test-secret' },
    });
    const response = await route.GET(request);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(revalidatePath).toHaveBeenCalledWith('/weekly-preview');
    expect(json.ok).toBe(true);
    expect(json.draftId).toBe('draft-3');
  });
});
