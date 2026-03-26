'use client';

export type WhatIfPhase = 'idle' | 'diagnosing' | 'hypothesising' | 'stressTesting' | 'synthesising' | 'ready' | 'error';

interface WhatIfProgressProps {
  phase: WhatIfPhase;
  currentStep?: string;
  accentColor: string;
}

const PHASES: { key: WhatIfPhase; label: string; description: string }[] = [
  { key: 'diagnosing', label: 'Diagnosis', description: 'Analysing structural bottlenecks...' },
  { key: 'hypothesising', label: 'Scenario Exploration', description: 'Testing counterfactual scenarios...' },
  { key: 'stressTesting', label: 'Reality Check', description: 'Stress-testing against real-world constraints...' },
  { key: 'synthesising', label: 'Writing Analysis', description: 'Composing the final narrative...' },
];

function getPhaseIndex(phase: WhatIfPhase): number {
  return PHASES.findIndex((p) => p.key === phase);
}

export default function WhatIfProgress({ phase, currentStep, accentColor }: WhatIfProgressProps) {
  const activeIdx = getPhaseIndex(phase);

  return (
    <div className="flex flex-col items-center justify-center min-h-[400px] px-8">
      <div className="w-full max-w-md">
        {/* Spinner */}
        <div className="flex justify-center mb-8">
          <div
            className="w-10 h-10 rounded-full border-2 border-t-transparent animate-spin"
            style={{ borderColor: `${accentColor}40`, borderTopColor: 'transparent' }}
          />
        </div>

        {/* Phase timeline */}
        <div className="space-y-4">
          {PHASES.map((p, idx) => {
            const isComplete = idx < activeIdx;
            const isActive = idx === activeIdx;
            const isPending = idx > activeIdx;

            return (
              <div key={p.key} className="flex items-start gap-3">
                {/* Indicator */}
                <div className="mt-0.5 flex-shrink-0">
                  {isComplete && (
                    <div
                      className="w-5 h-5 rounded-full flex items-center justify-center text-[10px]"
                      style={{ background: `${accentColor}30`, color: accentColor }}
                    >
                      &#10003;
                    </div>
                  )}
                  {isActive && (
                    <div
                      className="w-5 h-5 rounded-full border-2 border-t-transparent animate-spin"
                      style={{ borderColor: `${accentColor}60`, borderTopColor: 'transparent' }}
                    />
                  )}
                  {isPending && (
                    <div className="w-5 h-5 rounded-full bg-white/10" />
                  )}
                </div>

                {/* Label */}
                <div>
                  <div
                    className="text-[12px] font-medium"
                    style={{
                      color: isActive ? 'white' : isComplete ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.3)',
                    }}
                  >
                    {p.label}
                  </div>
                  {isActive && (
                    <div className="text-[11px] text-white/40 mt-0.5">
                      {currentStep ?? p.description}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Progress bar */}
        <div className="mt-8 h-1 rounded-full bg-white/10 overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-1000 ease-out"
            style={{
              width: `${Math.max(5, ((activeIdx + 0.5) / PHASES.length) * 100)}%`,
              background: accentColor,
            }}
          />
        </div>
      </div>
    </div>
  );
}
