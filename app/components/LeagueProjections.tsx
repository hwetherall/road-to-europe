'use client';

import { useState } from 'react';
import { SimulationResult } from '@/lib/types';
import { HARDCODED_STANDINGS } from '@/lib/constants';

interface Props {
  results: SimulationResult[];
}

function getTeamName(abbr: string): string {
  return HARDCODED_STANDINGS.find((t) => t.abbr === abbr)?.name ?? abbr;
}

function getTeamPoints(abbr: string): number {
  return HARDCODED_STANDINGS.find((t) => t.abbr === abbr)?.points ?? 0;
}

export default function LeagueProjections({ results }: Props) {
  const [expanded, setExpanded] = useState(false);

  const sorted = [...results].sort((a, b) => a.avgPosition - b.avgPosition);

  return (
    <div className="mb-8">
      <button
        onClick={() => setExpanded(!expanded)}
        className="bg-transparent border border-white/[0.12] text-white/60 px-5 py-2 rounded-md text-xs tracking-widest uppercase cursor-pointer hover:border-white/20 transition-colors"
      >
        {expanded ? 'Hide' : 'Show'} Full League Projections
      </button>

      {expanded && (
        <div className="mt-4 bg-white/[0.02] border border-white/[0.06] rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/[0.08]">
                  {[
                    '#',
                    'Team',
                    'Pts',
                    'Avg Pts',
                    'Top 4',
                    'Top 5',
                    'Top 6',
                    'Top 7',
                    'Releg.',
                  ].map((h) => (
                    <th
                      key={h}
                      className={`px-2.5 py-3 text-[10px] tracking-widest uppercase font-semibold text-white/40 ${
                        h === 'Team' ? 'text-left' : 'text-center'
                      }`}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map((r, i) => {
                  const isNew = r.team === 'NEW';
                  return (
                    <tr
                      key={r.team}
                      className={`border-b border-white/[0.04] ${
                        isNew ? 'bg-teal-500/[0.08]' : ''
                      }`}
                    >
                      <td className="px-2.5 py-2.5 text-center text-white/35 text-xs">
                        {i + 1}
                      </td>
                      <td
                        className={`px-2.5 py-2.5 ${
                          isNew
                            ? 'font-bold text-teal-400'
                            : 'text-white/80'
                        }`}
                      >
                        {getTeamName(r.team)}
                      </td>
                      <td className="px-2.5 py-2.5 text-center font-semibold">
                        {getTeamPoints(r.team)}
                      </td>
                      <td className="px-2.5 py-2.5 text-center text-white/50">
                        {r.avgPoints.toFixed(1)}
                      </td>
                      {[r.top4Pct, r.top5Pct, r.top6Pct, r.top7Pct].map(
                        (v, j) => (
                          <td
                            key={j}
                            className="px-2.5 py-2.5 text-center"
                            style={{
                              color: v > 50 ? '#00ddbb' : 'rgba(255,255,255,0.5)',
                            }}
                          >
                            {v.toFixed(1)}%
                          </td>
                        )
                      )}
                      <td
                        className="px-2.5 py-2.5 text-center"
                        style={{
                          color:
                            r.relegationPct > 30
                              ? '#ff4444'
                              : 'rgba(255,255,255,0.35)',
                        }}
                      >
                        {r.relegationPct.toFixed(1)}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
