import { vi } from 'vitest';

const getLatestWeeklyPreviewDraft = vi.fn();
const isWeeklyPreviewConfigured = vi.fn();
const generateWeeklyPreviewDraft = vi.fn();
const revalidatePath = vi.fn();

vi.mock('@/lib/weekly-preview/cache', () => ({
  getLatestWeeklyPreviewDraft,
  isWeeklyPreviewConfigured,
}));

vi.mock('@/lib/weekly-preview/orchestrator', () => ({
  generateWeeklyPreviewDraft,
}));

vi.mock('next/cache', () => ({
  revalidatePath,
}));

describe('weekly preview api route', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns the latest draft on GET', async () => {
    isWeeklyPreviewConfigured.mockReturnValue(true);
    getLatestWeeklyPreviewDraft.mockResolvedValue({ id: 'draft-1' });

    const route = await import('@/app/api/weekly-preview/route');
    const response = await route.GET();
    const json = await response.json();

    expect(json.cacheEnabled).toBe(true);
    expect(json.draft).toEqual({ id: 'draft-1' });
  });

  it('generates and revalidates on POST', async () => {
    generateWeeklyPreviewDraft.mockResolvedValue({
      persisted: true,
      draft: { id: 'draft-2' },
    });

    const route = await import('@/app/api/weekly-preview/route');
    const response = await route.POST();
    const json = await response.json();

    expect(generateWeeklyPreviewDraft).toHaveBeenCalled();
    expect(revalidatePath).toHaveBeenCalledWith('/weekly-preview');
    expect(json.draft).toEqual({ id: 'draft-2' });
  });
});
