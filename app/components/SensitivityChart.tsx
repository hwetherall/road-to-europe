'use client';

import { SensitivityResult, Team } from '@/lib/types';

interface Props {
  results: SensitivityResult[];
  selectedTeam: string;
  teams: Team[];
  metricLabel: string;
}

function getTeamName(abbr: string, teams: Team[]): string {
  return teams.find((t) => t.abbr === abbr)?.name ?? abbr;
}

export default function SensitivityChart({
  results,
  selectedTeam,
  teams,
  metricLabel,
}: Props) {
  const sorted = [...results].sort((a, b) => b.maxAbsDelta - a.maxAbsDelta);
  const involvingSelected = sorted.filter(
    (r) => r.homeTeam === selectedTeam || r.awayTeam === selectedTeam
  );
  const notInvolvingSelected = sorted.filter(
    (r) => r.homeTeam !== selectedTeam && r.awayTeam !== selectedTeam
  );

  const preferredRows = [
    ...involvingSelected.slice(0, 3),
    ...notInvolvingSelected.slice(0, 2),
  ];

  // If there are not enough fixtures in one bucket, fill from remaining highest-impact rows.
  const usedIds = new Set(preferredRows.map((r) => r.fixtureId));
  const fallbackRows = sorted.filter((r) => !usedIds.has(r.fixtureId));
  const displayRows = [...preferredRows, ...fallbackRows].slice(0, 5);
  const teamName = getTeamName(selectedTeam, teams);

  if (displayRows.length === 0) {
    return (
      <div className="mb-8">
        <h2 className="font-oswald text-sm tracking-[0.15em] uppercase text-white/50 mb-2">
          High-Leverage Fixtures
        </h2>
        <p className="text-xs text-white/30 mb-4">
          Fixtures with the biggest impact on {teamName}&apos;s {metricLabel}. Green
          = good for {teamName}, red = bad.
        </p>
        <div className="border rounded-lg p-4 bg-white/[0.02] border-white/[0.08] text-xs text-white/50">
          No high-leverage fixtures for this metric right now. The selected outcome is
          effectively locked, so fixture-by-fixture sensitivity is not informative.
        </div>
      </div>
    );
  }

  const maxDelta = Math.max(...displayRows.map((r) => r.maxAbsDelta), 1);

  return (
    <div className="mb-8">
      <h2 className="font-oswald text-sm tracking-[0.15em] uppercase text-white/50 mb-2">
        High-Leverage Fixtures
      </h2>
      <p className="text-xs text-white/30 mb-4">
        Top 3 fixtures involving {teamName}, plus top 2 outside fixtures, by max impact on{' '}
        {teamName}&apos;s {metricLabel}. Green = good for {teamName}, red = bad.
      </p>
      <div className="space-y-2">
        {displayRows.map((r) => {
          const includesSelectedTeam =
            r.homeTeam === selectedTeam || r.awayTeam === selectedTeam;
          const deltas = [
            { label: `${getTeamName(r.homeTeam, teams)} win`, value: r.deltaIfHomeWin },
            { label: 'Draw', value: r.deltaIfDraw },
            { label: `${getTeamName(r.awayTeam, teams)} win`, value: r.deltaIfAwayWin },
          ];

          deltas.sort((a, b) => Math.abs(b.value) - Math.abs(a.value));

          return (
            <div
              key={r.fixtureId}
              className={`border rounded-lg p-3 ${
                includesSelectedTeam
                  ? 'bg-white/[0.03] border-white/[0.06]'
                  : 'bg-cyan-500/[0.08] border-cyan-400/20'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium">
                  {getTeamName(r.homeTeam, teams)}{' '}
                  <span className="text-white/30">vs</span>{' '}
                  {getTeamName(r.awayTeam, teams)}
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
