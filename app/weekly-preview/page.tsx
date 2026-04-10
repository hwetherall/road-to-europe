import { getLatestWeeklyPreviewDraft, isWeeklyPreviewConfigured } from '@/lib/weekly-preview/cache';

function renderSectionBody(markdown: string) {
  return markdown.split(/\n{2,}/).map((paragraph, index) => {
    const lines = paragraph.split('\n').filter(Boolean);
    if (lines.every((line) => line.startsWith('- '))) {
      return (
        <ul key={index} className="list-disc pl-5 space-y-2 text-white/75">
          {lines.map((line) => (
            <li key={line}>{line.slice(2)}</li>
          ))}
        </ul>
      );
    }

    return (
      <p key={index} className="text-white/75 leading-7 whitespace-pre-wrap">
        {paragraph}
      </p>
    );
  });
}

export default async function WeeklyPreviewPage() {
  const cacheEnabled = isWeeklyPreviewConfigured();
  const draft = await getLatestWeeklyPreviewDraft('NEW');

  return (
    <main className="min-h-screen bg-[#0b0b0b] text-white">
      <div className="mx-auto max-w-[920px] px-4 py-10">
        <div className="mb-8 flex items-center gap-3 flex-wrap">
          <span className="rounded-full border border-amber-400/40 bg-amber-400/10 px-3 py-1 text-[11px] font-semibold tracking-[0.14em] uppercase text-amber-200">
            Draft
          </span>
          <div className="text-white/55 text-sm">Newcastle Weekly Preview</div>
          {draft && (
            <div className="text-white/35 text-sm">
              Generated {new Date(draft.generatedAt).toLocaleString('en-GB')}
            </div>
          )}
        </div>

        {!cacheEnabled && (
          <div className="mb-6 rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-white/70">
            Weekly preview storage is not configured. Add `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to enable saved drafts.
          </div>
        )}

        {!draft && (
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-white/70">
            No weekly preview draft has been generated yet.
          </div>
        )}

        {draft && (
          <>
            {draft.warnings.length > 0 && (
              <div className="mb-6 rounded-2xl border border-amber-400/20 bg-amber-400/[0.06] p-5">
                <div className="mb-2 text-[11px] font-semibold tracking-[0.14em] uppercase text-amber-200/90">
                  Warnings
                </div>
                <ul className="list-disc pl-5 space-y-2 text-white/70">
                  {draft.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="space-y-6">
              {draft.sections.map((section, index) => (
                <section key={section.sectionId} className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
                  <div className="mb-4 text-[11px] tracking-[0.14em] uppercase text-white/35">
                    Section {index + 1}
                  </div>
                  <h2 className="mb-4 font-oswald text-3xl tracking-wide text-white">
                    {section.headline}
                  </h2>
                  <div className="space-y-4">{renderSectionBody(section.markdown)}</div>
                </section>
              ))}
            </div>

            {draft.sources.length > 0 && (
              <section className="mt-8 rounded-3xl border border-white/10 bg-white/[0.03] p-6">
                <div className="mb-4 text-[11px] tracking-[0.14em] uppercase text-white/35">Sources</div>
                <ul className="space-y-2 text-white/65">
                  {draft.sources.map((source) => (
                    <li key={source.id}>
                      {source.title}
                      {source.provider ? ` (${source.provider})` : ''}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>
    </main>
  );
}
