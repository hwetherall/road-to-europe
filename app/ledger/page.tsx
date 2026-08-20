import Link from 'next/link';
import { CURRENT_SEASON, PREVIOUS_SEASON } from '@/lib/constants';
import { clubByAbbr } from '@/lib/clubs';
import { getTeamColour } from '@/lib/team-colours';
import { priorFor } from '@/lib/ratings/priors';
import {
  MODEL_VERSION,
  PRESEASON_MATCHDAY,
  getPublishedProjections,
  isLedgerConfigured,
} from '@/lib/ledger/projections';
import { getMarketView } from '@/lib/ledger/market';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: `Preseason Ledger ${CURRENT_SEASON} | Keepwatch`,
  description: `Keepwatch's locked ${CURRENT_SEASON} projections, published before a ball was kicked and scored for the rest of the season.`,
};

/** Disagreement with the market worth calling out, in percentage points. */
const NOTABLE_DISAGREEMENT_PP = 5;

function pct(value: number | null | undefined, dp = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `${value.toFixed(dp)}%`;
}

function Histogram({ distribution, colour }: { distribution: number[]; colour: string }) {
  const max = Math.max(...distribution, 0.0001);
  return (
    <div className="flex h-8 items-end gap-[1px]" aria-hidden>
      {distribution.map((p, i) => (
        <div
          key={i}
          className="flex-1 rounded-t-[1px]"
          style={{
            height: `${Math.max(2, (p / max) * 100)}%`,
            background: colour,
            opacity: 0.25 + 0.75 * (p / max),
          }}
          title={`${i + 1}${i === 0 ? 'st' : i === 1 ? 'nd' : i === 2 ? 'rd' : 'th'}: ${(p * 100).toFixed(1)}%`}
        />
      ))}
    </div>
  );
}

export default async function LedgerPage() {
  if (!isLedgerConfigured()) {
    return (
      <Shell>
        <p className="text-[13px] text-white/50">
          The Ledger is not configured — Supabase credentials are missing, so there is nothing
          to read. No projection is shown rather than a projection computed now, because a
          number generated on page load is not a record of anything.
        </p>
      </Shell>
    );
  }

  const projections = await getPublishedProjections();

  if (projections.length === 0) {
    return (
      <Shell>
        <p className="text-[13px] leading-6 text-white/50">
          No projection has been published for {CURRENT_SEASON} yet. Once it is, this page
          will not change again.
        </p>
      </Shell>
    );
  }

  const market = await getMarketView(projections[0].created_at);
  const publishedAt = new Date(projections[0].created_at);

  const rows = projections.map((p) => {
    const marketTitle = market.title[p.team];
    const marketReleg = market.relegation[p.team];
    return {
      ...p,
      name: clubByAbbr(p.team)?.name ?? p.team,
      colour: getTeamColour(p.team),
      prior: priorFor(p.team),
      marketTitle,
      marketReleg,
      dTitle: marketTitle === undefined ? null : p.champion_pct - marketTitle,
      dReleg: marketReleg === undefined ? null : p.relegation_pct - marketReleg,
    };
  });

  const disagreements = rows
    .map((r) => {
      const title = r.dTitle === null ? 0 : Math.abs(r.dTitle);
      const releg = r.dReleg === null ? 0 : Math.abs(r.dReleg);
      const useReleg = releg >= title;
      return {
        name: r.name,
        team: r.team,
        metric: useReleg ? 'relegation' : 'title',
        delta: useReleg ? r.dReleg : r.dTitle,
        model: useReleg ? r.relegation_pct : r.champion_pct,
        marketValue: useReleg ? r.marketReleg : r.marketTitle,
      };
    })
    .filter((d) => d.delta !== null && Math.abs(d.delta) > NOTABLE_DISAGREEMENT_PP)
    .sort((a, b) => Math.abs(b.delta as number) - Math.abs(a.delta as number));

  return (
    <Shell>
      <div className="mb-8 rounded-lg border border-amber-400/25 bg-amber-400/[0.05] p-5">
        <div className="mb-2 font-oswald text-[10px] uppercase tracking-[0.2em] text-amber-300/70">
          Model confidence
        </div>
        <p className="font-oswald text-[26px] leading-tight text-white/90">
          0% evidence &nbsp;/&nbsp; 100% preseason prior
        </p>
        <p className="mt-2 text-[12.5px] leading-6 text-white/55">
          Not one match of {CURRENT_SEASON} had been played when these numbers were
          generated. Every figure below rests entirely on preseason ratings, which means
          they carry a different kind of uncertainty from the same figures in April. They
          will move a great deal, and quickly. That is the point of writing them down.
        </p>
      </div>

      <section className="mb-10 space-y-4 text-[13px] leading-6 text-white/65">
        <p>
          This is a forecast, locked and timestamped before the season started, so it can be
          marked. It will not be edited. If it turns out badly it stays here saying so — a
          record you can quietly revise is not a record, and a forecast nobody scores carries
          no information at all.
        </p>
        <p>
          <strong className="text-white/80">Where the numbers come from.</strong> Seventeen
          clubs are rated from their {PREVIOUS_SEASON} finishing points, pulled 45% of the way
          toward the league average — one season is a noisy guide to how good a team really is,
          and squads change over a summer. How far to pull them was calibrated against the
          betting market, not guessed. The three promoted clubs have no Premier League season
          to carry over, so their ratings come from the market directly. Tottenham are the one
          continuing club overridden by hand, after a summer the previous season&apos;s table
          cannot see.
        </p>
        <p>
          <strong className="text-white/80">What this is not.</strong> It is not a prediction
          of the table. The most likely single outcome for most clubs is still fairly unlikely
          — the histograms show how wide each range is, and they are wide. Goal difference in
          the simulation does not yet depend on who is playing, which flattens the extremes.
          And there is no injury, transfer or fixture-congestion modelling in here at all.
        </p>
      </section>

      <section className="mb-10">
        <h2 className="mb-3 font-oswald text-[11px] uppercase tracking-[0.2em] text-white/40">
          Projected table
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] border-collapse text-[12.5px]">
            <thead>
              <tr className="border-b border-white/10 text-left text-[10px] uppercase tracking-[0.14em] text-white/35">
                <th className="py-2 pr-2 font-normal">#</th>
                <th className="py-2 pr-3 font-normal">Club</th>
                <th className="py-2 pr-3 text-right font-normal">Rating</th>
                <th className="py-2 pr-3 text-right font-normal">Pts</th>
                <th className="py-2 pr-3 text-right font-normal">Title</th>
                <th className="py-2 pr-3 text-right font-normal">Top 4</th>
                <th className="py-2 pr-3 text-right font-normal">Top 7</th>
                <th className="py-2 pr-3 text-right font-normal">Releg.</th>
                <th className="py-2 pl-2 font-normal">Finishing position</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.team} className="border-b border-white/[0.05]">
                  <td className="py-2 pr-2 font-mono text-white/35">{i + 1}</td>
                  <td className="py-2 pr-3">
                    <span className="inline-flex items-center gap-2">
                      <span
                        className="inline-block h-2.5 w-2.5 rounded-sm"
                        style={{ background: r.colour }}
                      />
                      <span className="text-white/85">{r.name}</span>
                      {r.prior?.from === 'market_relegation' && (
                        <span
                          className="rounded border border-white/15 px-1 text-[9px] uppercase tracking-wider text-white/40"
                          title={r.prior.note ?? 'Rating set from the betting market'}
                        >
                          mkt
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="py-2 pr-3 text-right font-mono text-white/45">
                    {r.prior?.elo ?? '—'}
                  </td>
                  <td className="py-2 pr-3 text-right font-mono text-white/75">
                    {r.avg_points.toFixed(1)}
                  </td>
                  <td className="py-2 pr-3 text-right font-mono text-white/60">
                    {pct(r.champion_pct)}
                  </td>
                  <td className="py-2 pr-3 text-right font-mono text-white/60">
                    {pct(r.top4_pct)}
                  </td>
                  <td className="py-2 pr-3 text-right font-mono text-white/60">
                    {pct(r.top7_pct)}
                  </td>
                  <td className="py-2 pr-3 text-right font-mono text-white/60">
                    {pct(r.relegation_pct)}
                  </td>
                  <td className="w-[190px] py-2 pl-2">
                    <Histogram distribution={r.position_distribution} colour={r.colour} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-[11px] leading-5 text-white/30">
          Ordered by expected finishing position. The bars show the full distribution of
          finishing positions, 1st on the left to 20th on the right — their width is the
          uncertainty, and it is most of the story.
        </p>
      </section>

      <section className="mb-10">
        <h2 className="mb-3 font-oswald text-[11px] uppercase tracking-[0.2em] text-white/40">
          Where Keepwatch disagrees with the market
        </h2>
        {market.capturedAt === null ? (
          <p className="text-[12.5px] text-white/45">
            No market snapshot was captured at publication time, so there is nothing to
            compare against.
          </p>
        ) : disagreements.length === 0 ? (
          <p className="text-[12.5px] text-white/45">
            No club differs from the market by more than {NOTABLE_DISAGREEMENT_PP} percentage
            points.
          </p>
        ) : (
          <>
            <ul className="space-y-2 text-[12.5px] leading-6 text-white/65">
              {disagreements.map((d) => (
                <li key={`${d.team}-${d.metric}`} className="flex flex-wrap gap-x-2">
                  <span className="text-white/85">{d.name}</span>
                  <span className="text-white/35">{d.metric}</span>
                  <span className="font-mono text-white/70">
                    {pct(d.model)} vs market {pct(d.marketValue)}
                  </span>
                  <span
                    className={`font-mono ${(d.delta as number) > 0 ? 'text-amber-300/80' : 'text-teal-300/80'}`}
                  >
                    {(d.delta as number) > 0 ? '+' : ''}
                    {(d.delta as number).toFixed(1)}pp
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-[12px] leading-6 text-white/45">
              These are kept rather than corrected. A disagreement usually means one of three
              things: the rating is missing something the market can see, the simulation is not
              turning a fair rating into a fair distribution, or we are genuinely right and the
              market is wrong. At this point in the season the first is much the likeliest — and
              which one it was is precisely what the rest of the season settles. Adjusting every
              club toward the market would have produced a more comfortable page and a forecast
              that tested nothing.
            </p>
          </>
        )}
      </section>

      <footer className="border-t border-white/[0.07] pt-5 text-[11px] leading-6 text-white/30">
        <p>
          Published{' '}
          <time dateTime={publishedAt.toISOString()} className="text-white/50">
            {publishedAt.toUTCString()}
          </time>
          . Model <span className="font-mono text-white/50">{MODEL_VERSION}</span>, prior source{' '}
          <span className="font-mono text-white/50">{projections[0].prior_source}</span>,
          matchday {PRESEASON_MATCHDAY}.
          {market.capturedAt && (
            <>
              {' '}
              Market prices as captured{' '}
              <time dateTime={market.capturedAt} className="text-white/50">
                {new Date(market.capturedAt).toUTCString()}
              </time>
              .
            </>
          )}
        </p>
        <p className="mt-2">
          Written once and never edited. To publish a different model, a new version is added
          alongside this one and both are scored.
        </p>
      </footer>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-5xl px-5 py-12 sm:px-8">
      <nav className="mb-8 text-[11px] uppercase tracking-[0.16em] text-white/30">
        <Link href="/" className="transition-colors hover:text-white/60">
          ← Keepwatch
        </Link>
      </nav>
      <header className="mb-8">
        <h1 className="font-oswald text-[34px] leading-none text-white/90 sm:text-[42px]">
          The Preseason Ledger
        </h1>
        <p className="mt-2 font-oswald text-[12px] uppercase tracking-[0.2em] text-white/35">
          {CURRENT_SEASON} · locked before matchday 1
        </p>
      </header>
      {children}
    </main>
  );
}
