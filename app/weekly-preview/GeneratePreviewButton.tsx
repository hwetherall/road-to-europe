'use client';

import { useState } from 'react';

export default function GeneratePreviewButton() {
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleGenerate() {
    setGenerating(true);
    setError(null);
    setSuccess(false);

    try {
      const res = await fetch('/api/weekly-preview', { method: 'POST' });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || `Generation failed (${res.status})`);
        return;
      }

      setSuccess(true);
      setTimeout(() => window.location.reload(), 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
      <div className="mb-3 text-[10px] font-bold tracking-[0.16em] uppercase text-white/30">
        Generate Preview
      </div>
      <div className="flex items-center gap-4 flex-wrap">
        <button
          type="button"
          onClick={handleGenerate}
          disabled={generating}
          className="inline-flex items-center gap-2 rounded-lg border border-amber-400/30 bg-amber-400/10 px-4 py-2 text-[11px] font-bold font-oswald tracking-widest uppercase text-amber-200 hover:bg-amber-400/20 hover:border-amber-400/50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
        >
          {generating ? (
            <>
              <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
              Generating...
            </>
          ) : (
            'Generate New Preview'
          )}
        </button>
        <p className="text-[11px] text-white/25">
          Fetches live data and runs the full AI pipeline. Takes 3–5 minutes.
        </p>
      </div>
      {error && <p className="mt-3 text-xs text-red-400/80">{error}</p>}
      {success && (
        <p className="mt-3 text-xs text-emerald-400/80">Preview generated. Reloading...</p>
      )}
    </div>
  );
}
