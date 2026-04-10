import { renderToStaticMarkup } from 'react-dom/server';
import { vi } from 'vitest';

const getLatestWeeklyPreviewDraft = vi.fn();
const isWeeklyPreviewConfigured = vi.fn();

vi.mock('@/lib/weekly-preview/cache', () => ({
  getLatestWeeklyPreviewDraft,
  isWeeklyPreviewConfigured,
}));

describe('weekly preview page', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('renders the latest draft content', async () => {
    isWeeklyPreviewConfigured.mockReturnValue(true);
    getLatestWeeklyPreviewDraft.mockResolvedValue({
      id: 'draft-1',
      generatedAt: Date.now(),
      warnings: ['Warning'],
      sources: [{ id: 'source-1', title: 'Source 1', provider: 'serper' }],
      sections: [
        {
          sectionId: 'overview',
          headline: 'Overview',
          markdown: 'Paragraph one.\n\n- Bullet one',
          factsUsed: [],
          newFacts: [],
          numericClaimIds: [],
          sourceRefs: [],
          handoffNotes: [],
        },
      ],
    });

    const Page = (await import('@/app/weekly-preview/page')).default;
    const html = renderToStaticMarkup(await Page());

    expect(html).toContain('Newcastle Weekly Preview');
    expect(html).toContain('Overview');
    expect(html).toContain('Warning');
    expect(html).toContain('Source 1');
  });
});
