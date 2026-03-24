'use client';

import { useState } from 'react';
import { SimulationResult, Team } from '@/lib/types';

interface Props {
  results: SimulationResult[];
  selectedTeam: string;
  accentColor: string;
  textAccentColor: string;
  teams: Team[];
}

function getTeamName(abbr: string, teams: Team[]): string {
  return teams.find((t) => t.abbr === abbr)?.name ?? abbr;
}

function getTeamPoints(abbr: string, teams: Team[]): number {
  return teams.find((t) => t.abbr === abbr)?.points ?? 0;
}

export default function LeagueProjections({ results, selectedTeam, accentColor, textAccentColor, teams }: Props) {
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
                    'Champ',
                    'Top 4',
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
                  const isSelected = r.team === selectedTeam;
                  return (
                    <tr
                      key={r.team}
                      className={`border-b border-white/[0.04]`}
                      style={
                        isSelected
                          ? { background: `${accentColor}11` }
                          : undefined
                      }
                    >
                      <td className="px-2.5 py-2.5 text-center text-white/35 text-xs">
                        {i + 1}
                      </td>
                      <td
                        className={`px-2.5 py-2.5 ${
                          isSelected ? 'font-bold' : 'text-white/80'
                        }`}
                        style={isSelected ? { color: textAccentColor } : undefined}
                      >
                        {getTeamName(r.team, teams)}
                      </td>
                      <td className="px-2.5 py-2.5 text-center font-semibold">
                        {getTeamPoints(r.team, teams)}
                      </td>
                      <td className="px-2.5 py-2.5 text-center text-white/50">
                        {r.avgPoints.toFixed(1)}
                      </td>
                      <td
                        className="px-2.5 py-2.5 text-center"
                        style={{
                          color: r.championPct > 10 ? '#FFD700' : 'rgba(255,255,255,0.35)',
                        }}
                      >
                        {r.championPct.toFixed(1)}%
                      </td>
                      <td
                        className="px-2.5 py-2.5 text-center"
                        style={{
                          color: r.top4Pct > 50 ? '#22c55e' : 'rgba(255,255,255,0.5)',
                        }}
                      >
                        {r.top4Pct.toFixed(1)}%
                      </td>
                      <td
                        className="px-2.5 py-2.5 text-center"
                        style={{
                          color: r.top7Pct > 50 ? '#00ddbb' : 'rgba(255,255,255,0.5)',
                        }}
                      >
                        {r.top7Pct.toFixed(1)}%
                      </td>
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
