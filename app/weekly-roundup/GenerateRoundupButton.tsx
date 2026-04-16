'use client';

import { useState } from 'react';

export default function GenerateRoundupButton() {
  const [matchday, setMatchday] = useState('');
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleGenerate() {
    const md = parseInt(matchday, 10);
    if (!md || md < 1 || md > 38) {
      setError('Enter a valid matchday (1-38).');
      return;
    }

    setGenerating(true);
    setError(null);
    setSuccess(false);

    try {
      const res = await fetch('/api/weekly-roundup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ matchday: md }),
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
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
      <div className="mb-3 text-[10px] font-bold tracking-[0.16em] uppercase text-white/30">
        Generate Roundup
      </div>
      <div className="flex items-end gap-3 flex-wrap">
        <div>
          <label
            htmlFor="matchday-input"
            className="block text-xs text-white/40 mb-1"
          >
            Matchday
          </label>
          <input
            id="matchday-input"
            type="number"
            min={1}
            max={38}
            value={matchday}
            onChange={(e) => setMatchday(e.target.value)}
            placeholder="e.g. 32"
            disabled={generating}
            className="w-24 rounded-lg border border-white/[0.16] bg-white/[0.04] px-3 py-2 text-sm text-white placeholder:text-white/25 focus:border-blue-400/40 focus:outline-none disabled:opacity-50"
          />
        </div>
        <button
          type="button"
          onClick={handleGenerate}
          disabled={generating || !matchday}
          className="inline-flex items-center gap-2 rounded-lg border border-blue-400/30 bg-blue-400/10 px-4 py-2 text-[11px] font-bold font-oswald tracking-widest uppercase text-blue-200 hover:bg-blue-400/20 hover:border-blue-400/50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
        >
          {generating ? (
            <>
              <span
                className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent"
              />
              Generating...
            </>
          ) : (
            'Generate'
          )}
        </button>
      </div>
      {error && (
        <p className="mt-3 text-xs text-red-400/80">{error}</p>
      )}
      {success && (
        <p className="mt-3 text-xs text-emerald-400/80">
          Roundup generated. Reloading...
        </p>
      )}
      <p className="mt-3 text-[11px] text-white/25">
        Requires the Weekly Preview for that matchday to exist, and all fixtures to be finished.
        Takes ~1-2 minutes.
      </p>
    </div>
  );
}
