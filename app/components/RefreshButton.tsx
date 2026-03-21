'use client';

interface Props {
  onRefresh: () => void;
  running: boolean;
  hasResults: boolean;
  fixtureCount: number;
  simCount: number;
}

export default function RefreshButton({
  onRefresh,
  running,
  hasResults,
  fixtureCount,
  simCount,
}: Props) {
  return (
    <div className="flex items-center gap-4 mb-7">
      <button
        onClick={onRefresh}
        disabled={running}
        className={`px-8 py-3.5 rounded-lg text-sm font-bold font-oswald tracking-widest uppercase transition-all text-white border-none ${
          running
            ? 'bg-white/[0.05] cursor-wait'
            : 'bg-gradient-to-br from-teal-500 to-teal-700 cursor-pointer hover:from-teal-400 hover:to-teal-600'
        }`}
      >
        {running
          ? 'Simulating...'
          : hasResults
          ? '\u21BB Re-run Simulation'
          : '\u25B6 Run Simulation'}
      </button>
      <div className="text-xs text-white/35">
        {simCount.toLocaleString()} Monte Carlo simulations &times;{' '}
        {fixtureCount} remaining fixtures
      </div>
    </div>
  );
}
