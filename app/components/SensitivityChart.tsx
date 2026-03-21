'use client';

import { SensitivityResult } from '@/lib/types';
import { HARDCODED_STANDINGS } from '@/lib/constants';

interface Props {
  results: SensitivityResult[];
}

function getTeamName(abbr: string): string {
  return HARDCODED_STANDINGS.find((t) => t.abbr === abbr)?.name ?? abbr;
}

export default function SensitivityChart({ results }: Props) {
  const top10 = results.slice(0, 10);
  const maxDelta = Math.max(...top10.map((r) => r.maxAbsDelta), 1);

  return (
    <div className="mb-8">
      <h2 className="font-oswald text-sm tracking-[0.15em] uppercase text-white/50 mb-2">
        High-Leverage Fixtures
      </h2>
      <p className="text-xs text-white/30 mb-4">
        Fixtures with the biggest impact on Newcastle&apos;s European odds. Green = good
        for Newcastle, red = bad.
      </p>
      <div className="space-y-2">
        {top10.map((r) => {
          // Find the most impactful result direction
          const deltas = [
            { label: `${getTeamName(r.homeTeam)} win`, value: r.deltaIfHomeWin },
            { label: 'Draw', value: r.deltaIfDraw },
            { label: `${getTeamName(r.awayTeam)} win`, value: r.deltaIfAwayWin },
          ];

          // Sort by absolute delta descending
          deltas.sort((a, b) => Math.abs(b.value) - Math.abs(a.value));

          return (
            <div
              key={r.fixtureId}
              className="bg-white/[0.03] border border-white/[0.06] rounded-lg p-3"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium">
                  {getTeamName(r.homeTeam)}{' '}
                  <span className="text-white/30">vs</span>{' '}
                  {getTeamName(r.awayTeam)}
                </span>
                <span className="text-xs text-white/40">
                  Max impact: {r.maxAbsDelta.toFixed(1)}pp
                </span>
              </div>
              <div className="flex gap-2">
                {deltas.map((d) => {
                  const isPositive = d.value > 0;
                  const width = (Math.abs(d.value) / maxDelta) * 100;
                  return (
                    <div key={d.label} className="flex-1">
                      <div className="text-[10px] text-white/40 mb-1 truncate">
                        {d.label}
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-2 rounded-sm bg-white/[0.06] overflow-hidden">
                          <div
                            className="h-full rounded-sm transition-all duration-500"
                            style={{
                              width: `${Math.min(width, 100)}%`,
                              background: isPositive ? '#22c55e' : '#ef4444',
                            }}
                          />
                        </div>
                        <span
                          className="text-[11px] font-mono min-w-[3.5rem] text-right"
                          style={{ color: isPositive ? '#22c55e' : '#ef4444' }}
                        >
                          {d.value > 0 ? '+' : ''}
                          {d.value.toFixed(1)}pp
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
