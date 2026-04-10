'use client';

import { SensitivityMetric, SensitivityResult, Team } from '@/lib/types';

interface Props {
  results: SensitivityResult[];
  selectedTeam: string;
  teams: Team[];
  metricLabel: string;
  baselineValue?: number | null;
  metricOptions?: { key: SensitivityMetric; label: string }[];
  activeMetric?: SensitivityMetric;
  onMetricChange?: (metric: SensitivityMetric) => void;
}

function getTeamName(abbr: string, teams: Team[]): string {
  return teams.find((t) => t.abbr === abbr)?.name ?? abbr;
}

export default function SensitivityChart({
  results,
  selectedTeam,
  teams,
  metricLabel,
  metricOptions,
  activeMetric,
  onMetricChange,
}: Props) {
  // Compute spread (best - worst outcome) for each fixture and sort by it
  const withSpread = results.map((r) => {
    const deltas = [r.deltaIfHomeWin, r.deltaIfDraw, r.deltaIfAwayWin];
    const best = Math.max(...deltas);
    const worst = Math.min(...deltas);
    return { ...r, spread: best - worst };
  });
  withSpread.sort((a, b) => b.spread - a.spread);

  const involvingSelected = withSpread.filter(
    (r) => r.homeTeam === selectedTeam || r.awayTeam === selectedTeam
  );
  const notInvolvingSelected = withSpread.filter(
    (r) => r.homeTeam !== selectedTeam && r.awayTeam !== selectedTeam
  );

  const preferredRows = [
    ...involvingSelected.slice(0, 3),
    ...notInvolvingSelected.slice(0, 2),
  ];

  const usedIds = new Set(preferredRows.map((r) => r.fixtureId));
  const fallbackRows = withSpread.filter((r) => !usedIds.has(r.fixtureId));
  const displayRows = [...preferredRows, ...fallbackRows].slice(0, 5);
  const teamName = getTeamName(selectedTeam, teams);

  if (displayRows.length === 0) {
    return (
      <div className="mb-8">
        <h2 className="font-oswald text-sm tracking-[0.15em] uppercase text-white/50 mb-2">
          Games That Matter
        </h2>
        <div className="border rounded-lg p-4 bg-white/[0.02] border-white/[0.08] text-xs text-white/50">
          No high-leverage fixtures for this metric right now.
        </div>
      </div>
    );
  }

  // Max absolute delta across all displayed fixtures — used to scale bars
  const maxAbsDelta = Math.max(
    ...displayRows.flatMap((r) => [
      Math.abs(r.deltaIfHomeWin),
      Math.abs(r.deltaIfDraw),
      Math.abs(r.deltaIfAwayWin),
    ]),
    0.5
  );

  return (
    <div className="mb-8">
      <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
        <h2 className="font-oswald text-sm tracking-[0.15em] uppercase text-white/50">
          Games That Matter
        </h2>
        {metricOptions && metricOptions.length > 1 && onMetricChange && (
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-white/30 uppercase tracking-wider">Measuring</span>
            <div className="flex gap-1">
              {metricOptions.map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => onMetricChange(opt.key)}
                  className={`px-2.5 py-1 rounded text-[11px] font-medium transition-all cursor-pointer border ${
                    activeMetric === opt.key
                      ? 'bg-white/[0.12] text-white/90 border-white/[0.2]'
                      : 'bg-transparent text-white/35 border-white/[0.06] hover:text-white/55 hover:border-white/[0.12]'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      <p className="text-xs text-white/30 mb-4">
        How much {teamName}&apos;s {metricLabel} change depending on the result.
      </p>
      <div className="space-y-2">
        {displayRows.map((r) => {
          const includesSelectedTeam =
            r.homeTeam === selectedTeam || r.awayTeam === selectedTeam;

          // Build outcomes using absolute values from the sensitivity scan
          const outcomes = [
            {
              label: `${getTeamName(r.homeTeam, teams)} win`,
              delta: r.deltaIfHomeWin,
              abs: r.absIfHomeWin,
            },
            {
              label: 'Draw',
              delta: r.deltaIfDraw,
              abs: r.absIfDraw,
            },
            {
              label: `${getTeamName(r.awayTeam, teams)} win`,
              delta: r.deltaIfAwayWin,
              abs: r.absIfAwayWin,
            },
          ];

          // Sort best to worst for selected team
          outcomes.sort((a, b) => b.delta - a.delta);

          const bestOutcome = outcomes[0];
          const worstOutcome = outcomes[outcomes.length - 1];

          return (
            <div
              key={r.fixtureId}
              className={`border rounded-lg p-3 ${
                includesSelectedTeam
                  ? 'bg-white/[0.03] border-white/[0.08]'
                  : 'bg-cyan-500/[0.06] border-cyan-400/15'
              }`}
            >
              {/* Header: teams + spread */}
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium">
                  {getTeamName(r.homeTeam, teams)}{' '}
                  <span className="text-white/30">vs</span>{' '}
                  {getTeamName(r.awayTeam, teams)}
                </span>
                <span className="text-xs text-white/40 font-mono">
                  {r.spread.toFixed(1)}pp swing
                </span>
              </div>

              {/* Center-emanating bar */}
              <div className="relative h-5 mb-2">
                {/* Track background */}
                <div className="absolute inset-0 rounded bg-white/[0.04]" />
                {/* Center line */}
                <div className="absolute left-1/2 top-0 bottom-0 w-px bg-white/[0.15]" />

                {/* Red bar (worst outcome — grows left from center) */}
                {worstOutcome.delta < 0 && (
                  <div
                    className="absolute top-0.5 bottom-0.5 rounded-l transition-all duration-500"
                    style={{
                      right: '50%',
                      width: `${(Math.abs(worstOutcome.delta) / maxAbsDelta) * 50}%`,
                      background: 'linear-gradient(270deg, #ef4444cc, #ef444455)',
                    }}
                  />
                )}

                {/* Green bar (best outcome — grows right from center) */}
                {bestOutcome.delta > 0 && (
                  <div
                    className="absolute top-0.5 bottom-0.5 rounded-r transition-all duration-500"
                    style={{
                      left: '50%',
                      width: `${(Math.abs(bestOutcome.delta) / maxAbsDelta) * 50}%`,
                      background: 'linear-gradient(90deg, #22c55ecc, #22c55e55)',
                    }}
                  />
                )}
              </div>

              {/* Outcome labels */}
              <div className="flex items-center justify-between gap-2 text-[11px]">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="font-mono font-semibold text-red-400 shrink-0">
                    {worstOutcome.abs.toFixed(1)}%
                  </span>
                  <span className="text-white/40 truncate">{worstOutcome.label}</span>
                </div>

                <div className="text-white/25 text-[10px] shrink-0 text-center">
                  {outcomes[1].abs.toFixed(1)}% {outcomes[1].label.toLowerCase()}
                </div>

                <div className="flex items-center gap-1.5 min-w-0 justify-end">
                  <span className="text-white/40 truncate">{bestOutcome.label}</span>
                  <span className="font-mono font-semibold text-green-400 shrink-0">
                    {bestOutcome.abs.toFixed(1)}%
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
