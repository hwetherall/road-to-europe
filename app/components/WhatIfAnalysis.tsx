'use client';

import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { Fixture, SimulationResult, Team } from '@/lib/types';
import {
  CounterfactualScenario,
  WhatIfAnalysis as WhatIfAnalysisType,
  WhatIfSearchTraceEntry,
} from '@/lib/what-if/types';
import WhatIfProgress, { WhatIfPhase } from './WhatIfProgress';

interface Props {
  open: boolean;
  onClose: () => void;
  accentColor: string;
  textAccentColor: string;
  targetTeam: string;
  targetMetric: keyof SimulationResult;
  targetMetricLabel: string;
  teams: Team[];
  fixtures: Fixture[];
}

interface WhatIfState {
  phase: WhatIfPhase;
  currentStep?: string;
  baselineOdds: number;
  position: number;
  points: number;
  gamesRemaining: number;
  diagnosis: {
    squadQualityRank: number;
    gapToTopSquad: number;
    keyBottlenecks: string[];
    narrativeSummary: string;
  } | null;
  scenarios: CounterfactualScenario[];
  stressTest: string | null;
  analysis: WhatIfAnalysisType | null;
  error: string | null;
}

type WhatIfAction =
  | { type: 'START'; baselineOdds: number; position: number; points: number; gamesRemaining: number }
  | { type: 'CACHED'; analysis: WhatIfAnalysisType }
  | { type: 'PHASE'; phase: WhatIfPhase; step?: string }
  | { type: 'DIAGNOSED'; diagnosis: WhatIfState['diagnosis'] }
  | { type: 'HYPOTHESISED'; scenarios: CounterfactualScenario[] }
  | { type: 'STRESS_TESTED'; stressTest: string }
  | { type: 'SYNTHESISED'; analysis: WhatIfAnalysisType }
  | { type: 'ERROR'; error: string }
  | { type: 'RESET' };

interface CacheMeta {
  status: '' | 'hit' | 'miss' | 'refreshed';
  matchType: '' | 'exact' | 'fallback';
  cachedAt: number | null;
}

interface PipelineStats {
  webSearches: number;
  llmCalls: number;
  simulationCalls: number;
  wallClockMs: number;
  searchTrail: WhatIfSearchTraceEntry[];
}

const initialState: WhatIfState = {
  phase: 'idle',
  baselineOdds: 0,
  position: 0,
  points: 0,
  gamesRemaining: 0,
  diagnosis: null,
  scenarios: [],
  stressTest: null,
  analysis: null,
  error: null,
};

const initialCacheMeta: CacheMeta = {
  status: '',
  matchType: '',
  cachedAt: null,
};

const initialPipelineStats: PipelineStats = {
  webSearches: 0,
  llmCalls: 0,
  simulationCalls: 0,
  wallClockMs: 0,
  searchTrail: [],
};

function reducer(state: WhatIfState, action: WhatIfAction): WhatIfState {
  switch (action.type) {
    case 'START':
      return {
        ...initialState,
        phase: 'diagnosing',
        currentStep: 'Checking the baseline and remaining-game ceiling...',
        baselineOdds: action.baselineOdds,
        position: action.position,
        points: action.points,
        gamesRemaining: action.gamesRemaining,
      };
    case 'CACHED':
      return {
        ...state,
        phase: 'ready',
        analysis: action.analysis,
        error: null,
      };
    case 'PHASE':
      return {
        ...state,
        phase: action.phase,
        currentStep: action.step,
        error: null,
      };
    case 'DIAGNOSED':
      return {
        ...state,
        phase: 'hypothesising',
        diagnosis: action.diagnosis,
      };
    case 'HYPOTHESISED':
      return {
        ...state,
        phase: 'stressTesting',
        scenarios: action.scenarios,
      };
    case 'STRESS_TESTED':
      return {
        ...state,
        phase: 'synthesising',
        stressTest: action.stressTest,
      };
    case 'SYNTHESISED':
      return {
        ...state,
        phase: 'ready',
        analysis: action.analysis,
      };
    case 'ERROR':
      return {
        ...state,
        phase: 'error',
        error: action.error,
      };
    case 'RESET':
      return { ...initialState };
    default:
      return state;
  }
}

function formatOdds(value: number | undefined): string {
  if (value === undefined || Number.isNaN(value)) return '--';
  if (value > 0 && value < 0.1) return '<0.1%';
  return `${value.toFixed(1)}%`;
}

function formatDelta(value: number): string {
  if (value > 0 && value < 0.1) return '+<0.1pp';
  if (value < 0 && value > -0.1) return '-<0.1pp';
  return `${value > 0 ? '+' : ''}${value.toFixed(1)}pp`;
}

function formatGeneratedAt(timestamp: number | null): string {
  if (!timestamp) return '';
  return new Date(timestamp).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatDuration(ms: number): string {
  if (!ms || Number.isNaN(ms)) return '--';
  if (ms < 1000) return `${ms}ms`;
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`;
}

function scenarioScore(scenario: CounterfactualScenario): number {
  return scenario.simulationResult.modifiedOdds * (0.45 + scenario.plausibility.score / 100);
}

function categoryLabel(category: CounterfactualScenario['category']): string {
  switch (category) {
    case 'perfect_world':
      return 'math ceiling';
    case 'competition_priority':
      return 'competition';
    case 'injury_prevention':
      return 'fitness';
    case 'squad_upgrade':
      return 'squad build';
    case 'tactical_change':
      return 'tactical';
    default:
      return category.replace(/_/g, ' ');
  }
}

function paragraphs(content: string): string[] {
  return content
    .split(/\n{2,}/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function splitSnapshotItem(text: string): { title: string; detail: string } {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  const dashSplit = cleaned.split(/\s+[—-]\s+/);
  if (dashSplit.length > 1) {
    return {
      title: dashSplit[0],
      detail: dashSplit.slice(1).join(' — '),
    };
  }

  const colonIndex = cleaned.indexOf(': ');
  if (colonIndex > 0) {
    return {
      title: cleaned.slice(0, colonIndex),
      detail: cleaned.slice(colonIndex + 2),
    };
  }

  return {
    title: cleaned,
    detail: '',
  };
}

export default function WhatIfAnalysis({
  open,
  onClose,
  accentColor,
  textAccentColor,
  targetTeam,
  targetMetric,
  targetMetricLabel,
  teams,
  fixtures,
}: Props) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [fadeIn, setFadeIn] = useState(false);
  const [cacheMeta, setCacheMeta] = useState<CacheMeta>(initialCacheMeta);
  const [recentSearches, setRecentSearches] = useState<WhatIfSearchTraceEntry[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const pipelineStatsRef = useRef<PipelineStats>(initialPipelineStats);

  const syncPipelineStats = useCallback((stats: PipelineStats) => {
    pipelineStatsRef.current = stats;
    setRecentSearches(stats.searchTrail);
  }, []);

  const callAPI = useCallback(
    async (action: string, extra: Record<string, unknown> = {}) => {
      const response = await fetch('/api/what-if', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          targetTeam,
          targetMetric,
          teams,
          fixtures,
          ...extra,
        }),
        signal: abortRef.current?.signal,
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: 'Request failed' }));
        throw new Error(err.error ?? `API error: ${response.status}`);
      }

      return response.json();
    },
    [fixtures, targetMetric, targetTeam, teams]
  );

  const runPipeline = useCallback(
    async (forceRefresh = false) => {
      abortRef.current?.abort();
      abortRef.current = new AbortController();
      setFadeIn(false);
      syncPipelineStats(initialPipelineStats);
      dispatch({
        type: 'PHASE',
        phase: 'diagnosing',
        step: 'Checking the baseline and remaining-game ceiling...',
      });

      try {
        const startResult = await callAPI('start', { forceRefresh });

        if (startResult.cached) {
          setCacheMeta({
            status: 'hit',
            matchType:
              startResult.cacheMatchType === 'exact' || startResult.cacheMatchType === 'fallback'
                ? startResult.cacheMatchType
                : '',
            cachedAt: typeof startResult.cachedAt === 'number' ? startResult.cachedAt : null,
          });
          dispatch({ type: 'CACHED', analysis: startResult.analysis });
          requestAnimationFrame(() => setFadeIn(true));
          return;
        }

        setCacheMeta({
          status: forceRefresh ? 'refreshed' : 'miss',
          matchType: '',
          cachedAt: null,
        });
        syncPipelineStats({
          webSearches: startResult.stats?.webSearches ?? 0,
          llmCalls: startResult.stats?.llmCalls ?? 0,
          simulationCalls: startResult.stats?.simulationCalls ?? 0,
          wallClockMs: startResult.stats?.wallClockMs ?? 0,
          searchTrail: startResult.stats?.searchTrail ?? [],
        });

        dispatch({
          type: 'START',
          baselineOdds: startResult.baselineOdds,
          position: startResult.position,
          points: startResult.points,
          gamesRemaining: startResult.gamesRemaining,
        });

        dispatch({
          type: 'PHASE',
          phase: 'diagnosing',
          step: 'Diagnosing why the baseline is so low right now...',
        });
        const diagnoseResult = await callAPI('diagnose');
        syncPipelineStats(accumulatePipelineStats(pipelineStatsRef.current, diagnoseResult.stats));
        dispatch({ type: 'DIAGNOSED', diagnosis: diagnoseResult.diagnosis });

        dispatch({
          type: 'PHASE',
          phase: 'hypothesising',
          step: 'Searching for both the mathematical ceiling and the believable paths...',
        });
        const hypothesiseResult = await callAPI('hypothesise', {
          diagnosis: diagnoseResult.diagnosis,
        });
        syncPipelineStats(accumulatePipelineStats(pipelineStatsRef.current, hypothesiseResult.stats));
        dispatch({ type: 'HYPOTHESISED', scenarios: hypothesiseResult.scenarios });

        dispatch({
          type: 'PHASE',
          phase: 'stressTesting',
          step: 'Reality-checking those scenarios against transfers, finances, and context...',
        });
        const stressTestResult = await callAPI('stress-test', {
          scenarios: hypothesiseResult.scenarios,
        });
        syncPipelineStats(accumulatePipelineStats(pipelineStatsRef.current, stressTestResult.stats));
        dispatch({ type: 'STRESS_TESTED', stressTest: stressTestResult.stressTest });

        dispatch({
          type: 'PHASE',
          phase: 'synthesising',
          step: 'Writing the final report and separating possible from plausible...',
        });
        const synthesiseResult = await callAPI('synthesise', {
          diagnosis: diagnoseResult.diagnosis,
          scenarios: hypothesiseResult.scenarios,
          stressTest: stressTestResult.stressTest,
          pipelineStats: pipelineStatsRef.current,
        });

        dispatch({ type: 'SYNTHESISED', analysis: synthesiseResult.analysis });
        requestAnimationFrame(() => setFadeIn(true));
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') return;
        dispatch({ type: 'ERROR', error: error instanceof Error ? error.message : 'Unknown error' });
      }
    },
    [callAPI, syncPipelineStats]
  );

  useEffect(() => {
    if (open && state.phase === 'idle') {
      const timer = window.setTimeout(() => {
        void runPipeline();
      }, 0);

      return () => window.clearTimeout(timer);
    }
  }, [open, runPipeline, state.phase]);

  useEffect(() => {
    if (!open) return;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        abortRef.current?.abort();
        dispatch({ type: 'RESET' });
        setCacheMeta(initialCacheMeta);
        syncPipelineStats(initialPipelineStats);
        setFadeIn(false);
        onClose();
      }
    };

    window.addEventListener('keydown', handleEscape);
    document.body.style.overflow = 'hidden';

    return () => {
      window.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = '';
    };
  }, [onClose, open, syncPipelineStats]);

  const handleClose = useCallback(() => {
    abortRef.current?.abort();
    dispatch({ type: 'RESET' });
    setCacheMeta(initialCacheMeta);
    syncPipelineStats(initialPipelineStats);
    setFadeIn(false);
    onClose();
  }, [onClose, syncPipelineStats]);

  if (!open) return null;

  const teamName = teams.find((team) => team.abbr === targetTeam)?.name ?? targetTeam;
  const loading = state.phase !== 'idle' && state.phase !== 'ready' && state.phase !== 'error';

  return (
    <div className="fixed inset-0 z-[110] bg-[#050505]">
      {loading && (
        <button
          type="button"
          onClick={handleClose}
          className="absolute right-5 top-5 z-20 flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-black/30 text-white/55 transition-colors hover:text-white/85"
          title="Close"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M3 3L11 11M11 3L3 11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </button>
      )}

      {loading && (
        <WhatIfProgress
          phase={state.phase}
          currentStep={state.currentStep}
          accentColor={accentColor}
          teamName={teamName}
          targetMetricLabel={targetMetricLabel}
          baselineOdds={state.baselineOdds}
          gamesRemaining={state.gamesRemaining}
          recentSearches={recentSearches}
        />
      )}

      {state.phase === 'error' && (
        <div className="flex min-h-screen items-center justify-center px-6">
          <div className="w-full max-w-lg rounded-[28px] border border-white/10 bg-white/[0.03] p-8 text-center shadow-[0_24px_80px_rgba(0,0,0,0.45)]">
            <div className="font-oswald text-[12px] uppercase tracking-[0.24em] text-red-300/70">What If</div>
            <h2 className="mt-3 font-oswald text-3xl uppercase tracking-[0.08em] text-white/92">Report Failed</h2>
            <p className="mt-4 text-sm leading-7 text-white/55">{state.error}</p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <button
                type="button"
                onClick={() => runPipeline(true)}
                className="rounded-full px-5 py-2.5 text-sm font-semibold text-white transition-transform hover:scale-[1.02]"
                style={{
                  background: `linear-gradient(135deg, ${accentColor}80, ${accentColor}40)`,
                  boxShadow: `0 12px 32px ${accentColor}22`,
                }}
              >
                Retry Fresh Report
              </button>
              <button
                type="button"
                onClick={handleClose}
                className="rounded-full border border-white/12 px-5 py-2.5 text-sm text-white/65 transition-colors hover:text-white/85"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {state.phase === 'ready' && state.analysis && (
        <div className={`flex h-full flex-col transition-opacity duration-500 ${fadeIn ? 'opacity-100' : 'opacity-0'}`}>
          <div className="border-b border-white/10 bg-[#090909]/95 backdrop-blur">
            <div className="mx-auto flex h-14 w-full max-w-7xl items-center justify-between gap-4 px-5 lg:px-10">
              <div className="flex min-w-0 items-center gap-3">
                <div
                  className="flex h-8 w-8 items-center justify-center rounded-lg font-oswald text-[10px] font-bold tracking-[0.12em]"
                  style={{ background: `${accentColor}26`, color: textAccentColor }}
                >
                  {targetTeam}
                </div>
                <div className="min-w-0">
                  <div className="font-oswald text-[12px] uppercase tracking-[0.16em] text-white/65">
                    What If Report
                  </div>
                  <div className="truncate text-[11px] text-white/30">{targetMetricLabel}</div>
                </div>
                {cacheMeta.status === 'hit' && (
                  <CachePill label={cacheMeta.matchType === 'exact' ? 'Cached' : 'Related Cache'} tone="neutral" />
                )}
                {cacheMeta.status === 'refreshed' && <CachePill label="Fresh" tone="accent" accentColor={accentColor} />}
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => runPipeline(true)}
                  className="rounded-full border border-white/12 px-4 py-2 text-[11px] font-medium tracking-[0.08em] text-white/68 transition-colors hover:text-white/90"
                >
                  Regenerate
                </button>
                <button
                  type="button"
                  onClick={handleClose}
                  className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 text-white/55 transition-colors hover:text-white/85"
                  title="Close"
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path d="M3 3L11 11M11 3L3 11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
            </div>
          </div>

          <WhatIfContent
            analysis={state.analysis}
            accentColor={accentColor}
            textAccentColor={textAccentColor}
            cacheMeta={cacheMeta}
          />
        </div>
      )}
    </div>
  );
}

function accumulatePipelineStats(current: PipelineStats, next?: Partial<PipelineStats>): PipelineStats {
  if (!next) return current;

  return {
    webSearches: current.webSearches + (next.webSearches ?? 0),
    llmCalls: current.llmCalls + (next.llmCalls ?? 0),
    simulationCalls: current.simulationCalls + (next.simulationCalls ?? 0),
    wallClockMs: current.wallClockMs + (next.wallClockMs ?? 0),
    searchTrail: [...current.searchTrail, ...((next.searchTrail as WhatIfSearchTraceEntry[] | undefined) ?? [])],
  };
}

function WhatIfContent({
  analysis,
  accentColor,
  textAccentColor,
  cacheMeta,
}: {
  analysis: WhatIfAnalysisType;
  accentColor: string;
  textAccentColor: string;
  cacheMeta: CacheMeta;
}) {
  const rankedScenarios = [...analysis.scenarios].sort((a, b) => scenarioScore(b) - scenarioScore(a));
  const searchTrail = analysis.searchTrail ?? [];
  const perfectWorld = analysis.perfectWorld ?? rankedScenarios[0];
  // const snapshotItems = analysis.diagnosis.keyBottlenecks.slice(0, 4);
  const bestPragmatic =
    rankedScenarios
      .filter((scenario) => scenario.category !== 'perfect_world' && scenario.plausibility.score >= 35)
      .sort((a, b) => b.simulationResult.modifiedOdds - a.simulationResult.modifiedOdds)[0] ??
    rankedScenarios.find((scenario) => scenario.category !== 'perfect_world') ??
    perfectWorld;
  const liveChanceExists = (perfectWorld?.simulationResult.modifiedOdds ?? 0) > 0;

  return (
    <div className="relative flex-1 overflow-y-auto">
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-80 opacity-70"
        style={{
          background: `radial-gradient(circle at top left, ${accentColor}22 0%, transparent 38%), radial-gradient(circle at top right, rgba(255,255,255,0.08) 0%, transparent 30%)`,
        }}
      />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.02),transparent_24%),linear-gradient(180deg,#070707_0%,#050505_100%)]" />

      <div className="relative z-10 mx-auto max-w-4xl px-5 pb-16 pt-8 lg:px-8">
        <section
          className="border-b border-white/10 pb-8"
          style={{
            boxShadow: 'none',
          }}
        >
          <div className="flex flex-wrap items-center gap-3">
            <div
              className="rounded-full border px-3 py-1 font-oswald text-[10px] uppercase tracking-[0.2em]"
              style={{ borderColor: `${accentColor}40`, color: textAccentColor, background: `${accentColor}16` }}
            >
              Counterfactual
            </div>
            <div className="text-[11px] uppercase tracking-[0.16em] text-white/35">{analysis.targetMetricLabel}</div>
            {cacheMeta.cachedAt && (
              <div className="text-[11px] text-white/30">Saved {formatGeneratedAt(cacheMeta.cachedAt)}</div>
            )}
          </div>

          <h1 className="mt-5 max-w-4xl font-oswald text-3xl uppercase tracking-[0.08em] text-white/94 sm:text-4xl">
            Could {analysis.targetTeamName} still reach {analysis.targetMetricLabel}?
          </h1>
          <p className="mt-4 max-w-3xl text-sm leading-7 text-white/58">
            This report separates the mathematical ceiling from the believable path. The point is not
            just whether a route exists, but how much of it survives contact with transfers, finances,
            and the real world.
          </p>

          <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard
              label="Current Model"
              value={formatOdds(analysis.baselineOdds)}
              note="Baseline simulation under current conditions"
            />
            <MetricCard
              label="Mathematical Ceiling"
              value={formatOdds(perfectWorld?.simulationResult.modifiedOdds)}
              note={liveChanceExists ? 'Still alive on paper' : 'No current-season path found'}
            />
            <MetricCard
              label="Best Believable Path"
              value={formatOdds(bestPragmatic?.simulationResult.modifiedOdds)}
              note={bestPragmatic ? `${bestPragmatic.plausibility.score}/100 plausibility` : 'No believable path stored'}
            />
            <MetricCard
              label="Scenarios Tested"
              value={`${analysis.scenarios.length}`}
              note={`${analysis.totalSimulations.toLocaleString()} simulation passes`}
            />
          </div>
        </section>

        {analysis.narrative.bottomLine && (
          <section className="mt-6 border-l-2 pl-5" style={{ borderColor: `${accentColor}70` }}>
            <div className="text-[10px] uppercase tracking-[0.18em] text-white/35">Bottom Line</div>
            <div className="mt-2 text-base font-semibold leading-7 text-white/90">{analysis.narrative.bottomLine}</div>
          </section>
        )}

        {/*
        <section className="mt-6 border-b border-white/10 pb-6">
          <div className="font-oswald text-[12px] uppercase tracking-[0.18em]" style={{ color: textShade(accentColor, 0.88) }}>
            Snapshot
          </div>
          <div className="mt-4 flex flex-col gap-4">
            <div
              className="rounded-[26px] border p-6 sm:p-8"
              style={{
                borderColor: `${accentColor}2a`,
                background: `linear-gradient(135deg, ${accentColor}12 0%, rgba(255,255,255,0.025) 100%)`,
              }}
            >
              <div className="text-[10px] uppercase tracking-[0.18em] text-white/32">At a glance</div>
              <div className="mt-3 text-xl leading-[1.4] text-white/88 sm:text-2xl">
                {liveChanceExists
                  ? `${analysis.targetTeamName} still has a mathematical route, but the ceiling is only ${formatOdds(perfectWorld?.simulationResult.modifiedOdds)} in the best script the model can create.`
                  : `The current-season route is gone in the model even after the friendliest script it can create.`}
              </div>
            </div>

            <div className="grid auto-rows-fr gap-3 sm:grid-cols-2">
              {snapshotItems.map((item, index) => (
                <SnapshotCard key={item} item={item} index={index} accentColor={accentColor} />
              ))}
            </div>
          </div>
        </section>
        */}

        <section className="mt-6 border-b border-white/10 pb-6">
          <div
            className="font-oswald text-[11px] tracking-widest uppercase mb-3"
            style={{ color: `${accentColor}90` }}
          >
            Scenarios Explored
          </div>
          <div
            className="rounded-lg overflow-hidden border"
            style={{ borderColor: 'rgba(255,255,255,0.06)' }}
          >
            <div
              className="grid grid-cols-[1fr_80px_80px_80px] gap-2 px-3 py-2 text-[10px] uppercase tracking-wider text-white/30"
              style={{ background: 'rgba(255,255,255,0.03)' }}
            >
              <span>Scenario</span>
              <span className="text-right">Plausibility</span>
              <span className="text-right">Exp. Pts</span>
              <span className="text-right">{analysis.targetMetricLabel}</span>
            </div>

            <div
              className="grid grid-cols-[1fr_80px_80px_80px] gap-2 px-3 py-2 text-[11px]"
              style={{
                background: 'rgba(255,255,255,0.01)',
                borderBottom: '1px solid rgba(255,255,255,0.04)',
              }}
            >
              <span className="text-white/40 italic">Baseline (no changes)</span>
              <span className="text-right text-white/30">&mdash;</span>
              <span className="text-right text-white/50 font-mono">
                {analysis.baselineExpectedPoints?.toFixed(1) ?? '\u2014'}
              </span>
              <span className="text-right text-white/50 font-mono">
                {analysis.baselineOdds.toFixed(1)}%
              </span>
            </div>

            {[...analysis.scenarios]
              .sort((a, b) => b.plausibility.score - a.plausibility.score)
              .map((s, i) => (
                <div
                  key={s.id}
                  className="grid grid-cols-[1fr_80px_80px_80px] gap-2 px-3 py-2 text-[11px]"
                  style={{
                    background: i % 2 === 0
                      ? 'rgba(255,255,255,0.015)'
                      : 'rgba(255,255,255,0.005)',
                    borderBottom: '1px solid rgba(255,255,255,0.03)',
                  }}
                >
                  <span className="text-white/60 truncate" title={s.title}>
                    {s.title}
                  </span>
                  <span className="text-right text-white/40 font-mono">
                    {s.plausibility.score}/100
                  </span>
                  <span className="text-right text-white/50 font-mono">
                    {s.simulationResult.modifiedExpectedPoints?.toFixed(1)
                      ?? (analysis.baselineExpectedPoints
                        ? (analysis.baselineExpectedPoints + s.simulationResult.delta * 0.5).toFixed(1)
                        : '\u2014')}
                  </span>
                  <span
                    className="text-right font-mono font-medium"
                    style={{
                      color: s.simulationResult.delta > 2
                        ? '#4ade80'
                        : s.simulationResult.delta > 0
                          ? '#a3e635'
                          : '#ef4444',
                    }}
                  >
                    {s.simulationResult.modifiedOdds.toFixed(1)}%
                  </span>
                </div>
              ))}
          </div>
        </section>

        <div className="mt-6 space-y-6">
          <NarrativeCard
            title="The Mathematical Ceiling"
            eyebrow={liveChanceExists ? 'Possible on paper' : 'No current-season route'}
            content={analysis.narrative.perfectWorldSection}
            accentColor={accentColor}
          />
          <NarrativeCard
            title="Reality Check"
            eyebrow="Why the ceiling is hard to reach"
            content={analysis.narrative.realityCheckSection}
            accentColor={accentColor}
          />
          <NarrativeCard
            title="Pragmatic Path"
            eyebrow="Best believable route"
            content={analysis.narrative.pragmaticPathSection}
            accentColor={accentColor}
          />
          <NarrativeCard
            title="The Long View"
            eyebrow="What would need to change over time"
            content={analysis.narrative.longTermPerspective}
            accentColor={accentColor}
          />

          <section className="border-t border-white/10 pt-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="font-oswald text-[12px] uppercase tracking-[0.18em]" style={{ color: textShade(accentColor, 0.88) }}>
                  Research Trail
                </div>
                <div className="mt-1 text-sm text-white/45">
                  Actual search queries used during the run.
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <MiniMetric label="Web" value={`${analysis.totalWebSearches}`} />
                <MiniMetric label="LLM" value={`${analysis.totalLLMCalls}`} />
                <MiniMetric label="Sims" value={`${analysis.totalSimulations}`} />
                <MiniMetric label="Time" value={formatDuration(analysis.wallClockTimeMs)} />
              </div>
            </div>

            <div className="mt-4 space-y-2">
              {searchTrail.length === 0 && (
                <div className="text-sm text-white/42">No searches were recorded for this run.</div>
              )}
              {searchTrail.map((entry, index) => (
                <div key={`${entry.phase}:${entry.query}:${index}`} className="border-b border-white/6 py-3 last:border-b-0">
                  <div className="flex flex-wrap items-center justify-between gap-3 text-[10px] uppercase tracking-[0.16em] text-white/32">
                    <div>{entry.phase}</div>
                    <div className="flex items-center gap-2">
                      <span>{entry.provider}</span>
                      <span>{entry.resultCount} results</span>
                    </div>
                  </div>
                  <div className="mt-1.5 font-mono text-[13px] leading-6 text-white/70">{entry.query}</div>
                </div>
              ))}
            </div>
          </section>

          <section className="border-t border-white/10 pt-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="font-oswald text-[12px] uppercase tracking-[0.18em]" style={{ color: textShade(accentColor, 0.88) }}>
                  Scenario Board
                </div>
                <div className="mt-1 text-sm text-white/45">
                  Ranked by upside and plausibility, not just fantasy.
                </div>
              </div>
              <div className="text-[11px] text-white/28">
                Tiny non-zero numbers are shown as {'<0.1%'} so they do not disappear into 0.0%.
              </div>
            </div>

            <div className="mt-4 space-y-3">
              {rankedScenarios.map((scenario) => (
                <ScenarioCard key={scenario.id} scenario={scenario} accentColor={accentColor} />
              ))}
            </div>
          </section>

          <section className="border-t border-white/10 pt-5">
            <div className="font-oswald text-[12px] uppercase tracking-[0.18em]" style={{ color: textShade(accentColor, 0.88) }}>
              Method
            </div>
            <div className="mt-3 space-y-3 text-sm leading-7 text-white/55">
              <p>
                Every scenario here was tested through Monte Carlo simulation rather than guessed in the prose.
              </p>
              <p>
                Plausibility scores reflect real-world friction: player availability, finances, culture, and competition priorities.
              </p>
              <p>
                Squad quality comparisons are based on the in-project FC 26 data layer and current web checks.
              </p>
            </div>
            <div className="text-[10px] text-white/25 pt-4 border-t border-white/5 mt-4">
              Generated by Keepwatch V5 in {(analysis.wallClockTimeMs / 60000).toFixed(1)} minutes.
              {' '}{analysis.totalSimulations} Monte Carlo simulations ({(analysis.totalSimulations * 10000).toLocaleString()} season outcomes).
              {' '}{analysis.totalWebSearches} web searches across {analysis.totalIterations} scenarios.
              {' '}{analysis.totalLLMCalls} LLM reasoning steps.
              {' '}Estimated cost: ${analysis.costEstimate?.toFixed(2) ?? '\u2014'}.
              {' '}Squad quality data from FC 26.
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function CachePill({
  label,
  tone,
  accentColor,
}: {
  label: string;
  tone: 'neutral' | 'accent';
  accentColor?: string;
}) {
  return (
    <span
      className="rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.16em]"
      style={{
        borderColor: tone === 'accent' ? `${accentColor}40` : 'rgba(255,255,255,0.12)',
        background: tone === 'accent' ? `${accentColor}18` : 'rgba(255,255,255,0.05)',
        color: 'rgba(255,255,255,0.78)',
      }}
    >
      {label}
    </span>
  );
}

function SnapshotCard({
  item,
  index,
  accentColor,
}: {
  item: string;
  index: number;
  accentColor: string;
}) {
  const { title, detail } = splitSnapshotItem(item);

  return (
    <div
      className="flex h-full flex-col rounded-[20px] border px-4 py-4 sm:px-5"
      style={{
        borderColor: 'rgba(255,255,255,0.08)',
        background: `linear-gradient(180deg, ${accentColor}0d 0%, rgba(255,255,255,0.02) 100%)`,
      }}
    >
      <div className="text-[10px] uppercase tracking-[0.18em]" style={{ color: textShade(accentColor, 0.82) }}>
        Pressure Point {index + 1}
      </div>
      <div className="mt-2 text-lg leading-7 text-white/90">{title}</div>
      {detail && <div className="mt-3 text-base leading-7 text-white/55">{detail}</div>}
    </div>
  );
}

function MetricCard({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note: string;
}) {
  return (
    <div
      className="rounded-2xl border p-4"
      style={{
        borderColor: 'rgba(255,255,255,0.08)',
        background: 'rgba(255,255,255,0.02)',
        boxShadow: 'none',
      }}
    >
      <div className="text-[10px] uppercase tracking-[0.18em] text-white/35">{label}</div>
      <div className="mt-2 text-[28px] font-semibold leading-none" style={{ color: '#f5f5f5' }}>
        {value}
      </div>
      <div className="mt-2 text-sm leading-6 text-white/42">{note}</div>
    </div>
  );
}

function NarrativeCard({
  title,
  eyebrow,
  content,
  accentColor,
}: {
  title: string;
  eyebrow: string;
  content: string;
  accentColor: string;
}) {
  if (!content) return null;

  return (
    <section className="border-t border-white/10 pt-5 lg:pt-6">
      <div className="text-[10px] uppercase tracking-[0.18em]" style={{ color: textShade(accentColor, 0.88) }}>
        {eyebrow}
      </div>
      <h2 className="mt-2 font-oswald text-2xl uppercase tracking-[0.08em] text-white/92">{title}</h2>
      <div className="mt-4 space-y-4 text-sm leading-8 text-white/68">
        {paragraphs(content).map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
      </div>
    </section>
  );
}

function ScenarioCard({
  scenario,
  accentColor,
}: {
  scenario: CounterfactualScenario;
  accentColor: string;
}) {
  return (
    <article
      className="rounded-[18px] border p-4"
      style={{
        borderColor: 'rgba(255,255,255,0.08)',
        background:
          scenario.category === 'perfect_world'
            ? `linear-gradient(135deg, ${accentColor}10 0%, rgba(255,255,255,0.02) 100%)`
            : 'rgba(255,255,255,0.015)',
      }}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-sm font-semibold text-white/92">{scenario.title}</div>
            <span className="rounded-full border border-white/10 px-2 py-1 text-[10px] uppercase tracking-[0.16em] text-white/45">
              {categoryLabel(scenario.category)}
            </span>
            {scenario.fixtureLocks && scenario.fixtureLocks.length > 0 && (
              <span className="rounded-full border border-white/10 px-2 py-1 text-[10px] uppercase tracking-[0.16em] text-white/45">
                {scenario.fixtureLocks.length} locks
              </span>
            )}
          </div>
          <p className="mt-3 text-sm leading-7 text-white/60">{scenario.description}</p>
        </div>

        <div className="grid min-w-[220px] grid-cols-3 gap-2">
          <MiniMetric label="Odds" value={formatOdds(scenario.simulationResult.modifiedOdds)} />
          <MiniMetric label="Delta" value={formatDelta(scenario.simulationResult.delta)} />
          <MiniMetric label="Plausibility" value={`${scenario.plausibility.score}/100`} />
        </div>
      </div>

      {scenario.plausibility.constraints.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {scenario.plausibility.constraints.slice(0, 4).map((item) => (
            <ConstraintPill key={item} text={item} />
          ))}
        </div>
      )}
    </article>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/8 bg-black/20 p-3 text-center">
      <div className="text-[10px] uppercase tracking-[0.16em] text-white/34">{label}</div>
      <div className="mt-1 text-sm font-semibold text-white/88">{value}</div>
    </div>
  );
}

function ConstraintPill({ text }: { text: string }) {
  return (
    <span className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[11px] text-white/52">
      {text}
    </span>
  );
}

function textShade(hex: string, alpha: number): string {
  const normalized = hex.replace('#', '');
  if (normalized.length !== 6) {
    return `rgba(255,255,255,${alpha})`;
  }

  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
