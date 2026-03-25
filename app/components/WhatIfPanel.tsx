'use client';

import { CardConfig, Fixture, SensitivityResult, SimulationResult, Team } from '@/lib/types';
import KyleQualCards from './KyleQualCards';
import KyleMiniHistogram from './KyleMiniHistogram';

interface Props {
  fixtures: Fixture[];
  locks: Record<string, 'home' | 'draw' | 'away'>;
  onToggleLock: (fixtureId: string, result: 'home' | 'draw' | 'away') => void;
  onResetAll: () => void;
  selectedTeam: string;
  sensitivityResults: SensitivityResult[] | null;
  teams: Team[];
  displayResult: SimulationResult | null;
  baselineResult: SimulationResult | null;
  cards: CardConfig[];
  hasActiveChapters: boolean;
  numSims: number;
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
  displayResult,
  baselineResult,
  cards,
  hasActiveChapters,
  numSims,
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
  const selectedTeamName = getTeamName(selectedTeam, teams);

  return (
    <div className="mb-8">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-oswald text-sm tracking-[0.15em] uppercase text-white/65">
          Try Match Outcomes
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
      <div className="text-[11px] text-white/38 mb-4">
        Pick <span className="text-white/65 font-semibold">H</span>, <span className="text-white/65 font-semibold">D</span>, or <span className="text-white/65 font-semibold">A</span> to force a result: home win, draw, or away win.
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
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
                      {/* Teams */}
                      <div className="flex-1 min-w-0 flex items-center justify-between gap-2">
                        <div className="min-w-0">
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
                        {isHighLeverage && (
                          <span className="text-[8px] font-bold text-amber-300/90 bg-amber-400/12 border border-amber-400/25 rounded px-2 py-0.5 tracking-wider shrink-0">
                            HIGH IMPACT
                          </span>
                        )}
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
                                  ? `Lock outcome: ${getTeamName(f.homeTeam, teams)} win`
                                  : result === 'away'
                                  ? `Lock outcome: ${getTeamName(f.awayTeam, teams)} win`
                                  : 'Lock outcome: draw'
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

        <aside className="lg:sticky lg:top-4 h-fit bg-white/[0.02] border border-white/[0.08] rounded-xl p-4">
          <div className="font-oswald text-[10px] tracking-[0.12em] uppercase text-white/40 mb-1">
            Live Match Outcomes View
          </div>
          <div className="text-[11px] text-white/30 mb-3">
            Updates as you lock outcomes for {selectedTeamName}.
          </div>
          {displayResult ? (
            <>
              {cards.length > 0 && (
                <div className="mb-4">
                  <KyleQualCards
                    result={displayResult}
                    baselineResult={baselineResult}
                    cards={cards.slice(0, 3)}
                    hasActiveChapters={hasActiveChapters}
                  />
                </div>
              )}
              <div>
                <div className="text-[9px] tracking-[0.1em] uppercase text-white/30 mb-2">
                  Position Distribution
                </div>
                <KyleMiniHistogram result={displayResult} numSims={numSims} />
              </div>
            </>
          ) : (
            <div className="text-[12px] text-white/40">
              Run the simulation to unlock the live mini dashboard.
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
