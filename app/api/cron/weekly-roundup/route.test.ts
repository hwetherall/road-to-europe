import { NextRequest } from 'next/server';
import { vi } from 'vitest';

const generateWeeklyRoundupDraft = vi.fn();
const getLatestRoundupGenerationStatus = vi.fn();
const revalidatePath = vi.fn();

vi.mock('@/lib/weekly-roundup/orchestrator', () => ({
  generateWeeklyRoundupDraft,
}));

vi.mock('@/lib/weekly-roundup/dossier', () => ({
  getLatestRoundupGenerationStatus,
}));

vi.mock('next/cache', () => ({
  revalidatePath,
}));

describe('weekly roundup cron route', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.CRON_SECRET = 'test-secret';
  });

  it('rejects unauthorized requests', async () => {
    const route = await import('@/app/api/cron/weekly-roundup/route');
    const request = new NextRequest('https://example.com/api/cron/weekly-roundup');
    const response = await route.GET(request);

    expect(response.status).toBe(401);
  });

  it('accepts authorized requests and revalidates', async () => {
    getLatestRoundupGenerationStatus.mockResolvedValue({ matchday: 1 });
    generateWeeklyRoundupDraft.mockResolvedValue({
      persisted: true,
      draft: { id: 'draft-1', matchday: 1, generatedAt: 123 },
    });

    const route = await import('@/app/api/cron/weekly-roundup/route');
    const request = new NextRequest('https://example.com/api/cron/weekly-roundup', {
      headers: { authorization: 'Bearer test-secret' },
    });
    const response = await route.GET(request);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(generateWeeklyRoundupDraft).toHaveBeenCalledWith({ matchday: 1 });
    expect(revalidatePath).toHaveBeenCalledWith('/weekly-roundup');
    expect(json.ok).toBe(true);
    expect(json.draftId).toBe('draft-1');
    expect(json.matchday).toBe(1);
  });
});
