'use client';

import { SimulationResult, TeamContext } from '@/lib/types';

interface Props {
  baseResult: SimulationResult;
  whatIfResult: SimulationResult;
  teamContext: TeamContext;
  lockCount: number;
}

export default function WhatIfComparison({ baseResult, whatIfResult, teamContext, lockCount }: Props) {
  const metric = teamContext.primaryMetric as keyof SimulationResult;
  const baseVal = baseResult[metric] as number;
  const whatIfVal = whatIfResult[metric] as number;
  const delta = whatIfVal - baseVal;
  const isPositive = teamContext.zone === 'relegation'
    ? (metric === 'relegationPct' ? delta < 0 : delta > 0)
    : delta > 0;

  const metricLabel = teamContext.relevantCards.find(
    (c) => c.key === metric
  )?.label ?? metric;

  return (
    <div
      className="mb-6 rounded-xl p-4 border"
      style={{
        background: isPositive ? 'rgba(34,197,94,0.06)' : 'rgba(239,68,68,0.06)',
        borderColor: isPositive ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)',
      }}
    >
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="text-xs text-white/50">
          What-If Analysis — {lockCount} fixture{lockCount !== 1 ? 's' : ''} locked
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-white/50">
            Base: <span className="text-white font-bold font-oswald">{baseVal.toFixed(1)}%</span>
          </span>
          <span className="text-white/30">&rarr;</span>
          <span className="text-white/50">
            What-If: <span className="text-white font-bold font-oswald">{whatIfVal.toFixed(1)}%</span>
          </span>
          <span
            className="font-bold font-oswald text-base"
            style={{ color: isPositive ? '#22c55e' : '#ef4444' }}
          >
            {delta > 0 ? '+' : ''}{delta.toFixed(1)}pp
          </span>
        </div>
      </div>
      <div className="text-[10px] text-white/30 mt-1">
        {metricLabel} probability
      </div>
    </div>
  );
}
