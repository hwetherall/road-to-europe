'use client';

import { WhatIfSearchTraceEntry } from '@/lib/what-if/types';

export type WhatIfPhase =
  | 'idle'
  | 'diagnosing'
  | 'hypothesising'
  | 'stressTesting'
  | 'synthesising'
  | 'ready'
  | 'error';

interface WhatIfProgressProps {
  phase: WhatIfPhase;
  currentStep?: string;
  accentColor: string;
  teamName: string;
  targetMetricLabel: string;
  baselineOdds?: number;
  gamesRemaining?: number;
  recentSearches: WhatIfSearchTraceEntry[];
}

const PHASES: Array<{ key: WhatIfPhase; label: string; description: string }> = [
  {
    key: 'diagnosing',
    label: 'Diagnosis',
    description: 'Reading the table, squad profile, and structural bottlenecks.',
  },
  {
    key: 'hypothesising',
    label: 'Scenario Search',
    description: 'Testing counterfactual worlds, from math ceiling to structural upgrades.',
  },
  {
    key: 'stressTesting',
    label: 'Reality Check',
    description: 'Separating believable paths from fantasy-book assumptions.',
  },
  {
    key: 'synthesising',
    label: 'Writing Report',
    description: 'Turning the simulations into a readable final verdict.',
  },
];

function getPhaseIndex(phase: WhatIfPhase): number {
  return PHASES.findIndex((item) => item.key === phase);
}

function formatOdds(value?: number): string {
  if (value === undefined || Number.isNaN(value)) return 'Computing';
  if (value > 0 && value < 0.1) return '<0.1%';
  return `${value.toFixed(1)}%`;
}

function StageIcon({ active, complete }: { active: boolean; complete: boolean }) {
  if (complete) {
    return (
      <div className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/10">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M2.5 7L5.5 10L11.5 4" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    );
  }

  return (
    <div
      className="relative flex h-10 w-10 items-center justify-center rounded-full border"
      style={{
        borderColor: active ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.08)',
        background: active ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.02)',
      }}
    >
      {active && (
        <div
          className="h-4 w-4 animate-spin rounded-full border-2 border-t-transparent"
          style={{ borderColor: 'rgba(255,255,255,0.9)', borderTopColor: 'transparent' }}
        />
      )}
      {!active && <div className="h-2.5 w-2.5 rounded-full bg-white/20" />}
    </div>
  );
}

function SignalCard({
  label,
  value,
  accentColor,
}: {
  label: string;
  value: string;
  accentColor: string;
}) {
  return (
    <div
      className="rounded-[22px] border p-4"
      style={{
        borderColor: 'rgba(255,255,255,0.08)',
        background: `linear-gradient(180deg, ${accentColor}10 0%, rgba(255,255,255,0.02) 100%)`,
        boxShadow: `inset 0 1px 0 ${accentColor}10`,
      }}
    >
      <div className="text-[10px] uppercase tracking-[0.18em] text-white/35">{label}</div>
      <div className="mt-2 text-lg font-semibold text-white/90">{value}</div>
    </div>
  );
}

function PhaseCard({
  label,
  description,
  active,
  complete,
  accentColor,
}: {
  label: string;
  description: string;
  active: boolean;
  complete: boolean;
  accentColor: string;
}) {
  return (
    <div
      className="rounded-[22px] border p-4 transition-all duration-300"
      style={{
        borderColor: active ? `${accentColor}55` : 'rgba(255,255,255,0.08)',
        background: active ? `${accentColor}12` : 'rgba(255,255,255,0.02)',
        opacity: complete || active ? 1 : 0.62,
      }}
    >
      <div className="flex items-start gap-3">
        <StageIcon active={active} complete={complete} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm font-semibold text-white/90">{label}</div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-white/30">
              {complete ? 'Done' : active ? 'Live' : 'Queued'}
            </div>
          </div>
          <div className="mt-1 text-sm leading-6 text-white/48">{description}</div>
        </div>
      </div>
      <div className="mt-3 h-[3px] overflow-hidden rounded-full bg-white/8">
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{
            width: complete ? '100%' : active ? '74%' : '14%',
            background: complete
              ? 'rgba(255,255,255,0.8)'
              : `linear-gradient(90deg, ${accentColor}b3, ${accentColor})`,
          }}
        />
      </div>
    </div>
  );
}

export default function WhatIfProgress({
  phase,
  currentStep,
  accentColor,
  teamName,
  targetMetricLabel,
  baselineOdds,
  gamesRemaining,
  recentSearches,
}: WhatIfProgressProps) {
  const activeIdx = getPhaseIndex(phase);

  return (
    <div className="relative flex min-h-screen items-start justify-center overflow-hidden px-5 py-8 lg:px-8">
      <div
        className="pointer-events-none absolute left-1/2 top-[14%] h-[28rem] w-[28rem] -translate-x-1/2 rounded-full opacity-20 blur-3xl"
        style={{ background: `radial-gradient(circle, ${accentColor}40 0%, transparent 72%)` }}
      />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.08),transparent_32%),linear-gradient(180deg,#090909_0%,#050505_100%)]" />

      <div className="relative z-10 mx-auto w-full max-w-5xl">
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
          <section className="rounded-[32px] border border-white/10 bg-white/[0.03] p-6 shadow-[0_24px_80px_rgba(0,0,0,0.35)] lg:p-8">
            <div className="font-oswald text-[11px] uppercase tracking-[0.3em] text-white/35">Keepwatch What If</div>
            <h1 className="mt-4 font-oswald text-3xl uppercase tracking-[0.08em] text-white/92 sm:text-4xl">
              Counterfactual Report
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-white/58">
              Building a report for {teamName} and separating what is mathematically possible from what is
              believable in the real world.
            </p>

            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              <SignalCard label="Question" value={targetMetricLabel} accentColor={accentColor} />
              <SignalCard label="Current Model" value={formatOdds(baselineOdds)} accentColor={accentColor} />
              <SignalCard
                label="Remaining Matches"
                value={gamesRemaining && gamesRemaining > 0 ? `${gamesRemaining} still to play` : 'Computing'}
                accentColor={accentColor}
              />
            </div>

            <div
              className="mt-6 rounded-[24px] border px-5 py-4 text-sm leading-7 text-white/62"
              style={{
                borderColor: `${accentColor}30`,
                background: `linear-gradient(135deg, ${accentColor}12 0%, rgba(255,255,255,0.02) 100%)`,
              }}
            >
              The engine is checking the baseline, testing counterfactual scenarios, and then stress-testing
              those ideas against reality before it writes the final readout.
            </div>
          </section>

          <section className="rounded-[32px] border border-white/10 bg-white/[0.03] p-6 shadow-[0_24px_80px_rgba(0,0,0,0.35)] backdrop-blur">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-[10px] uppercase tracking-[0.18em] text-white/35">Current Stage</div>
                <div className="mt-2 text-2xl font-semibold text-white/92">
                  {PHASES[Math.max(activeIdx, 0)]?.label ?? 'Starting'}
                </div>
              </div>
              <div
                className="rounded-full border px-3 py-1 text-[10px] uppercase tracking-[0.18em]"
                style={{ borderColor: `${accentColor}40`, color: '#f5f5f5', background: `${accentColor}18` }}
              >
                Live
              </div>
            </div>

            <div className="mt-4 text-sm leading-7 text-white/52">
              {currentStep ?? PHASES[Math.max(activeIdx, 0)]?.description ?? 'Preparing the analysis...'}
            </div>

            <div className="mt-6 h-[4px] overflow-hidden rounded-full bg-white/8">
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{
                  width: `${Math.max(14, ((Math.max(activeIdx, 0) + 0.7) / PHASES.length) * 100)}%`,
                  background: `linear-gradient(90deg, ${accentColor}b3, ${accentColor})`,
                }}
              />
            </div>

            <div className="mt-4 text-[11px] uppercase tracking-[0.16em] text-white/30">
              {Math.max(activeIdx + 1, 1)} of {PHASES.length} stages active
            </div>
          </section>
        </div>

        <section className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {PHASES.map((item, index) => {
            const complete = index < activeIdx;
            const active = index === activeIdx;
            return (
              <PhaseCard
                key={item.key}
                label={item.label}
                description={item.description}
                active={active}
                complete={complete}
                accentColor={accentColor}
              />
            );
          })}
        </section>

        <section className="mt-6 rounded-[28px] border border-white/10 bg-white/[0.03] p-5 shadow-[0_24px_80px_rgba(0,0,0,0.3)]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-[10px] uppercase tracking-[0.18em] text-white/35">Research Trail</div>
              <div className="mt-1 text-sm text-white/42">Live queries as the report checks form, squad context, and transfers.</div>
            </div>
            <div className="text-[10px] text-white/28">{recentSearches.length} searches logged</div>
          </div>

          <div className="mt-4 max-h-[19rem] space-y-2 overflow-y-auto pr-1">
            {recentSearches.length === 0 && (
              <div className="rounded-[20px] border border-white/8 bg-black/20 px-4 py-4 text-sm leading-6 text-white/40">
                Search queries will appear here as the analysis researches transfers, form, injuries, and tactical context.
              </div>
            )}

            {recentSearches.slice(-4).reverse().map((entry, index) => (
              <div key={`${entry.phase}:${entry.query}:${index}`} className="rounded-[20px] border border-white/8 bg-black/20 px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="text-[10px] uppercase tracking-[0.16em] text-white/32">{entry.phase}</div>
                  <div className="flex items-center gap-2 text-[10px]">
                    <span className="rounded-full border border-white/10 px-2 py-0.5 text-white/42">
                      {entry.provider}
                    </span>
                    <span className="text-white/28">{entry.resultCount} results</span>
                  </div>
                </div>
                <div className="mt-2 text-sm leading-6 text-white/68">{entry.query}</div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
