'use client';

import { useState } from 'react';
import { SensitivityResult } from '@/lib/types';

interface Props {
  sensitivityResults: SensitivityResult[] | null;
  selectedTeam: string;
  metricLabel: string;
  baselineValue: number | null;
}

export default function KyleLeverageList({
  sensitivityResults,
  selectedTeam,
  metricLabel,
  baselineValue,
}: Props) {
  const [expandedFixtureId, setExpandedFixtureId] = useState<string | null>(null);

  if (!sensitivityResults) {
    // Skeleton loading
    return (
      <div className="space-y-1.5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex justify-between items-center h-[28px]">
            <div className="h-3 bg-white/[0.06] rounded w-32 animate-pulse" />
            <div className="h-3 bg-white/[0.06] rounded w-10 animate-pulse" />
          </div>
        ))}
      </div>
    );
  }

  const top5 = sensitivityResults.slice(0, 5);

  if (top5.length === 0) {
    return (
      <div className="text-[10px] text-white/30 py-2">
        No high-leverage fixtures found
      </div>
    );
  }

  const formatDelta = (value: number): string => {
    const abs = Math.abs(value);
    if (abs < 0.05) return '0.0pp';
    return `${value > 0 ? '+' : ''}${value.toFixed(1)}pp`;
  };

  const formatPct = (value: number): string => `${Math.max(0, Math.min(100, value)).toFixed(1)}%`;

  return (
    <div>
      <div className="text-[9px] text-white/35 mb-2 leading-4">
        +pp/-pp = change in {metricLabel}. Showing strongest single-outcome impact.
      </div>
      {baselineValue !== null && (
        <div className="text-[9px] text-white/35 mb-2">
          Current {metricLabel}: <span className="text-white/60">{baselineValue.toFixed(1)}%</span>
        </div>
      )}

      <div className="space-y-0.5">
      {top5.map((fixture) => {
        const outcomes = [
          { key: 'home', label: `${fixture.homeTeam} win`, val: fixture.deltaIfHomeWin },
          { key: 'draw', label: 'Draw', val: fixture.deltaIfDraw },
          { key: 'away', label: `${fixture.awayTeam} win`, val: fixture.deltaIfAwayWin },
        ];
        const strongest = outcomes.reduce((a, b) => (Math.abs(b.val) > Math.abs(a.val) ? b : a));
        const sortedOutcomes = [...outcomes].sort((a, b) => b.val - a.val);
        const isPositive = strongest.val > 0;
        const isNegative = strongest.val < 0;
        const isExpanded = expandedFixtureId === fixture.fixtureId;

        return (
          <div key={fixture.fixtureId} className="py-0.5">
            <button
              type="button"
              onClick={() =>
                setExpandedFixtureId((prev) => (prev === fixture.fixtureId ? null : fixture.fixtureId))
              }
              className="w-full flex justify-between items-center h-[28px] text-left"
              aria-expanded={isExpanded}
            >
              <span className="text-[11px] text-white/60 truncate mr-2">
                <span className={fixture.homeTeam === selectedTeam ? 'text-white/90 font-semibold' : ''}>
                  {fixture.homeTeam}
                </span>
                {' vs '}
                <span className={fixture.awayTeam === selectedTeam ? 'text-white/90 font-semibold' : ''}>
                  {fixture.awayTeam}
                </span>
              </span>
              <span
                className="text-[11px] font-bold shrink-0 tabular-nums text-right min-w-[58px]"
                style={{
                  color: isPositive ? '#00ddb3' : isNegative ? '#ff5c5c' : 'rgba(255,255,255,0.55)',
                }}
              >
                {formatDelta(strongest.val)}
              </span>
            </button>

            {isExpanded && (
              <div className="ml-1 mt-1 mb-1 border-l border-white/[0.08] pl-2 space-y-1">
                {sortedOutcomes.map((outcome) => (
                  <div key={outcome.key} className="flex items-center justify-between gap-2 text-[10px]">
                    <span className="text-white/45 truncate">{outcome.label}</span>
                    <span
                      className="tabular-nums shrink-0"
                      style={{
                        color:
                          outcome.val > 0
                            ? '#00ddb3'
                            : outcome.val < 0
                              ? '#ff5c5c'
                              : 'rgba(255,255,255,0.55)',
                      }}
                    >
                      {formatDelta(outcome.val)}
                      {baselineValue !== null && ` -> ${formatPct(baselineValue + outcome.val)}`}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
      </div>
      <div className="text-[9px] text-white/25 mt-1">
        Tap a fixture to see all outcomes.
      </div>
    </div>
  );
}
