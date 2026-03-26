'use client';

import { useReducer, useCallback, useRef, useEffect } from 'react';
import { Team, Fixture, SimulationResult } from '@/lib/types';
import { WhatIfAnalysis as WhatIfAnalysisType } from '@/lib/what-if/types';
import { CounterfactualScenario } from '@/lib/what-if/types';
import WhatIfProgress, { WhatIfPhase } from './WhatIfProgress';

// ── Props ──

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

// ── State Machine ──

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

function reducer(state: WhatIfState, action: WhatIfAction): WhatIfState {
  switch (action.type) {
    case 'START':
      return {
        ...state,
        phase: 'diagnosing',
        baselineOdds: action.baselineOdds,
        position: action.position,
        points: action.points,
        gamesRemaining: action.gamesRemaining,
        error: null,
      };
    case 'CACHED':
      return { ...state, phase: 'ready', analysis: action.analysis, error: null };
    case 'PHASE':
      return { ...state, phase: action.phase, currentStep: action.step };
    case 'DIAGNOSED':
      return { ...state, phase: 'hypothesising', diagnosis: action.diagnosis };
    case 'HYPOTHESISED':
      return { ...state, phase: 'stressTesting', scenarios: action.scenarios };
    case 'STRESS_TESTED':
      return { ...state, phase: 'synthesising', stressTest: action.stressTest };
    case 'SYNTHESISED':
      return { ...state, phase: 'ready', analysis: action.analysis };
    case 'ERROR':
      return { ...state, phase: 'error', error: action.error };
    case 'RESET':
      return { ...initialState };
    default:
      return state;
  }
}

// ── Component ──

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
  const abortRef = useRef<AbortController | null>(null);

  // ── API Helpers ──

  const callAPI = useCallback(
    async (action: string, extra: Record<string, unknown> = {}) => {
      const res = await fetch('/api/what-if', {
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

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Request failed' }));
        throw new Error(err.error ?? `API error: ${res.status}`);
      }

      return res.json();
    },
    [targetTeam, targetMetric, teams, fixtures]
  );

  // ── Pipeline Orchestration ──

  const runPipeline = useCallback(async () => {
    abortRef.current = new AbortController();

    try {
      // Phase 1: Start (cache check + baseline)
      const startResult = await callAPI('start');

      if (startResult.cached) {
        dispatch({ type: 'CACHED', analysis: startResult.analysis });
        return;
      }

      dispatch({
        type: 'START',
        baselineOdds: startResult.baselineOdds,
        position: startResult.position,
        points: startResult.points,
        gamesRemaining: startResult.gamesRemaining,
      });

      // Phase 2: Diagnose
      dispatch({ type: 'PHASE', phase: 'diagnosing', step: 'Analysing squad quality and structural bottlenecks...' });
      const diagnoseResult = await callAPI('diagnose');

      dispatch({ type: 'DIAGNOSED', diagnosis: diagnoseResult.diagnosis });

      // Phase 3: Hypothesise
      dispatch({ type: 'PHASE', phase: 'hypothesising', step: 'Exploring counterfactual scenarios...' });
      const hypothesiseResult = await callAPI('hypothesise', {
        diagnosis: diagnoseResult.diagnosis,
      });

      dispatch({ type: 'HYPOTHESISED', scenarios: hypothesiseResult.scenarios });

      // Phase 4: Stress Test
      dispatch({ type: 'PHASE', phase: 'stressTesting', step: 'Verifying against real-world constraints...' });
      const stressTestResult = await callAPI('stress-test', {
        scenarios: hypothesiseResult.scenarios,
      });

      dispatch({ type: 'STRESS_TESTED', stressTest: stressTestResult.stressTest });

      // Phase 5: Synthesise
      dispatch({ type: 'PHASE', phase: 'synthesising', step: 'Writing the final analysis...' });
      const synthesiseResult = await callAPI('synthesise', {
        diagnosis: diagnoseResult.diagnosis,
        scenarios: hypothesiseResult.scenarios,
        stressTest: stressTestResult.stressTest,
      });

      dispatch({ type: 'SYNTHESISED', analysis: synthesiseResult.analysis });
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      dispatch({ type: 'ERROR', error: (e as Error).message });
    }
  }, [callAPI]);

  // ── Auto-start when opened ──

  useEffect(() => {
    if (open && state.phase === 'idle') {
      runPipeline();
    }
  }, [open, state.phase, runPipeline]);

  // ── Cleanup on close ──

  const handleClose = useCallback(() => {
    abortRef.current?.abort();
    dispatch({ type: 'RESET' });
    onClose();
  }, [onClose]);

  if (!open) return null;

  const teamName = teams.find((t) => t.abbr === targetTeam)?.name ?? targetTeam;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={handleClose} />

      {/* Modal */}
      <div
        className="relative w-full max-w-3xl max-h-[90vh] mx-4 rounded-xl overflow-hidden flex flex-col"
        style={{
          background: 'linear-gradient(180deg, #141414 0%, #0a0a0a 100%)',
          border: `1px solid ${accentColor}20`,
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-6 py-4 border-b"
          style={{ borderColor: `${accentColor}15` }}
        >
          <div>
            <div className="text-[13px] font-medium text-white">{teamName}</div>
            <div className="text-[11px] text-white/40">
              What If &mdash; {targetMetricLabel}
            </div>
          </div>
          <button
            onClick={handleClose}
            className="text-white/40 hover:text-white/70 text-[18px] transition-colors cursor-pointer"
          >
            &times;
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {/* Loading */}
          {state.phase !== 'idle' && state.phase !== 'ready' && state.phase !== 'error' && (
            <WhatIfProgress
              phase={state.phase}
              currentStep={state.currentStep}
              accentColor={accentColor}
            />
          )}

          {/* Error */}
          {state.phase === 'error' && (
            <div className="flex flex-col items-center justify-center min-h-[300px] px-8">
              <div className="text-[13px] text-red-400 mb-4">{state.error}</div>
              <div className="flex gap-3">
                <button
                  onClick={() => {
                    dispatch({ type: 'RESET' });
                    runPipeline();
                  }}
                  className="px-4 py-2 rounded text-[11px] font-medium bg-white/10 hover:bg-white/15 text-white transition-colors cursor-pointer"
                >
                  Retry
                </button>
                <button
                  onClick={handleClose}
                  className="px-4 py-2 rounded text-[11px] font-medium bg-white/5 hover:bg-white/10 text-white/60 transition-colors cursor-pointer"
                >
                  Close
                </button>
              </div>
            </div>
          )}

          {/* Ready — Full Analysis */}
          {state.phase === 'ready' && state.analysis && (
            <WhatIfContent
              analysis={state.analysis}
              accentColor={accentColor}
              textAccentColor={textAccentColor}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ── Analysis Content Renderer ──

function WhatIfContent({
  analysis,
  accentColor,
  textAccentColor,
}: {
  analysis: WhatIfAnalysisType;
  accentColor: string;
  textAccentColor: string;
}) {
  const perfectWorld = analysis.perfectWorld;
  const bestFeasible = [...analysis.scenarios]
    .filter((s) => s.category !== 'perfect_world' && s.plausibility.score >= 20)
    .sort((a, b) => b.simulationResult.delta - a.simulationResult.delta)[0];

  return (
    <div className="px-6 py-6 space-y-6">
      {/* Stat Cards Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Current Odds" value={`${analysis.baselineOdds.toFixed(1)}%`} accentColor={accentColor} />
        <StatCard
          label="Perfect World"
          value={`${perfectWorld?.simulationResult.modifiedOdds.toFixed(1) ?? '?'}%`}
          accentColor={accentColor}
        />
        <StatCard
          label="Best Realistic"
          value={bestFeasible ? `${bestFeasible.simulationResult.modifiedOdds.toFixed(1)}%` : 'N/A'}
          accentColor={accentColor}
        />
        <StatCard
          label="Scenarios Tested"
          value={`${analysis.scenarios.length}`}
          accentColor={accentColor}
        />
      </div>

      {/* Narrative Sections */}
      {analysis.narrative.perfectWorldSection && (
        <NarrativeSection
          title="The Perfect World"
          content={analysis.narrative.perfectWorldSection}
          accentColor={accentColor}
        />
      )}
      {analysis.narrative.realityCheckSection && (
        <NarrativeSection
          title="The Reality Check"
          content={analysis.narrative.realityCheckSection}
          accentColor={accentColor}
        />
      )}
      {analysis.narrative.pragmaticPathSection && (
        <NarrativeSection
          title="The Pragmatic Path"
          content={analysis.narrative.pragmaticPathSection}
          accentColor={accentColor}
        />
      )}
      {analysis.narrative.longTermPerspective && (
        <NarrativeSection
          title="The Long View"
          content={analysis.narrative.longTermPerspective}
          accentColor={accentColor}
        />
      )}

      {/* Bottom Line */}
      {analysis.narrative.bottomLine && (
        <div
          className="p-4 rounded-lg text-[12px] font-medium text-center"
          style={{
            background: `linear-gradient(135deg, ${accentColor}15, ${accentColor}08)`,
            border: `1px solid ${accentColor}25`,
            color: textAccentColor,
          }}
        >
          {analysis.narrative.bottomLine}
        </div>
      )}

      {/* Scenarios Explored */}
      <details className="group">
        <summary className="text-[11px] text-white/40 cursor-pointer hover:text-white/60 transition-colors">
          Scenarios Explored ({analysis.scenarios.length})
        </summary>
        <div className="mt-3 space-y-2">
          {[...analysis.scenarios]
            .sort((a, b) => b.simulationResult.delta * b.plausibility.score - a.simulationResult.delta * a.plausibility.score)
            .map((s) => (
              <ScenarioCard key={s.id} scenario={s} accentColor={accentColor} />
            ))}
        </div>
      </details>

      {/* Methodology */}
      <div className="text-[10px] text-white/25 pt-4 border-t border-white/5">
        Generated by Keepwatch V5 counterfactual engine. Each scenario was tested with 10,000 Monte Carlo
        simulations. Plausibility scores reflect real-world constraints verified via web search.
        Squad quality data from FC 26.
      </div>
    </div>
  );
}

// ── Sub-components ──

function StatCard({ label, value, accentColor }: { label: string; value: string; accentColor: string }) {
  return (
    <div
      className="p-3 rounded-lg"
      style={{
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(255,255,255,0.06)',
      }}
    >
      <div className="text-[10px] text-white/40 mb-1">{label}</div>
      <div className="text-[18px] font-bold" style={{ color: accentColor }}>
        {value}
      </div>
    </div>
  );
}

function NarrativeSection({ title, content, accentColor }: { title: string; content: string; accentColor: string }) {
  return (
    <div>
      <h3
        className="text-[12px] font-semibold mb-2 uppercase tracking-wider"
        style={{ color: accentColor }}
      >
        {title}
      </h3>
      <div className="text-[12px] text-white/75 leading-relaxed whitespace-pre-wrap">
        {content}
      </div>
    </div>
  );
}

function ScenarioCard({ scenario, accentColor }: { scenario: CounterfactualScenario; accentColor: string }) {
  const deltaColor =
    scenario.simulationResult.delta > 0 ? '#4ade80' : scenario.simulationResult.delta < 0 ? '#f87171' : 'white';

  return (
    <div
      className="p-3 rounded-lg"
      style={{
        background: 'rgba(255,255,255,0.02)',
        border: '1px solid rgba(255,255,255,0.05)',
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-[11px] font-medium text-white/80">{scenario.title}</div>
          <div className="text-[10px] text-white/40 mt-0.5">{scenario.category.replace(/_/g, ' ')}</div>
        </div>
        <div className="text-right flex-shrink-0">
          <div className="text-[12px] font-bold" style={{ color: deltaColor }}>
            {scenario.simulationResult.delta > 0 ? '+' : ''}
            {scenario.simulationResult.delta.toFixed(1)}pp
          </div>
          <div className="text-[9px] text-white/30">
            plausibility {scenario.plausibility.score}/100
          </div>
        </div>
      </div>
      <div className="text-[10px] text-white/50 mt-1.5 line-clamp-2">{scenario.description}</div>
    </div>
  );
}
