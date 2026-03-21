'use client';

import { Fixture, SensitivityResult, Team } from '@/lib/types';

interface Props {
  fixtures: Fixture[];
  locks: Record<string, 'home' | 'draw' | 'away'>;
  onToggleLock: (fixtureId: string, result: 'home' | 'draw' | 'away') => void;
  onResetAll: () => void;
  selectedTeam: string;
  sensitivityResults: SensitivityResult[] | null;
  teams: Team[];
}

function getTeamName(abbr: string, teams: Team[]): string {
  return teams.find((t) => t.abbr === abbr)?.name ?? abbr;
}

export default function WhatIfPanel({
  fixtures,
  locks,
  onToggleLock,
  onResetAll,
  selectedTeam,
  sensitivityResults,
  teams,
}: Props) {
  const scheduled = fixtures.filter((f) => f.status === 'SCHEDULED');

  // Group by matchday
  const byMatchday = new Map<number, Fixture[]>();
  for (const f of scheduled) {
    const md = f.matchday;
    if (!byMatchday.has(md)) byMatchday.set(md, []);
    byMatchday.get(md)!.push(f);
  }
  const matchdays = [...byMatchday.entries()].sort((a, b) => a[0] - b[0]);

  // High-leverage fixture IDs (top 15)
  const highLeverage = new Set(
    (sensitivityResults ?? []).slice(0, 15).map((r) => r.fixtureId)
  );

  const lockCount = Object.keys(locks).length;

  return (
    <div className="mb-8">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-oswald text-sm tracking-[0.15em] uppercase text-white/50">
          Lock Fixture Outcomes
        </h2>
        {lockCount > 0 && (
          <button
            onClick={onResetAll}
            className="text-[11px] text-red-400/70 hover:text-red-400 bg-transparent border border-red-400/20 hover:border-red-400/40 rounded px-3 py-1 transition-colors cursor-pointer"
          >
            Reset All ({lockCount})
          </button>
        )}
      </div>
      <div className="space-y-5">
        {matchdays.map(([md, mdFixtures]) => (
          <div key={md}>
            <div className="text-[10px] text-white/30 tracking-widest uppercase mb-2">
              Matchday {md}
            </div>
            <div className="space-y-1.5">
              {mdFixtures.map((f) => {
                const isTeamFixture =
                  f.homeTeam === selectedTeam || f.awayTeam === selectedTeam;
                const isHighLeverage = highLeverage.has(f.id);
                const currentLock = locks[f.id] ?? null;

                return (
                  <div
                    key={f.id}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors ${
                      isTeamFixture
                        ? 'bg-white/[0.04] border-white/[0.12]'
                        : 'bg-white/[0.02] border-white/[0.06]'
                    }`}
                  >
                    {/* High leverage badge */}
                    {isHighLeverage && (
                      <span className="text-[8px] font-bold text-amber-400/80 bg-amber-400/10 rounded px-1.5 py-0.5 tracking-wider shrink-0">
                        HIGH
                      </span>
                    )}

                    {/* Teams */}
                    <div className="flex-1 min-w-0">
                      <span
                        className={`text-xs ${
                          f.homeTeam === selectedTeam
                            ? 'font-bold text-white'
                            : 'text-white/70'
                        }`}
                      >
                        {getTeamName(f.homeTeam, teams)}
                      </span>
                      <span className="text-white/25 text-xs mx-1.5">vs</span>
                      <span
                        className={`text-xs ${
                          f.awayTeam === selectedTeam
                            ? 'font-bold text-white'
                            : 'text-white/70'
                        }`}
                      >
                        {getTeamName(f.awayTeam, teams)}
                      </span>
                    </div>

                    {/* Lock buttons */}
                    <div className="flex gap-1 shrink-0">
                      {(['home', 'draw', 'away'] as const).map((result) => {
                        const isLocked = currentLock === result;
                        const label = result === 'home' ? 'H' : result === 'draw' ? 'D' : 'A';
                        const lockColor =
                          result === 'home'
                            ? '#22c55e'
                            : result === 'draw'
                            ? '#888'
                            : '#ef4444';

                        return (
                          <button
                            key={result}
                            onClick={() => onToggleLock(f.id, result)}
                            className={`w-7 h-7 rounded text-[10px] font-bold transition-all cursor-pointer border ${
                              isLocked
                                ? 'text-white'
                                : 'text-white/40 border-white/10 hover:border-white/30 bg-transparent'
                            }`}
                            style={
                              isLocked
                                ? { background: lockColor, borderColor: lockColor }
                                : undefined
                            }
                            title={
                              result === 'home'
                                ? `${getTeamName(f.homeTeam, teams)} win`
                                : result === 'away'
                                ? `${getTeamName(f.awayTeam, teams)} win`
                                : 'Draw'
                            }
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
