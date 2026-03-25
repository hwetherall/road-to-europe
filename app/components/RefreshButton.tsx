'use client';

interface Props {
  onRefresh: () => void;
  running: boolean;
  hasResults: boolean;
  fixtureCount: number;
  simCount: number;
  tonedDown?: boolean;
}

export default function RefreshButton({
  onRefresh,
  running,
  hasResults,
  fixtureCount,
  simCount,
  tonedDown = false,
}: Props) {
  return (
    <>
      <button
        onClick={onRefresh}
        disabled={running}
        className={`px-8 py-3.5 rounded-lg text-sm font-bold font-oswald tracking-widest uppercase transition-all text-white border-none ${
          running
            ? 'bg-white/[0.05] cursor-wait'
            : tonedDown
            ? 'bg-white/[0.08] border border-white/[0.16] cursor-pointer hover:bg-white/[0.12]'
            : 'bg-gradient-to-br from-teal-500 to-teal-700 cursor-pointer hover:from-teal-400 hover:to-teal-600'
        }`}
      >
        {running
          ? 'Simulating...'
          : hasResults
          ? '\u21BB Re-run Simulation'
          : '\u25B6 Start Guided Simulation'}
      </button>
      <div className="text-xs text-white/45">
        {simCount.toLocaleString()} sims &times; {fixtureCount} fixtures
      </div>
      {!hasResults && (
        <div className="text-[11px] text-white/30 -mt-1">
          Best first step: build your baseline odds before trying scenarios.
        </div>
      )}
      {hasResults && (
        <div className="text-[11px] text-white/28 -mt-1">
          Refreshes baseline odds with current fixtures and probabilities.
        </div>
      )}
    </>
  );
}
