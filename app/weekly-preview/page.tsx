import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';
import {
  getLatestWeeklyPreviewDraft,
  getWeeklyPreviewByMatchday,
  isWeeklyPreviewConfigured,
  listWeeklyPreviews,
} from '@/lib/weekly-preview/cache';
import GeneratePreviewButton from '@/app/weekly-preview/GeneratePreviewButton';

const SECTION_ACCENTS: Record<string, string> = {
  overview: 'border-l-teal-400/60',
  'three-contests': 'border-l-blue-400/60',
  'hot-news': 'border-l-amber-400/60',
  'game-of-the-week': 'border-l-emerald-400/60',
  'club-focus': 'border-l-white/30',
  'match-focus': 'border-l-teal-400/60',
  'perfect-weekend': 'border-l-emerald-400/60',
  summary: 'border-l-white/30',
};

const SECTION_LABELS: Record<string, string> = {
  overview: 'Overview',
  'three-contests': 'The Three Contests',
  'hot-news': 'Hot News',
  'game-of-the-week': 'Game of the Week',
  'club-focus': 'Club Focus',
  'match-focus': 'Match Preview',
  'perfect-weekend': 'Perfect Weekend',
  summary: 'The Verdict',
};

function stripLeadingMarkdownHeading(markdown: string): string {
  return markdown.replace(/^##\s+.+\n+/, '');
}

const markdownComponents: Components = {
  h2: ({ children }) => (
    <h3 className="mt-6 mb-3 font-oswald text-xl tracking-wide text-white/90">{children}</h3>
  ),
  h3: ({ children }) => (
    <h4 className="mt-5 mb-2 text-[15px] font-semibold tracking-wide uppercase text-teal-300/80">
      {children}
    </h4>
  ),
  p: ({ children }) => <p className="text-[15px] leading-[1.8] text-white/70">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold text-white">{children}</strong>,
  em: ({ children }) => <em className="italic text-white/80">{children}</em>,
  ul: ({ children }) => <ul className="list-disc pl-5 space-y-1.5 text-[15px] text-white/70">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal pl-5 space-y-1.5 text-[15px] text-white/70">{children}</ol>,
  li: ({ children }) => <li className="leading-[1.7]">{children}</li>,
  hr: () => <hr className="my-6 border-white/10" />,
  table: ({ children }) => (
    <div className="my-5 overflow-x-auto rounded-xl border border-white/10 bg-white/[0.02]">
      <table className="w-full text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }) => (
    <thead className="border-b border-white/10 bg-white/[0.04]">{children}</thead>
  ),
  tbody: ({ children }) => <tbody className="divide-y divide-white/[0.06]">{children}</tbody>,
  tr: ({ children }) => <tr className="transition-colors hover:bg-white/[0.03]">{children}</tr>,
  th: ({ children }) => (
    <th className="px-4 py-2.5 text-left text-[11px] font-semibold tracking-[0.1em] uppercase text-white/50">
      {children}
    </th>
  ),
  td: ({ children }) => {
    const text = String(children ?? '');
    const isHighlight = text.includes('**') || text.startsWith('+');
    return (
      <td className={`px-4 py-2.5 text-[13px] ${isHighlight ? 'font-semibold text-teal-300' : 'text-white/70'}`}>
        {children}
      </td>
    );
  },
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-teal-400/40 pl-4 italic text-white/60">{children}</blockquote>
  ),
};

export default async function WeeklyPreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ matchday?: string }>;
}) {
  const params = await searchParams;
  const matchdayParam = params.matchday ? parseInt(params.matchday, 10) : null;

  const cacheEnabled = isWeeklyPreviewConfigured();

  const [draft, archive] = await Promise.all([
    matchdayParam
      ? getWeeklyPreviewByMatchday(matchdayParam)
      : getLatestWeeklyPreviewDraft('NEW'),
    listWeeklyPreviews('NEW'),
  ]);

  const isArchiveView = matchdayParam !== null;

  return (
    <main className="min-h-screen bg-[#0b0b0b] text-white">
      <div className="mx-auto max-w-[860px] px-5 py-12">
        {/* Back nav */}
        <a
          href="/"
          className="inline-flex items-center gap-1 text-[11px] text-white/30 hover:text-white/60 transition-colors mb-6"
        >
          ← Dashboard
        </a>

        {/* Header */}
        <header className="mb-8">
          <div className="flex items-center gap-3 mb-4 flex-wrap">
            <span className="rounded-full border border-amber-400/40 bg-amber-400/10 px-3 py-1 text-[10px] font-bold tracking-[0.16em] uppercase text-amber-200">
              Preview
            </span>
            {draft && (
              <span className="text-white/30 text-xs">
                Generated{' '}
                {new Date(draft.generatedAt).toLocaleString('en-GB', {
                  day: 'numeric',
                  month: 'long',
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            )}
          </div>
          <h1 className="font-oswald text-4xl md:text-5xl tracking-wide text-white leading-tight">
            Newcastle Weekly Preview
          </h1>
          {draft && (
            <p className="mt-2 text-sm text-white/40">
              Matchday {draft.matchday} &middot; {draft.season}
            </p>
          )}
        </header>

        {/* Archive strip */}
        {archive.length > 0 && (
          <div className="mb-6">
            <div className="mb-2 text-[10px] font-bold tracking-[0.16em] uppercase text-white/25">
              Archive
            </div>
            <div className="flex flex-wrap gap-2">
              <a
                href="/weekly-preview"
                className={`rounded-lg border px-3 py-1.5 text-[11px] font-semibold transition-colors ${
                  !isArchiveView
                    ? 'border-amber-400/50 bg-amber-400/15 text-amber-200'
                    : 'border-white/10 bg-white/[0.03] text-white/40 hover:text-white/70 hover:border-white/20'
                }`}
              >
                Latest
              </a>
              {archive.map((item) => {
                const isActive = isArchiveView && matchdayParam === item.matchday;
                return (
                  <a
                    key={item.id}
                    href={`/weekly-preview?matchday=${item.matchday}`}
                    className={`rounded-lg border px-3 py-1.5 text-[11px] font-semibold transition-colors ${
                      isActive
                        ? 'border-amber-400/50 bg-amber-400/15 text-amber-200'
                        : 'border-white/10 bg-white/[0.03] text-white/40 hover:text-white/70 hover:border-white/20'
                    }`}
                  >
                    MD {item.matchday}
                  </a>
                );
              })}
            </div>
          </div>
        )}

        {/* Generate trigger */}
        <div className="mb-8">
          <GeneratePreviewButton />
        </div>

        {!cacheEnabled && (
          <div className="mb-6 rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-white/55 text-sm">
            Weekly preview storage is not configured. Add{' '}
            <code className="text-teal-300/70">SUPABASE_URL</code> and{' '}
            <code className="text-teal-300/70">SUPABASE_SERVICE_ROLE_KEY</code> to enable saved
            drafts.
          </div>
        )}

        {!draft && cacheEnabled && (
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-white/55 text-sm">
            {isArchiveView
              ? `No preview found for Matchday ${matchdayParam}.`
              : 'No weekly preview has been generated yet. Hit "Generate New Preview" above to create one.'}
          </div>
        )}

        {draft && (
          <>
            {draft.warnings.length > 0 && (
              <div className="mb-8 rounded-2xl border border-amber-400/20 bg-amber-400/[0.04] p-5">
                <div className="mb-2 text-[10px] font-bold tracking-[0.16em] uppercase text-amber-200/80">
                  Warnings
                </div>
                <ul className="list-disc pl-5 space-y-1 text-sm text-white/55">
                  {draft.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="space-y-8">
              {draft.sections.map((section, index) => {
                const accent = SECTION_ACCENTS[section.sectionId] ?? 'border-l-white/20';
                const label = SECTION_LABELS[section.sectionId] ?? `Section ${index + 1}`;
                const cleanMarkdown = stripLeadingMarkdownHeading(section.markdown);

                return (
                  <article
                    key={section.sectionId}
                    className={`rounded-2xl border border-white/[0.07] bg-white/[0.025] border-l-[3px] ${accent}`}
                  >
                    <div className="px-6 pt-5 pb-1">
                      <div className="mb-3 text-[10px] font-bold tracking-[0.16em] uppercase text-white/30">
                        {label}
                      </div>
                      <h2 className="font-oswald text-2xl md:text-3xl tracking-wide text-white leading-snug">
                        {section.headline}
                      </h2>
                    </div>
                    <div className="px-6 pt-3 pb-6 space-y-4 prose-invert">
                      <Markdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                        {cleanMarkdown}
                      </Markdown>
                    </div>
                  </article>
                );
              })}
            </div>

            {/* Sources */}
            {draft.sources.length > 0 && (
              <footer className="mt-10 rounded-2xl border border-white/[0.07] bg-white/[0.02] p-6">
                <div className="mb-3 text-[10px] font-bold tracking-[0.16em] uppercase text-white/25">
                  Sources
                </div>
                <ul className="space-y-1.5 text-xs text-white/35">
                  {draft.sources.map((source) => (
                    <li key={source.id}>
                      <span className="text-white/20 mr-2">{source.id}</span>
                      {source.title}
                      {source.provider && source.provider !== 'unavailable' ? (
                        <span className="ml-1 text-white/20">via {source.provider}</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </footer>
            )}

            {/* Generation metadata */}
            <div className="mt-6 text-[11px] text-white/20 text-center">
              {draft.metadata.llmCalls} LLM calls &middot; {draft.metadata.model}
            </div>
          </>
        )}
      </div>
    </main>
  );
}
