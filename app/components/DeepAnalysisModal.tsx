'use client';

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  Team,
  Fixture,
  SensitivityResult,
  DeepAnalysis,
  SensitivityMetric,
  SimulationResult,
} from '@/lib/types';
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
  selectedTeamResult: DeepAnalysisMetricResult | null;
  sensitivityResults: SensitivityResult[] | null;
  sensitivityMetric: SensitivityMetric;
}

type DeepAnalysisMetric = Exclude<SensitivityMetric, 'survivalPct'>;

type DeepAnalysisMetricResult = Pick<SimulationResult, DeepAnalysisMetric>;

function isPossibleMetric(value: number): boolean {
  return value > 0 && value < 100;
}

function getTargetMetricLabel(metric: string): string {
  switch (metric) {
    case 'championPct':
      return 'League Champion';
    case 'relegationPct':
      return 'Relegation';
    case 'top4Pct':
      return 'Champions League';
    case 'top7Pct':
      return 'Any Europe';
    case 'top5Pct':
      return 'Top 5';
    case 'top6Pct':
      return 'Top 6';
    default:
      return metric.replace('Pct', '').replace('top', 'Top ');
  }
}

function formatMetricPct(value: number | null): string {
  if (value === null || Number.isNaN(value)) return '--';
  if (value < 1) return `${value.toFixed(1)}%`;
  if (value > 99 && value < 100) return `${value.toFixed(1)}%`;
  return `${Math.round(value)}%`;
}

export default function DeepAnalysisModal({
  open,
  onClose,
  accentColor,
  textAccentColor,
  selectedTeam,
  teams,
  fixtures,
  selectedTeamResult,
  sensitivityResults,
  sensitivityMetric,
}: Props) {
  const [phase, setPhase] = useState<'config' | 'loading' | 'ready' | 'error'>('config');
  const [fadeIn, setFadeIn] = useState(false);
  const [analysis, setAnalysis] = useState<DeepAnalysis | null>(null);
  const [error, setError] = useState<string>('');
  const [warning, setWarning] = useState<string>('');
  const [cacheStatus, setCacheStatus] = useState<'hit' | 'miss' | 'refreshed' | ''>('');
  const [cacheMatchType, setCacheMatchType] = useState<'exact' | 'scenario_fallback' | ''>('');
  const [cachedAt, setCachedAt] = useState<number | null>(null);
  const [cacheEnabled, setCacheEnabled] = useState<boolean>(true);
  const [loaderVariant, setLoaderVariant] = useState<'cached' | 'fresh'>('fresh');
  const [targetMetric, setTargetMetric] = useState<string>(sensitivityMetric);
  const abortRef = useRef<AbortController | null>(null);

  const teamName = teams.find((t) => t.abbr === selectedTeam)?.name ?? selectedTeam;
  const allMetricOptions = useMemo(
    (): { value: DeepAnalysisMetric; label: string }[] => [
      { value: 'championPct', label: 'League Champion (1st)' },
      { value: 'relegationPct', label: 'Relegation (Bottom 3)' },
      { value: 'top4Pct', label: 'Champions League (Top 4)' },
      { value: 'top7Pct', label: 'Any Europe (Top 7)' },
      { value: 'top5Pct', label: 'UCL Expanded (Top 5)' },
      { value: 'top6Pct', label: 'Europa League (Top 6)' },
    ],
    []
  );
  const metricOptions = useMemo(
    () =>
      selectedTeamResult
        ? allMetricOptions.filter((option) =>
            isPossibleMetric(selectedTeamResult[option.value])
          )
        : allMetricOptions,
    [allMetricOptions, selectedTeamResult]
  );
  const metricOptionsWithPct = useMemo(
    () => {
      const options = metricOptions.map((option) => ({
        ...option,
        pct: selectedTeamResult ? selectedTeamResult[option.value] : null,
      }));

      if (!selectedTeamResult) return options;

      return [...options].sort((a, b) => {
        const aDistance = Math.abs((a.pct ?? 0) - 50);
        const bDistance = Math.abs((b.pct ?? 0) - 50);
        if (aDistance !== bDistance) return aDistance - bDistance;
        return (b.pct ?? 0) - (a.pct ?? 0);
      });
    },
    [metricOptions, selectedTeamResult]
  );
  const hasMetricOptions = metricOptions.length > 0;

  // Reset when opened
  useEffect(() => {
    if (open) {
      setPhase('config');
      setFadeIn(false);
      setAnalysis(null);
      setError('');
      setWarning('');
      setCacheStatus('');
      setCacheMatchType('');
      setCachedAt(null);
      setCacheEnabled(true);
      setLoaderVariant('fresh');
      setTargetMetric(sensitivityMetric);
    } else {
      // Abort any in-flight request
      abortRef.current?.abort();
    }
  }, [open, sensitivityMetric]);

  useEffect(() => {
    if (!open || !hasMetricOptions) return;
    const hasSelectedMetric = metricOptions.some((option) => option.value === targetMetric);
    if (!hasSelectedMetric) {
      setTargetMetric(metricOptions[0].value);
    }
  }, [open, targetMetric, metricOptions, hasMetricOptions]);

  const handleGenerate = useCallback(async (forceRefresh = false) => {
    setError('');
    setWarning('');
    setCacheStatus('');
    setCacheMatchType('');
    setCachedAt(null);
    setLoaderVariant('fresh');

    const requestPayload = {
      targetTeam: selectedTeam,
      targetMetric,
      teams,
      fixtures,
    };

    if (!forceRefresh) {
      try {
        const preflightRes = await fetch('/api/deep-analysis', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...requestPayload,
            checkCacheOnly: true,
          }),
        });

        if (preflightRes.ok) {
          const preflightData = await preflightRes.json();
          if (typeof preflightData.cacheEnabled === 'boolean') {
            setCacheEnabled(preflightData.cacheEnabled);
          }
          if (preflightData.cached === true) {
            setLoaderVariant('cached');
          }
        }
      } catch {
        // If preflight fails, keep default fresh loader and continue generation.
      }
    }

    setPhase('loading');

    abortRef.current = new AbortController();
    const startedAt = Date.now();

    try {
      const res = await fetch('/api/deep-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...requestPayload,
          forceRefresh,
        }),
        signal: abortRef.current.signal,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(data.error || `API error: ${res.status}`);
      }

      const data = await res.json();

      if (data.cacheStatus === 'hit') {
        const elapsedMs = Date.now() - startedAt;
        const minimumCachedLoaderMs = 10_000;
        if (elapsedMs < minimumCachedLoaderMs) {
          await new Promise((resolve) => setTimeout(resolve, minimumCachedLoaderMs - elapsedMs));
        }
      }

      setAnalysis(data.analysis);
      setWarning(typeof data.aiWarning === 'string' ? data.aiWarning : '');
      setCacheStatus(
        data.cacheStatus === 'hit' || data.cacheStatus === 'miss' || data.cacheStatus === 'refreshed'
          ? data.cacheStatus
          : ''
      );
      setCacheMatchType(
        data.cacheMatchType === 'exact' || data.cacheMatchType === 'scenario_fallback'
          ? data.cacheMatchType
          : ''
      );
      setCachedAt(typeof data.cachedAt === 'number' ? data.cachedAt : null);
      setCacheEnabled(typeof data.cacheEnabled === 'boolean' ? data.cacheEnabled : true);
      setPhase('ready');
      requestAnimationFrame(() => setFadeIn(true));
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') return;
      console.error('Deep Analysis failed:', e);
      setError(e instanceof Error ? e.message : 'Unknown error');
      setPhase('error');
    }
  }, [selectedTeam, targetMetric, teams, fixtures]);

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
              {hasMetricOptions && (
                <div className="space-y-2">
                  {metricOptionsWithPct.map((opt) => {
                    const isSelected = targetMetric === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setTargetMetric(opt.value)}
                        className="w-full rounded-lg px-3 py-2.5 text-left transition-colors cursor-pointer"
                        style={{
                          background: isSelected ? `${accentColor}14` : 'rgba(255,255,255,0.03)',
                          border: `1px solid ${isSelected ? `${accentColor}66` : 'rgba(255,255,255,0.1)'}`,
                        }}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span
                            className="text-sm"
                            style={{ color: isSelected ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.78)' }}
                          >
                            {opt.label}
                          </span>
                          <span
                            className="font-oswald text-[13px] tracking-wide"
                            style={{ color: isSelected ? textAccentColor : 'rgba(255,255,255,0.55)' }}
                          >
                            {formatMetricPct(opt.pct)}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
              {!hasMetricOptions && (
                <div className="text-[11px] text-white/45 mt-2">
                  No selectable deep-analysis target is currently available for {teamName}. This
                  team&apos;s major outcomes are currently locked at 0% or 100%.
                </div>
              )}
            </div>

            <button
              onClick={() => handleGenerate()}
              disabled={!hasMetricOptions}
              className="w-full py-3 rounded-lg font-oswald text-sm font-bold tracking-widest uppercase transition-all cursor-pointer"
              style={{
                background: `linear-gradient(135deg, ${accentColor}40, ${accentColor}20)`,
                border: `1px solid ${accentColor}50`,
                color: textAccentColor,
                opacity: hasMetricOptions ? 1 : 0.45,
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
    return (
      <DeepAnalysisLoader
        accentColor={accentColor}
        teamName={teamName}
        onComplete={() => {}}
        isReal
        variant={loaderVariant}
      />
    );
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
            style={{ background: `${accentColor}25`, color: textAccentColor }}
          >
            {selectedTeam}
          </div>
          <span className="font-oswald text-[12px] tracking-[0.12em] uppercase text-white/50">
            Deep Analysis
          </span>
          <span className="text-[10px] text-white/20">&middot;</span>
          <span className="text-[10px] text-white/25">
            {getTargetMetricLabel(analysis.targetMetric)}
          </span>
          {cacheStatus === 'hit' && (
            <span className="text-[10px] px-2 py-0.5 rounded-full border border-emerald-300/30 bg-emerald-300/10 text-emerald-200/90">
              Cached
            </span>
          )}
          {cacheStatus === 'hit' && cacheMatchType === 'exact' && (
            <span className="text-[10px] px-2 py-0.5 rounded-full border border-emerald-300/30 bg-emerald-300/10 text-emerald-200/90">
              Exact cache
            </span>
          )}
          {cacheStatus === 'hit' && cacheMatchType === 'scenario_fallback' && (
            <span className="text-[10px] px-2 py-0.5 rounded-full border border-amber-300/30 bg-amber-300/10 text-amber-200/90">
              Scenario cache
            </span>
          )}
          {cacheStatus === 'refreshed' && (
            <span className="text-[10px] px-2 py-0.5 rounded-full border border-sky-300/30 bg-sky-300/10 text-sky-200/90">
              Fresh
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => handleGenerate(true)}
            className="h-8 px-3 rounded-lg text-[10px] tracking-[0.08em] uppercase text-white/65 hover:text-white/85 border border-white/[0.12] hover:border-white/[0.2] transition-colors cursor-pointer"
            title="Regenerate a fresh deep analysis"
          >
            Regenerate Fresh
          </button>
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
      </div>

      {/* Main content area */}
      <div
        className={`flex h-[calc(100vh-48px)] transition-opacity duration-500 ${fadeIn ? 'opacity-100' : 'opacity-0'}`}
      >
        {/* Analysis content — scrollable */}
        <div className="flex-1 overflow-y-auto px-6 lg:px-10 min-w-0">
          {warning && (
            <div className="mt-4 mb-3 rounded-lg border border-amber-400/35 bg-amber-400/10 px-4 py-3 text-[12px] text-amber-200/90">
              {warning}
            </div>
          )}
          {!cacheEnabled && (
            <div className="mt-4 mb-3 rounded-lg border border-sky-400/30 bg-sky-400/10 px-4 py-3 text-[12px] text-sky-100/90">
              Shared report caching is not configured on this deployment yet. Add `SUPABASE_URL`
              and `SUPABASE_SERVICE_ROLE_KEY` to enable cross-device saved reports.
            </div>
          )}
          {cachedAt && (
            <div className="mt-4 mb-3 rounded-lg border border-white/[0.1] bg-white/[0.03] px-4 py-2 text-[11px] text-white/55">
              Report timestamp: {new Date(cachedAt).toLocaleString('en-GB')}
            </div>
          )}
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
