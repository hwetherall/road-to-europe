'use client';

import { Team } from '@/lib/types';

interface Props {
  teams: Team[];
  selectedTeam: string;
  accentColor: string;
}

const ZONE_COLORS: Record<string, string> = {
  ucl: 'bg-green-900/30',
  ucl5: 'bg-blue-900/30',
  uel: 'bg-orange-900/30',
  uecl: 'bg-teal-900/30',
  rel: 'bg-red-900/30',
};

function getZone(position: number): string | null {
  if (position < 4) return 'ucl';
  if (position === 4) return 'ucl5';
  if (position === 5) return 'uel';
  if (position === 6) return 'uecl';
  if (position >= 17) return 'rel';
  return null;
}

export default function StandingsTable({ teams, selectedTeam, accentColor }: Props) {
  const sorted = [...teams].sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.goalDifference !== a.goalDifference)
      return b.goalDifference - a.goalDifference;
    return b.goalsFor - a.goalsFor;
  });

  return (
    <div className="mb-8">
      <h2 className="font-oswald text-sm tracking-[0.15em] uppercase text-white/50 mb-4">
        Current Standings
      </h2>
      <div className="bg-white/[0.02] border border-white/[0.06] rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/[0.08]">
                {['#', 'Team', 'P', 'W', 'D', 'L', 'GD', 'Pts'].map((h) => (
                  <th
                    key={h}
                    className={`px-3 py-2.5 text-[10px] tracking-widest uppercase font-semibold text-white/35 ${
                      h === 'Team' ? 'text-left' : 'text-center'
                    }`}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((t, i) => {
                const isSelected = t.abbr === selectedTeam;
                const zone = getZone(i);
                return (
                  <tr
                    key={t.abbr}
                    className={`border-b border-white/[0.04] ${
                      isSelected
                        ? ''
                        : zone
                        ? ZONE_COLORS[zone]
                        : ''
                    }`}
                    style={
                      isSelected
                        ? {
                            borderLeft: `3px solid ${accentColor}`,
                            background: `${accentColor}11`,
                          }
                        : undefined
                    }
                  >
                    <td className="px-3 py-2.5 text-center text-white/35 text-xs">
                      {i + 1}
                    </td>
                    <td
                      className={`px-3 py-2.5 ${
                        isSelected ? 'font-bold' : 'text-white/85'
                      }`}
                      style={isSelected ? { color: accentColor } : undefined}
                    >
                      {t.name}
                    </td>
                    <td className="px-3 py-2.5 text-center text-white/40">
                      {t.played}
                    </td>
                    <td className="px-3 py-2.5 text-center text-white/40">
                      {t.won}
                    </td>
                    <td className="px-3 py-2.5 text-center text-white/40">
                      {t.drawn}
                    </td>
                    <td className="px-3 py-2.5 text-center text-white/40">
                      {t.lost}
                    </td>
                    <td
                      className={`px-3 py-2.5 text-center ${
                        t.goalDifference > 0
                          ? 'text-teal-400'
                          : t.goalDifference < 0
                          ? 'text-red-400'
                          : 'text-white/40'
                      }`}
                    >
                      {t.goalDifference > 0 ? '+' : ''}
                      {t.goalDifference}
                    </td>
                    <td className="px-3 py-2.5 text-center font-bold">
                      {t.points}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <div className="flex gap-4 mt-2.5 text-[10px] text-white/30 flex-wrap">
        <span>
          <span className="inline-block w-2 h-2 rounded-sm bg-green-900/50 mr-1" />{' '}
          Champions League
        </span>
        <span>
          <span className="inline-block w-2 h-2 rounded-sm bg-blue-900/50 mr-1" />{' '}
          UCL (5th)
        </span>
        <span>
          <span className="inline-block w-2 h-2 rounded-sm bg-orange-900/50 mr-1" />{' '}
          Europa League
        </span>
        <span>
          <span className="inline-block w-2 h-2 rounded-sm bg-teal-900/50 mr-1" />{' '}
          Conference League
        </span>
        <span>
          <span className="inline-block w-2 h-2 rounded-sm bg-red-900/50 mr-1" />{' '}
          Relegation
        </span>
      </div>
    </div>
  );
}
