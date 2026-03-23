'use client';

import {
  Team,
  SimulationResult,
  SensitivityResult,
  CardConfig,
  SensitivityMetric,
} from '@/lib/types';
import KyleQualCards from './KyleQualCards';
import KyleMiniHistogram from './KyleMiniHistogram';
import KyleLeverageList from './KyleLeverageList';

interface Props {
  selectedTeam: string;
  teams: Team[];
  displayResult: SimulationResult | null;
  baselineResult: SimulationResult | null;
  sensitivityResults: SensitivityResult[] | null;
  cards: CardConfig[];
  hasActiveChapters: boolean;
  accentColor: string;
  numSims: number;
  sensitivityMetric: SensitivityMetric;
  sensitivityMetricLabel: string;
}

export default function KyleMiniDashboard({
  selectedTeam,
  teams,
  displayResult,
  baselineResult,
  sensitivityResults,
  cards,
  hasActiveChapters,
  accentColor,
  numSims,
  sensitivityMetric,
  sensitivityMetricLabel,
}: Props) {
  const sortedTeams = [...teams].sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.goalDifference !== a.goalDifference) return b.goalDifference - a.goalDifference;
    return b.goalsFor - a.goalsFor;
  });
  const currentTeam = teams.find((t) => t.abbr === selectedTeam);
  const position = sortedTeams.findIndex((t) => t.abbr === selectedTeam) + 1;
  const suffix = position === 1 ? 'st' : position === 2 ? 'nd' : position === 3 ? 'rd' : 'th';

  return (
    <div className="w-[280px] shrink-0 bg-[#0d0d0d] border-r border-white/[0.06] h-full overflow-y-auto flex flex-col">
      {/* Team name + position pill */}
      <div className="px-4 pt-4 pb-3">
        <div className="flex items-center gap-2">
          <span className="font-oswald text-[13px] font-bold tracking-wider uppercase text-white/80">
            {currentTeam?.name ?? selectedTeam}
          </span>
          <span
            className="text-[10px] font-bold px-1.5 py-0.5 rounded"
            style={{ background: `${accentColor}25`, color: accentColor }}
          >
            {position}{suffix}
          </span>
        </div>
      </div>

      {/* Section 1: Qualification Cards */}
      {displayResult && (
        <div className="px-4 pb-4">
          <KyleQualCards
            result={displayResult}
            baselineResult={baselineResult}
            cards={cards}
            hasActiveChapters={hasActiveChapters}
          />
        </div>
      )}

      <div className="border-t border-white/[0.06]" />

      {/* Section 2: Mini Histogram */}
      {displayResult && (
        <div className="px-4 py-4">
          <div className="text-[9px] tracking-[0.1em] uppercase text-white/30 mb-2">
            Position Distribution
          </div>
          <KyleMiniHistogram result={displayResult} numSims={numSims} />
        </div>
      )}

      <div className="border-t border-white/[0.06]" />

      {/* Section 3: High-Leverage Fixtures */}
      <div className="px-4 py-4">
        <div className="text-[9px] tracking-[0.1em] uppercase text-white/30 mb-2">
          High-Leverage Fixtures
        </div>
        <KyleLeverageList
          sensitivityResults={sensitivityResults}
          selectedTeam={selectedTeam}
          metricLabel={sensitivityMetricLabel}
          baselineValue={baselineResult ? baselineResult[sensitivityMetric] : null}
        />
      </div>

      {/* Spacer */}
      <div className="flex-1" />
    </div>
  );
}
