'use client';

import { useState } from 'react';

interface RoundupGenerationFixtureStatus {
  fixtureId: string;
  homeTeam: string;
  awayTeam: string;
  status: 'FINISHED' | 'SCHEDULED' | 'LIVE';
  date: string;
}

interface RoundupGenerationStatus {
  matchday: number | null;
  totalFixtures: number;
  finishedFixtures: number;
  unfinishedFixtures: RoundupGenerationFixtureStatus[];
  canGenerate: boolean;
  reason?: string;
  warning?: string;
}

export default function GenerateRoundupButton({
  status,
}: {
  status: RoundupGenerationStatus;
}) {
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [confirmOverride, setConfirmOverride] = useState(false);

  const hasUnfinishedFixtures = status.unfinishedFixtures.length > 0;

  async function handleGenerate() {
    if (!status.matchday || !status.canGenerate) {
      setError(status.reason ?? 'No matchday is ready for roundup generation yet.');
      return;
    }

    if (hasUnfinishedFixtures && !confirmOverride) {
      setError(null);
      setConfirmOverride(true);
      return;
    }

    setGenerating(true);
    setError(null);
    setSuccess(false);

    try {
      const res = await fetch('/api/weekly-roundup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ matchday: status.matchday }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || `Generation failed (${res.status})`);
        return;
      }

      setSuccess(true);
      // Reload to show the new draft
      setTimeout(() => window.location.reload(), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="mt-4 border-t border-white/[0.07] pt-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] font-bold tracking-[0.16em] uppercase text-white/25">
            Generate Latest Report
          </div>
          <p className="mt-1 text-[11px] text-white/35">
            {status.matchday
              ? `Targets Matchday ${status.matchday}: ${status.finishedFixtures} of ${status.totalFixtures} fixtures finished.`
              : (status.reason ?? 'No finished matchday found yet.')}
          </p>
        </div>
        <button
          type="button"
          onClick={handleGenerate}
          disabled={generating || !status.canGenerate}
          className="inline-flex items-center gap-2 rounded-lg border border-blue-400/30 bg-blue-400/10 px-4 py-2 text-[11px] font-bold font-oswald tracking-widest uppercase text-blue-200 hover:bg-blue-400/20 hover:border-blue-400/50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
        >
          {generating ? (
            <>
              <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
              Generating...
            </>
          ) : (
            'Generate Latest'
          )}
        </button>
      </div>
      {confirmOverride && hasUnfinishedFixtures && (
        <div className="mt-4 rounded-xl border border-amber-400/25 bg-amber-400/[0.06] p-4">
          <p className="text-sm text-amber-100/80">
            {status.warning ??
              `${status.unfinishedFixtures.length} fixtures in Matchday ${status.matchday} are not finished yet.`}
          </p>
          <p className="mt-1 text-xs text-white/45">
            This warning is only for games still to be played in Matchday {status.matchday}, not
            the rest of the season.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleGenerate}
              disabled={generating}
              className="rounded-lg border border-amber-300/35 bg-amber-300/10 px-3 py-1.5 text-[11px] font-bold tracking-widest uppercase text-amber-100 transition-colors hover:border-amber-300/55 hover:bg-amber-300/20 disabled:opacity-40"
            >
              Generate Anyway
            </button>
            <button
              type="button"
              onClick={() => setConfirmOverride(false)}
              disabled={generating}
              className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[11px] font-bold tracking-widest uppercase text-white/45 transition-colors hover:border-white/20 hover:text-white/70 disabled:opacity-40"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {error && (
        <p className="mt-3 text-xs text-red-400/80">{error}</p>
      )}
      {success && (
        <p className="mt-3 text-xs text-emerald-400/80">
          Roundup generated. Reloading...
        </p>
      )}
      <p className="mt-3 text-[11px] text-white/25">
        Requires the Weekly Preview for that matchday to exist. Takes ~1-2 minutes.
      </p>
    </div>
  );
}
