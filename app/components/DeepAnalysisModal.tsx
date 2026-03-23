'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { Team, Fixture, SensitivityResult, DeepAnalysis, SensitivityMetric } from '@/lib/types';
import DeepAnalysisLoader from './DeepAnalysisLoader';
import DeepAnalysisContent from './DeepAnalysisContent';
import DeepAnalysisChat from './DeepAnalysisChat';

interface Props {
  open: boolean;
  onClose: () => void;
  accentColor: string;
  textAccentColor: string;
  selectedTeam: string;
  teams: Team[];
  fixtures: Fixture[];
  sensitivityResults: SensitivityResult[] | null;
  sensitivityMetric: SensitivityMetric;
}

export default function DeepAnalysisModal({
  open,
  onClose,
  accentColor,
  textAccentColor,
  selectedTeam,
  teams,
  fixtures,
  sensitivityResults,
  sensitivityMetric,
}: Props) {
  const [phase, setPhase] = useState<'config' | 'loading' | 'ready' | 'error'>('config');
  const [fadeIn, setFadeIn] = useState(false);
  const [analysis, setAnalysis] = useState<DeepAnalysis | null>(null);
  const [error, setError] = useState<string>('');
  const [targetMetric, setTargetMetric] = useState<string>(sensitivityMetric);
  const [targetThreshold, setTargetThreshold] = useState(50);
  const abortRef = useRef<AbortController | null>(null);

  const teamName = teams.find((t) => t.abbr === selectedTeam)?.name ?? selectedTeam;

  // Reset when opened
  useEffect(() => {
    if (open) {
      setPhase('config');
      setFadeIn(false);
      setAnalysis(null);
      setError('');
      setTargetMetric(sensitivityMetric);
    } else {
      // Abort any in-flight request
      abortRef.current?.abort();
    }
  }, [open, sensitivityMetric]);

  const handleGenerate = useCallback(async () => {
    setPhase('loading');
    setError('');

    abortRef.current = new AbortController();

    try {
      const res = await fetch('/api/deep-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetTeam: selectedTeam,
          targetMetric,
          targetThreshold,
          teams,
          fixtures,
        }),
        signal: abortRef.current.signal,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(data.error || `API error: ${res.status}`);
      }

      const data = await res.json();
      setAnalysis(data.analysis);
      setPhase('ready');
      requestAnimationFrame(() => setFadeIn(true));
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') return;
      console.error('Deep Analysis failed:', e);
      setError(e instanceof Error ? e.message : 'Unknown error');
      setPhase('error');
    }
  }, [selectedTeam, targetMetric, targetThreshold, teams, fixtures]);

  // Escape to close
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  // Prevent body scroll when modal is open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  if (!open) return null;

  // ── Config Panel ──
  if (phase === 'config') {
    const metricOptions: { value: string; label: string }[] = [
      { value: 'championPct', label: 'League Champion (1st)' },
      { value: 'top4Pct', label: 'Champions League (Top 4)' },
      { value: 'top5Pct', label: 'UCL Expanded (Top 5)' },
      { value: 'top6Pct', label: 'Europa League (Top 6)' },
      { value: 'top7Pct', label: 'Any Europe (Top 7)' },
      { value: 'relegationPct', label: 'Relegation (Bottom 3)' },
    ];

    return (
      <div className="fixed inset-0 z-[100] bg-[#050505]/95 flex items-center justify-center">
        <div className="relative z-10 w-full max-w-md px-8">
          <div className="text-center mb-8">
            <div className="font-oswald text-[11px] tracking-[0.25em] uppercase text-white/30 mb-3">
              Keepwatch
            </div>
            <div className="font-oswald text-xl font-bold tracking-wide uppercase text-white/90">
              Deep Analysis
            </div>
            <div className="text-[12px] text-white/30 mt-2">
              Configure your analysis for {teamName}
            </div>
          </div>

          <div className="bg-white/[0.03] border border-white/[0.08] rounded-xl p-6 space-y-5">
            <div>
              <label className="text-[10px] tracking-[0.12em] uppercase text-white/40 mb-2 block">
                Target
              </label>
              <select
                value={targetMetric}
                onChange={(e) => setTargetMetric(e.target.value)}
                className="w-full bg-white/[0.04] border border-white/[0.1] rounded-lg px-3 py-2.5 text-sm text-white/80 outline-none focus:border-white/20"
              >
                {metricOptions.map((opt) => (
                  <option key={opt.value} value={opt.value} className="bg-[#1a1a1a]">
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-[10px] tracking-[0.12em] uppercase text-white/40 mb-2 block">
                Threshold: {targetThreshold}%
              </label>
              <input
                type="range"
                min={20}
                max={80}
                step={5}
                value={targetThreshold}
                onChange={(e) => setTargetThreshold(Number(e.target.value))}
                className="w-full accent-current"
                style={{ accentColor }}
              />
              <div className="flex justify-between text-[9px] text-white/25 mt-1">
                <span>20%</span>
                <span>50%</span>
                <span>80%</span>
              </div>
            </div>

            <button
              onClick={handleGenerate}
              className="w-full py-3 rounded-lg font-oswald text-sm font-bold tracking-widest uppercase transition-all cursor-pointer"
              style={{
                background: `linear-gradient(135deg, ${accentColor}40, ${accentColor}20)`,
                border: `1px solid ${accentColor}50`,
                color: accentColor,
              }}
            >
              Generate Analysis
            </button>
          </div>

          <button
            onClick={onClose}
            className="mt-4 w-full py-2 text-[11px] text-white/40 hover:text-white/60 transition-colors cursor-pointer"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  // ── Loading ──
  if (phase === 'loading') {
    return <DeepAnalysisLoader accentColor={accentColor} teamName={teamName} onComplete={() => {}} isReal />;
  }

  // ── Error ──
  if (phase === 'error') {
    return (
      <div className="fixed inset-0 z-[100] bg-[#050505]/95 flex items-center justify-center">
        <div className="max-w-md px-8 text-center">
          <div className="font-oswald text-xl font-bold text-red-400/80 mb-4">Analysis Failed</div>
          <div className="text-sm text-white/50 mb-6">{error}</div>
          <div className="flex gap-3 justify-center">
            <button
              onClick={() => setPhase('config')}
              className="px-6 py-2.5 rounded-lg text-sm font-semibold border border-white/[0.12] text-white/60 hover:text-white/80 transition-colors cursor-pointer"
            >
              Try Again
            </button>
            <button
              onClick={onClose}
              className="px-6 py-2.5 rounded-lg text-sm text-white/40 hover:text-white/60 transition-colors cursor-pointer"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Ready — full analysis view ──
  if (!analysis) return null;

  return (
    <div className="fixed inset-0 z-[100] bg-[#070707]">
      {/* Top bar */}
      <div
        className="h-12 border-b flex items-center justify-between px-5 shrink-0"
        style={{ borderColor: `${accentColor}15`, background: '#0a0a0a' }}
      >
        <div className="flex items-center gap-3">
          <div
            className="w-6 h-6 rounded flex items-center justify-center font-oswald text-[9px] font-bold"
            style={{ background: `${accentColor}25`, color: accentColor }}
          >
            {selectedTeam}
          </div>
          <span className="font-oswald text-[12px] tracking-[0.12em] uppercase text-white/50">
            Deep Analysis
          </span>
          <span className="text-[10px] text-white/20">&middot;</span>
          <span className="text-[10px] text-white/25">
            {analysis.targetMetric === 'championPct' ? 'Champion' : analysis.targetMetric === 'relegationPct' ? `Relegation \u2264 ${analysis.targetThreshold}%` : `${analysis.targetMetric.replace('Pct', '').replace('top', 'Top ')} \u2265 ${analysis.targetThreshold}%`}
          </span>
        </div>
        <button
          onClick={onClose}
          className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-white/[0.06] transition-colors cursor-pointer"
          title="Close"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M3 3L11 11M11 3L3 11" stroke="rgba(255,255,255,0.4)" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {/* Main content area */}
      <div
        className={`flex h-[calc(100vh-48px)] transition-opacity duration-500 ${fadeIn ? 'opacity-100' : 'opacity-0'}`}
      >
        {/* Analysis content — scrollable */}
        <div className="flex-1 overflow-y-auto px-6 lg:px-10 min-w-0">
          <DeepAnalysisContent
            accentColor={accentColor}
            textAccentColor={textAccentColor}
            analysis={analysis}
            teamName={teamName}
          />
        </div>

        {/* Chat panel — right side */}
        <div
          className="w-[380px] shrink-0 border-l border-white/[0.06] bg-[#0d0d0d] hidden lg:flex flex-col"
        >
          <DeepAnalysisChat
            accentColor={accentColor}
            selectedTeam={selectedTeam}
            teams={teams}
            sensitivityResults={sensitivityResults}
            analysis={analysis}
          />
        </div>
      </div>
    </div>
  );
}
